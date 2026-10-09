"""Audit de la cognition (ADR-010), écrit par `finalize` et lui seul.

Dev : JSONL. Prod : stockage objet avec Object Lock (lot 7), même interface.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Protocol


class AuditSink(Protocol):
    async def write(self, event: dict[str, Any]) -> None: ...


class JsonlAuditSink:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)

    async def write(self, event: dict[str, Any]) -> None:
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")


class MemoryAuditSink:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    async def write(self, event: dict[str, Any]) -> None:
        self.events.append(event)


def recent(sink: AuditSink, limit: int = 50) -> list[dict[str, Any]]:
    """Les derniers tours audités, du plus récent au plus ancien, résumés pour la console.

    Les dossiers de handoff, écrits dans le même journal, n'y figurent pas : ce sont des tours de
    conversation qu'on veut relire.
    """
    if isinstance(sink, MemoryAuditSink):
        raw = list(sink.events)
    elif isinstance(sink, JsonlAuditSink) and sink.path.exists():
        lines = sink.path.read_text(encoding="utf-8").splitlines()
        raw = [json.loads(line) for line in lines if line.strip()]
    else:
        raw = []
    turns = [e for e in raw if "response" in e][-limit:]
    return [_summary(e) for e in reversed(turns)]


_REFUSALS = {"SR-JB-01", "SR-ABUSE-01", "SR-OOS-01"}


def _outcome(template_id: str | None, escalation: dict[str, Any]) -> str:
    """L'issue d'un tour, en cinq catégories lisibles par la console."""
    if escalation.get("urgency") == "high":
        return "urgent"
    if template_id == "SR-FALLBACK-02":
        return "careful"
    if template_id == "SR-DIAG-01":
        return "diagnosis"
    if template_id in _REFUSALS:
        return "refusal"
    return "answered"


def _why(reason: str) -> str:
    """La raison d'un rejet, dite simplement."""
    if reason.startswith("langage diagnostique"):
        return "ressemblait à un diagnostic"
    if reason.startswith("donnée masquée"):
        return "citait une donnée masquée"
    return "aucune source ne le dit"


def _rejections(trace: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Chaque phrase refusée par la vérification, avec le brouillon et la raison."""
    # Une phrase refusée pour deux raisons n'apparaît qu'une fois, avec la plus grave.
    rank = {"ressemblait à un diagnostic": 0, "citait une donnée masquée": 1}
    found: dict[tuple[int, str], str] = {}
    attempt = 0
    for t in trace:
        if t.get("node") != "guardrail":
            continue
        attempt += 1
        if t.get("status") != "rejected":
            continue
        for reason in t.get("data", {}).get("reasons", []):
            text = reason.split("« ", 1)[-1].rsplit(" »", 1)[0] if "« " in reason else reason
            why = _why(reason)
            known = found.get((attempt, text))
            if known is None or rank.get(why, 9) < rank.get(known, 9):
                found[(attempt, text)] = why
    return [{"attempt": a, "why": why, "text": text} for (a, text), why in found.items()]


def _summary(e: dict[str, Any]) -> dict[str, Any]:
    """Un tour, tel que le journal de la console le raconte."""
    r = e["response"]
    meta = r.get("metadata", {})
    trace: list[dict[str, Any]] = e.get("trace", [])
    by_node = {t.get("node"): t.get("data", {}) for t in trace}
    usage = [t["data"]["llm"] for t in trace if t.get("data", {}).get("llm")]
    escalation = r.get("escalation") or {}
    return {
        "ts": e.get("ts"),
        "thread_id": e.get("thread_id"),
        "turn_id": e.get("turn_id"),
        "pet_ref": e.get("pet_ref"),
        "input": e.get("input"),
        "faults": e.get("faults", []),
        "path": meta.get("path", []),
        "template_id": meta.get("template_id"),
        "escalation": escalation,
        "latency_ms": meta.get("latency_ms"),
        "response_text": r.get("response_text"),
        "outcome": _outcome(meta.get("template_id"), escalation),
        "intent": by_node.get("circuit_breaker", {}).get("intent"),
        "small_talk": by_node.get("query_understanding", {}).get("needs_retrieval") is False,
        "rejections": _rejections(trace),
        "pii": by_node.get("redact", {}).get("pii_redacted") or {},
        "citations": r.get("citations", []),
        "ai_calls": len(usage),
        "models": sorted({m for u in usage for m in u.get("models", [])}),
        "cost_eur": round(sum(u.get("cost_eur", 0) for u in usage), 6),
        "prompt_version": meta.get("prompt_version"),
    }
