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
