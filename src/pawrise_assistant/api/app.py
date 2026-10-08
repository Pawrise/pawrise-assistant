"""Service HTTP de l'assistant.

- `POST /v1/turns` : l'API de prod, appelée par dialog. Un tour entre, une réponse JSON sort.
- `GET /graph` : la topologie du graphe compilé, pour la console.
- `POST /debug/runs` : le même tour, en flux SSE nœud par nœud, avec pannes injectables.
  Désactivé quand `PAWRISE_DEBUG_API=false`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from pawrise_assistant.api.events import EventMapper, RunStarted, map_stream
from pawrise_assistant.api.scenarios import SCENARIOS, Scenario
from pawrise_assistant.api.settings import Settings
from pawrise_assistant.components.audit import JsonlAuditSink
from pawrise_assistant.core_api.client import HttpCoreApi
from pawrise_assistant.domain.models import AlertContext, AssistantResponse, Turn, TurnRequest
from pawrise_assistant.domain.state import AssistantState
from pawrise_assistant.graph.builder import build_graph
from pawrise_assistant.graph.deps import FAULTS, Deps, dev_deps
from pawrise_assistant.graph.topology import Topology, build_topology


class DebugRunRequest(BaseModel):
    user_message: str = Field(min_length=1, max_length=4000)
    pet_ref: str = "pet_demo_rex"
    alert_context: AlertContext | None = None
    history: list[Turn] = Field(default_factory=list)
    faults: list[str] = Field(default_factory=list)


def initial_state(req: TurnRequest) -> AssistantState:
    return {
        "thread_id": req.thread_id,
        "turn_id": req.turn_id,
        "pet_ref": req.pet_ref,
        "user_message": req.user_message,
        "history": list(req.history),
        "alert_context": req.alert_context,
        "retry_count": 0,
        "trace": [],
    }


def create_app(settings: Settings | None = None, deps: Deps | None = None) -> FastAPI:
    settings = settings or Settings()
    if deps is None:
        deps = dev_deps(audit=JsonlAuditSink(settings.audit_path), corpus_dir=settings.corpus_dir)
        if settings.core_api_url:
            from dataclasses import replace

            deps = replace(deps, core_api=HttpCoreApi(settings.core_api_url))
    graph = build_graph()
    topology = build_topology(graph)

    app = FastAPI(title="Pawrise Assistant", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/turns")
    async def turns(req: TurnRequest) -> AssistantResponse:
        out = await graph.ainvoke(initial_state(req), context=deps.for_run())
        response: AssistantResponse = out["response"]
        return response

    @app.get("/graph")
    async def graph_topology() -> Topology:
        return topology

    if not settings.debug_api:
        return app

    @app.get("/debug/scenarios")
    async def scenarios() -> list[Scenario]:
        return SCENARIOS

    @app.get("/debug/faults")
    async def faults() -> list[str]:
        return sorted(FAULTS)

    @app.post("/debug/runs")
    async def debug_run(req: DebugRunRequest) -> EventSourceResponse:
        try:
            run_deps = deps.for_run(frozenset(req.faults))
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        mapper = EventMapper()
        turn = TurnRequest(
            thread_id=f"debug-{mapper.run_id}",
            turn_id="t1",
            pet_ref=req.pet_ref,
            user_message=req.user_message,
            history=req.history,
            alert_context=req.alert_context,
        )

        async def stream() -> AsyncIterator[dict[str, Any]]:
            yield _sse(RunStarted(run_id=mapper.run_id, input=req.model_dump(mode="json")))
            parts = graph.astream(
                initial_state(turn),
                context=run_deps,
                stream_mode=["updates", "tasks"],
                version="v2",
            )
            async for event in map_stream(parts, mapper):
                yield _sse(event)

        return EventSourceResponse(stream())

    return app


def _sse(event: BaseModel) -> dict[str, Any]:
    return {"event": event.type, "data": event.model_dump_json()}  # type: ignore[attr-defined]
