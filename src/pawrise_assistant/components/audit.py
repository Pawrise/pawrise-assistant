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


def _summary(e: dict[str, Any]) -> dict[str, Any]:
    r = e["response"]
    meta = r.get("metadata", {})
    return {
        "ts": e.get("ts"),
        "thread_id": e.get("thread_id"),
        "turn_id": e.get("turn_id"),
        "pet_ref": e.get("pet_ref"),
        "input": e.get("input"),
        "faults": e.get("faults", []),
        "path": meta.get("path", []),
        "template_id": meta.get("template_id"),
        "escalation": r.get("escalation"),
        "latency_ms": meta.get("latency_ms"),
        "response_text": r.get("response_text"),
    }
