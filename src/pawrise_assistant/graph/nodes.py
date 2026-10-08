"""Les nœuds du graphe (conception §3.2).

Chaque nœud lit le state, appelle son composant, et renvoie ses écritures plus une `NodeTrace`.
La trace est la seule instrumentation : l'audit et la console la lisent toutes les deux.

Échecs : les nœuds 1 et 6 échouent fermé, les nœuds 2, 3 et 4 échouent ouvert (voir `handlers`).
"""

from __future__ import annotations

import asyncio
import functools
import time
from collections.abc import Awaitable, Callable
from typing import Any

from langgraph.runtime import Runtime

from pawrise_assistant.components.guardrail import GuardrailContext
from pawrise_assistant.components.pii import redact
from pawrise_assistant.components.safe_responses import FALLBACK, SAFE_RESPONSES, URGENT_PREFIX
from pawrise_assistant.domain.models import (
    TELEMETRY_SOURCE,
    Alert,
    AssistantResponse,
    Citation,
    Escalation,
    NodeTrace,
    PetContext,
    PetProfile,
    ResponseMetadata,
    SuggestedAction,
    TelemetrySummary,
)
from pawrise_assistant.domain.state import AssistantState
from pawrise_assistant.graph.deps import Deps
from pawrise_assistant.llm.provider import summarize, usage_scope

Update = dict[str, Any]

TOP_K, TOP_N = 20, 5


def _trace(node: str, status: Any, summary: str, **data: Any) -> list[NodeTrace]:
    return [NodeTrace(node=node, status=status, summary=summary, data=data)]


# — 1 —


async def circuit_breaker(state: AssistantState, runtime: Runtime[Deps]) -> Update:
    deps = runtime.context
    if "classifier_down" in deps.faults:
        raise RuntimeError("classifieur injoignable (panne injectée)")
    message, pii = redact(state["user_message"])
    result = await deps.classifier.classify(message)
    clean = result.intent == "clean"
    return {
        "user_message": message,
        "intent": result.intent,
        "intent_confidence": result.confidence,
        "trace": _trace(
            "circuit_breaker",
            "ok" if clean else "redirected",
            "Question à traiter" if clean else f"Arrêt : {result.intent}",
            intent=result.intent,
            confidence=result.confidence,
            matched=result.matched,
            pii_redacted=pii,
        ),
    }


# — 2 —


async def _tool(name: str, call: Awaitable[Any], log: list[dict[str, Any]], fail: bool) -> Any:
    t0 = time.perf_counter()
    try:
        if fail:
            raise TimeoutError("Core API : délai dépassé (panne injectée)")
        value = await asyncio.wait_for(call, timeout=1.0)
        log.append({"tool": name, "ok": True, "ms": round((time.perf_counter() - t0) * 1000, 1)})
        return value
    except Exception as e:  # fail-open : le chat continue sans ce contexte
        if asyncio.iscoroutine(call):
            call.close()
        log.append({"tool": name, "ok": False, "error": str(e)})
        return None


async def query_understanding(state: AssistantState, runtime: Runtime[Deps]) -> Update:
    deps = runtime.context
    alert = state.get("alert_context")
    u = await deps.understanding.understand(state["user_message"], alert)
    pet_ref, fail = state["pet_ref"], "core_api_timeout" in deps.faults
    log: list[dict[str, Any]] = []
    calls: list[Awaitable[Any]] = [
        _tool("get_pet_profile", deps.core_api.get_pet_profile(pet_ref), log, fail)
    ]
    if u.telemetry_days:
        calls.append(
            _tool(
                f"get_recent_telemetry({u.telemetry_days}j)",
                deps.core_api.get_recent_telemetry(pet_ref, u.telemetry_days),
                log,
                fail,
            )
        )
    if u.alerts_days:
        calls.append(
            _tool(
                f"get_recent_alerts({u.alerts_days}j)",
                deps.core_api.get_recent_alerts(pet_ref, u.alerts_days),
                log,
                fail,
            )
        )
    results = await asyncio.gather(*calls)
    profile = next((r for r in results if isinstance(r, PetProfile)), None)
    telemetry = next((r for r in results if isinstance(r, TelemetrySummary)), None)
    alerts: list[Alert] = next((r for r in results if isinstance(r, list)), [])
    pet = PetContext(profile=profile, telemetry=telemetry, alerts=alerts)
    degraded = any(not t["ok"] for t in log)
    return {
        "canonical_query": u.canonical_query,
        "needs_retrieval": u.needs_retrieval,
        "pet_context": pet,
        "trace": _trace(
            "query_understanding",
            "degraded" if degraded else "ok",
            (
                "Contexte partiel : un outil a échoué"
                if degraded
                else "Recherche utile"
                if u.needs_retrieval
                else "Rien à chercher"
            ),
            canonical_query=u.canonical_query,
            needs_retrieval=u.needs_retrieval,
            tools=log,
            pet_context=pet.describe(),
        ),
    }


# — 3 et 4 —


async def retrieval(state: AssistantState, runtime: Runtime[Deps]) -> Update:
    deps = runtime.context
    if "retriever_down" in deps.faults:
        raise RuntimeError("base vectorielle injoignable (panne injectée)")
    found = await deps.retriever.search(state["canonical_query"], TOP_K)
    return {
        "candidates": found,
        "trace": _trace(
            "retrieval",
            "ok",
            f"{len(found)} passages trouvés",
            retriever=deps.retriever.name,
            candidates=[{"id": c.chunk_id, **c.scores} for c in found],
        ),
    }


async def relevance_filter(state: AssistantState, runtime: Runtime[Deps]) -> Update:
    deps = runtime.context
    if "reranker_down" in deps.faults:
        raise RuntimeError("reranker injoignable (panne injectée)")
    candidates = state.get("candidates", [])
    kept = await deps.reranker.rerank(state["canonical_query"], candidates, TOP_N)
    kept_ids = {c.chunk_id for c in kept}
    return {
        "context_chunks": kept,
        "trace": _trace(
            "relevance_filter",
            "ok",
            f"{len(kept)} gardés sur {len(candidates)}",
            reranker=deps.reranker.name,
            kept=[{"id": c.chunk_id, **c.scores} for c in kept],
            dropped=[c.chunk_id for c in candidates if c.chunk_id not in kept_ids],
        ),
    }


# — 5 et 6 —


async def generation(state: AssistantState, runtime: Runtime[Deps]) -> Update:
    deps = runtime.context
    hardened = state.get("retry_count", 0) > 0
    draft = await deps.generator.generate(
        message=state["user_message"],
        pet=state.get("pet_context"),
        chunks=state.get("context_chunks", []) if state.get("needs_retrieval") else [],
        hardened=hardened,
        faults=deps.faults,
    )
    return {
        "draft": draft,
        "trace": _trace(
            "generation",
            "ok",
            f"Brouillon {'2 (consigne durcie)' if hardened else '1'} : "
            f"{len(draft.claims)} affirmation(s)",
            generator=deps.generator.name,
            prompt_version=deps.prompt_version,
            hardened=hardened,
            draft=draft.response_text,
            claims=[c.model_dump() for c in draft.claims],
        ),
    }


async def guardrail(state: AssistantState, runtime: Runtime[Deps]) -> Update:
    deps = runtime.context
    draft = state["draft"]
    verdict = await deps.guardrail.check(
        draft,
        GuardrailContext(
            user_message=state["user_message"],
            chunks=state.get("context_chunks", []) if state.get("needs_retrieval") else [],
            pet=state.get("pet_context"),
            alert=state.get("alert_context"),
        ),
    )
    retry = state.get("retry_count", 0) + (0 if verdict.passed else 1)
    grounded = sum(c.grounded and not c.diagnostic for c in verdict.checks)
    summary = (
        f"Validé : {grounded}/{len(verdict.checks)} affirmations sourcées"
        if verdict.passed
        else f"Rejeté : {verdict.reasons[0]}"
    )
    return {
        "verdict": verdict,
        "retry_count": retry,
        "trace": _trace(
            "guardrail",
            "ok" if verdict.passed else "rejected",
            summary,
            checks=[c.model_dump() for c in verdict.checks],
            reasons=verdict.reasons,
            escalation=verdict.escalation.model_dump(),
            retry_count=retry,
        ),
    }


# — Sorties cadrées —


async def safe_response(state: AssistantState) -> Update:
    tpl = SAFE_RESPONSES[state.get("intent", "out_of_scope")]
    return {
        "template_id": tpl.template_id,
        "trace": _trace(
            "safe_response", "ok", f"Texte fixe {tpl.template_id}", template_id=tpl.template_id
        ),
    }


async def safe_response_escalate(state: AssistantState) -> Update:
    tpl = SAFE_RESPONSES["diagnosis_request"]
    return {
        "template_id": tpl.template_id,
        "trace": _trace(
            "safe_response_escalate",
            "ok",
            f"Texte fixe {tpl.template_id} + vétérinaire",
            template_id=tpl.template_id,
        ),
    }


async def safe_fallback(state: AssistantState) -> Update:
    return {
        "template_id": FALLBACK.template_id,
        "trace": _trace(
            "safe_fallback",
            "ok",
            "Réponse de repli + vétérinaire",
            template_id=FALLBACK.template_id,
        ),
    }


# — Sortie unique —


def _citations(state: AssistantState) -> list[Citation]:
    draft, chunks = state.get("draft"), {c.chunk_id: c for c in state.get("context_chunks", [])}
    if draft is None:
        return []
    seen: dict[str, Citation] = {}
    for claim in draft.claims:
        for sid in claim.source_ids:
            if sid in seen:
                continue
            if sid == TELEMETRY_SOURCE:
                pet = state.get("pet_context")
                seen[sid] = Citation(source_id=sid, snippet=pet.describe() if pet else "")
            elif sid in chunks:
                c = chunks[sid]
                seen[sid] = Citation(source_id=sid, snippet=f"{c.source} · {c.section}")
    return list(seen.values())


async def finalize(state: AssistantState, runtime: Runtime[Deps]) -> Update:
    deps = runtime.context
    template_id = state.get("template_id")
    if template_id:
        tpl = next(t for t in [*SAFE_RESPONSES.values(), FALLBACK] if t.template_id == template_id)
        text, escalation, citations = tpl.text, tpl.escalation, []
    else:
        verdict = state["verdict"]
        text, escalation, citations = (
            state["draft"].response_text,
            verdict.escalation,
            _citations(state),
        )
        if escalation.urgency == "high":
            text = URGENT_PREFIX + text
    path = [t.node for t in state["trace"]] + ["finalize"]
    response = AssistantResponse(
        response_text=text,
        citations=citations,
        escalation=escalation or Escalation(),
        suggested_actions=(
            [SuggestedAction(label="Contacter un vétérinaire", action_id="open_vet_handoff")]
            if escalation.trigger
            else []
        ),
        metadata=ResponseMetadata(
            thread_id=state["thread_id"],
            turn_id=state["turn_id"],
            path=path,
            latency_ms=deps.elapsed_ms(),
            prompt_version=deps.prompt_version,
            template_id=template_id,
        ),
    )
    await deps.audit.write(
        {
            "thread_id": state["thread_id"],
            "turn_id": state["turn_id"],
            "pet_ref": state["pet_ref"],
            "input": state["user_message"],
            "faults": sorted(deps.faults),
            "trace": [t.model_dump() for t in state["trace"]],
            "response": response.model_dump(),
        }
    )
    return {
        "response": response,
        "trace": _trace("finalize", "ok", "Audit écrit, réponse émise", path=path),
    }


def metered(node: Callable[[AssistantState, Runtime[Deps]], Awaitable[Update]]) -> Any:
    """Ajoute à la trace du nœud les appels LLM qu'il a faits : modèles, tokens, coût."""

    @functools.wraps(node)
    async def wrapper(state: AssistantState, runtime: Runtime[Deps]) -> Update:
        with usage_scope() as used:
            update = await node(state, runtime)
        if used and update.get("trace"):
            last: NodeTrace = update["trace"][-1]
            usage = summarize(used)
            update["trace"] = [
                *update["trace"][:-1],
                last.model_copy(
                    update={"data": {**last.data, "llm": usage}, "cost_eur": usage["cost_eur"]}
                ),
            ]
        return update

    return wrapper
