"""Graphe du dossier pré-consultation (conception §2, flux E).

Distinct du graphe de conversation : pas de question en entrée, une sortie de nature différente,
un budget de latence de 30 s et des garde-fous propres. Cinq nœuds, sans branche :

    collect → timeline → synthesize → verify → finalize

`timeline` est déterministe : la chronologie ne dépend d'aucun modèle. `synthesize` est un gabarit
en dev ; le LLM principal le remplacera (lot 8 bis) sans changer le contrat. `verify` refuse tout
élément sans source et tout langage diagnostique — un dossier qui échoue n'est pas envoyé.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from itertools import pairwise
from operator import add
from typing import Annotated, Any, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.runtime import Runtime

from pawrise_assistant.components.guardrail import URGENT_SIGNALS, is_diagnostic
from pawrise_assistant.components.text import fold
from pawrise_assistant.domain.models import (
    Alert,
    NodeTrace,
    PetProfile,
    TelemetrySummary,
    Urgency,
)
from pawrise_assistant.graph.deps import Deps
from pawrise_assistant.handoff.models import (
    HandoffRequest,
    HandoffSummary,
    Sourced,
    TimelineEvent,
)


class HandoffInvalid(ValueError):
    """Le dossier n'a pas passé la vérification : il n'est pas envoyé."""


class HandoffState(TypedDict):
    request: HandoffRequest
    profile: NotRequired[PetProfile | None]
    telemetry: NotRequired[TelemetrySummary | None]
    alerts: NotRequired[list[Alert]]
    timeline: NotRequired[list[TimelineEvent]]
    summary: NotRequired[HandoffSummary]
    problems: NotRequired[list[str]]
    trace: Annotated[list[NodeTrace], add]


def _trace(node: str, status: Any, summary: str, **data: Any) -> list[NodeTrace]:
    return [NodeTrace(node=node, status=status, summary=summary, data=data)]


async def collect(state: HandoffState, runtime: Runtime[Deps]) -> dict[str, Any]:
    api, req = runtime.context.core_api, state["request"]
    results = await asyncio.gather(
        api.get_pet_profile(req.pet_ref),
        api.get_recent_telemetry(req.pet_ref, 7),
        api.get_recent_alerts(req.pet_ref, req.window_days),
        return_exceptions=True,
    )
    p, t, a = results
    profile = p if isinstance(p, PetProfile) else None
    telemetry = t if isinstance(t, TelemetrySummary) else None
    alerts: list[Alert] = a if isinstance(a, list) else []
    names = (
        "get_pet_profile",
        "get_recent_telemetry(7j)",
        f"get_recent_alerts({req.window_days}j)",
    )
    tools: list[dict[str, Any]] = [
        {"tool": n, "ok": not isinstance(r, BaseException)}
        | ({"error": str(r)} if isinstance(r, BaseException) else {})
        for n, r in zip(names, results, strict=True)
    ]
    missing: list[str] = [t["tool"] for t in tools if not t["ok"]]
    return {
        "profile": profile,
        "telemetry": telemetry,
        "alerts": alerts or [],
        "trace": _trace(
            "collect",
            "degraded" if missing else "ok",
            f"Données manquantes : {', '.join(missing)}"
            if missing
            else "Profil, 7 j de collier, alertes sur la période",
            tools=tools,
            alerts=len(alerts or []),
        ),
    }


async def timeline(state: HandoffState) -> dict[str, Any]:
    events: list[TimelineEvent] = [
        TimelineEvent(days_ago=a.days_ago, text=a.summary, source=f"alert:{a.alert_id}")
        for a in state.get("alerts", [])
    ]
    tel = state.get("telemetry")
    if tel:
        events.append(
            TimelineEvent(
                days_ago=0,
                source="telemetry",
                text=f"Sur {tel.period_days} j : activité {tel.activity_delta_pct:+.0f} %, sommeil "
                f"{tel.sleep_delta_pct:+.0f} %, pic cardiaque nocturne {tel.night_hr_peak_bpm} bpm",
            )
        )
    events.sort(key=lambda e: -e.days_ago)
    return {
        "timeline": events,
        "trace": _trace(
            "timeline",
            "ok",
            f"{len(events)} événement(s) daté(s)",
            events=[e.model_dump() for e in events],
        ),
    }


def _urgency(owner_text: str, alerts: list[Alert]) -> Urgency:
    if URGENT_SIGNALS.search(fold(owner_text).replace("'", " ").replace("’", " ")):
        return "high"
    if any(a.level == "action" for a in alerts):
        return "high"
    if any(a.level == "vigilance" for a in alerts):
        return "medium"
    return "low"


async def synthesize(state: HandoffState) -> dict[str, Any]:
    req = state["request"]
    owner = [(i, t) for i, t in enumerate(req.thread_extracts, start=1) if t.role == "owner"]
    reported = [Sourced(text=t.content, source=f"thread:{i}") for i, t in owner]
    observations: list[Sourced] = []
    profile = state.get("profile")
    if profile and profile.declared_conditions:
        observations.append(
            Sourced(
                text="Antécédents déclarés par le propriétaire : "
                + ", ".join(profile.declared_conditions),
                source="profile",
            )
        )
    tel = state.get("telemetry")
    if tel and not tel.baseline_ready:
        observations.append(
            Sourced(
                text="Baseline encore en apprentissage : écarts à interpréter avec prudence.",
                source="telemetry",
            )
        )
    summary = HandoffSummary(
        pet=profile,
        reason=req.reason or (reported[-1].text if reported else "Demande du propriétaire"),
        urgency=_urgency(" ".join(t.content for _, t in owner), state.get("alerts", [])),
        timeline=state.get("timeline", []),
        owner_reported=reported,
        observations=observations,
    )
    return {
        "summary": summary,
        "trace": _trace(
            "synthesize",
            "ok",
            f"Urgence {summary.urgency}, {len(reported)} propos du propriétaire repris",
            urgency=summary.urgency,
            reason=summary.reason,
        ),
    }


async def verify(state: HandoffState) -> dict[str, Any]:
    s = state["summary"]
    items: list[Sourced] = [*s.timeline, *s.owner_reported, *s.observations]
    problems = [f"sans source : « {i.text} »" for i in items if not i.source]
    # Les propos du propriétaire sont cités tels quels : on ne vérifie que ce que l'assistant écrit.
    written = [s.reason if not s.owner_reported else "", *(i.text for i in s.observations)]
    problems += [f"langage diagnostique : « {t} »" for t in written if t and is_diagnostic(t)]
    return {
        "problems": problems,
        "trace": _trace(
            "verify",
            "rejected" if problems else "ok",
            problems[0] if problems else f"{len(items)} éléments, tous sourcés",
            problems=problems,
        ),
    }


async def finalize(state: HandoffState, runtime: Runtime[Deps]) -> dict[str, Any]:
    if state.get("problems"):
        raise HandoffInvalid("; ".join(state["problems"]))
    await runtime.context.audit.write(
        {
            "ts": datetime.now(UTC).isoformat(timespec="seconds"),
            "kind": "handoff_summary",
            "thread_id": state["request"].thread_id,
            "pet_ref": state["request"].pet_ref,
            "trace": [t.model_dump() for t in state["trace"]],
            "summary": state["summary"].model_dump(),
        }
    )
    return {"trace": _trace("finalize", "ok", "Audit écrit, dossier émis")}


def build_handoff_graph() -> CompiledStateGraph[HandoffState, Deps, HandoffState, HandoffState]:
    g = StateGraph(HandoffState, context_schema=Deps)
    steps: list[tuple[str, Any]] = [
        ("collect", collect),
        ("timeline", timeline),
        ("synthesize", synthesize),
        ("verify", verify),
        ("finalize", finalize),
    ]
    for name, fn in steps:
        g.add_node(name, fn)
    names = [n for n, _ in steps]
    g.add_edge(START, names[0])
    for a, b in pairwise(names):
        g.add_edge(a, b)
    g.add_edge(names[-1], END)
    return g.compile()


async def generate_handoff_summary(graph: Any, req: HandoffRequest, deps: Deps) -> HandoffSummary:
    out = await graph.ainvoke({"request": req, "trace": []}, context=deps)
    summary: HandoffSummary = out["summary"]
    return summary
