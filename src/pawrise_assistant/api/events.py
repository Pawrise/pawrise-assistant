"""Contrat du flux de debug consommé par la console (conception §8.3).

Noms calqués sur AG-UI (RUN_STARTED, STEP_STARTED…) pour pouvoir migrer plus tard sans casse.
Ce flux n'est pas l'API de prod : il expose des brouillons et des scores internes.

On lit les modes `updates` et `tasks` de LangGraph, pas `custom` : en 1.2.14, `custom` combiné à
un `error_handler` relance l'exception rattrapée en fin de tour (constaté le 2026-10-08).
"""

from __future__ import annotations

import time
import uuid
from collections import Counter
from collections.abc import AsyncIterator
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from pawrise_assistant.domain.models import AssistantResponse, NodeTrace

ERROR_HANDLER_PREFIX = "__error_handler__"


class RunStarted(BaseModel):
    type: Literal["run_started"] = "run_started"
    run_id: str
    ts_ms: int = 0
    input: dict[str, Any]


class NodeStarted(BaseModel):
    type: Literal["node_started"] = "node_started"
    node: str
    attempt: int
    ts_ms: int


class NodeFinished(BaseModel):
    type: Literal["node_finished"] = "node_finished"
    node: str
    attempt: int
    ts_ms: int
    duration_ms: int
    status: str
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)
    recovered_to: str | None = None
    """Renseigné quand le nœud a levé une exception et que son error_handler a routé ailleurs."""


class RunFinished(BaseModel):
    type: Literal["run_finished"] = "run_finished"
    ts_ms: int
    response: AssistantResponse


class RunError(BaseModel):
    type: Literal["run_error"] = "run_error"
    ts_ms: int
    message: str


DebugEvent = Annotated[
    RunStarted | NodeStarted | NodeFinished | RunFinished | RunError, Field(discriminator="type")
]


class EventMapper:
    """Traduit les `StreamPart` v2 de LangGraph en événements de console."""

    def __init__(self) -> None:
        self.t0 = time.perf_counter()
        self.run_id = uuid.uuid4().hex[:12]
        self.attempts: Counter[str] = Counter()
        self.started: dict[str, tuple[str, int, int]] = {}  # task id → (node, attempt, ts)
        self.failed: dict[str, NodeFinished] = {}  # nœud → fin en erreur, en attente du handler
        self.final: RunFinished | None = None

    def now(self) -> int:
        return round((time.perf_counter() - self.t0) * 1000)

    def map(self, part: dict[str, Any]) -> list[BaseModel]:
        if part["type"] == "updates":
            for node, update in (part["data"] or {}).items():
                if node == "finalize" and isinstance(update, dict) and "response" in update:
                    self.final = RunFinished(ts_ms=self.now(), response=update["response"])
            return []
        if part["type"] != "tasks":
            return []
        data = part["data"]
        name: str = data["name"]
        if "input" in data:  # début de tâche
            if name.startswith(ERROR_HANDLER_PREFIX):
                return []
            self.attempts[name] += 1
            self.started[data["id"]] = (name, self.attempts[name], self.now())
            return [NodeStarted(node=name, attempt=self.attempts[name], ts_ms=self.now())]

        # fin de tâche
        if name.startswith(ERROR_HANDLER_PREFIX):
            node = name.removeprefix(ERROR_HANDLER_PREFIX)
            pending = self.failed.pop(node, None)
            trace = _last_trace(data.get("result"))
            if pending is None:
                return []
            if trace is not None:
                pending.status, pending.summary = trace.status, trace.summary
                pending.data = trace.data
                pending.recovered_to = trace.data.get("next")
            return [pending]
        node, attempt, ts = self.started.pop(data["id"], (name, self.attempts[name], self.now()))
        end = self.now()
        error = data.get("error")
        if error is not None:
            self.failed[node] = NodeFinished(
                node=node,
                attempt=attempt,
                ts_ms=end,
                duration_ms=end - ts,
                status="error",
                summary=str(error),
                data={"error": repr(error)},
            )
            return []
        trace = _last_trace(data.get("result"))
        return [
            NodeFinished(
                node=node,
                attempt=attempt,
                ts_ms=end,
                duration_ms=end - ts,
                status=trace.status if trace else "ok",
                summary=trace.summary if trace else "",
                data=trace.data if trace else {},
            )
        ]


def _last_trace(result: Any) -> NodeTrace | None:
    if isinstance(result, dict):
        traces = result.get("trace") or []
        if traces and isinstance(traces[-1], NodeTrace):
            return traces[-1]
    return None


async def map_stream(parts: AsyncIterator[Any], mapper: EventMapper) -> AsyncIterator[BaseModel]:
    try:
        async for part in parts:
            for event in mapper.map(part):
                yield event
        if mapper.final is not None:  # émis en dernier, après la fin de `finalize`
            mapper.final.ts_ms = mapper.now()
            yield mapper.final
        else:
            yield RunError(ts_ms=mapper.now(), message="tour terminé sans réponse")
    except Exception as e:  # le flux de debug ne casse jamais sans le dire
        yield RunError(ts_ms=mapper.now(), message=repr(e))
