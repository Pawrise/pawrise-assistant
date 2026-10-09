"""Service HTTP de l'assistant.

- `POST /v1/turns` : l'API de prod, appelée par dialog. Un tour entre, une réponse JSON sort.
- `POST /v1/turns/stream` : le même tour en SSE, avec des phrases d'attente (« Je vérifie la
  réponse… ») puis la réponse vérifiée.
- `GET /graph` : la topologie du graphe compilé, pour la console.
- `POST /debug/runs` : le même tour, en flux SSE nœud par nœud, avec pannes injectables.
- `POST /debug/runs/{id}/fork` : rejoue un tour depuis un nœud, en le réexécutant ou en forçant
  sa sortie. Les routes /debug sont désactivées quand `PAWRISE_DEBUG_API=false`.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import AsyncIterator
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from pawrise_assistant import tracing
from pawrise_assistant.api.events import (
    EventMapper,
    RunStarted,
    TurnAnswer,
    map_stream,
    new_run_id,
    owner_stream,
    reused_steps,
)
from pawrise_assistant.api.scenarios import SCENARIOS, Scenario
from pawrise_assistant.api.settings import Settings
from pawrise_assistant.api.workbench import workbench_router
from pawrise_assistant.components.audit import JsonlAuditSink
from pawrise_assistant.core_api import fake_data
from pawrise_assistant.core_api.client import InMemoryCoreApi
from pawrise_assistant.domain.models import AlertContext, AssistantResponse, Turn, TurnRequest
from pawrise_assistant.domain.state import AssistantState
from pawrise_assistant.graph.builder import build_graph
from pawrise_assistant.graph.deps import FAULTS, Deps
from pawrise_assistant.graph.replay import ReplayError, RunRegistry, debug_checkpointer, fork_config
from pawrise_assistant.graph.topology import Topology, build_handoff_topology, build_topology
from pawrise_assistant.handoff.graph import (
    HandoffInvalid,
    build_handoff_graph,
    generate_handoff_summary,
)
from pawrise_assistant.handoff.models import HandoffRequest, HandoffSummary
from pawrise_assistant.knowledge import KnowledgeBase
from pawrise_assistant.wiring import build_deps


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
    if settings.otel:
        tracing.setup()
    if deps is None:
        deps = build_deps(settings, JsonlAuditSink(settings.audit_path))
    graph = build_graph()
    handoff_graph = build_handoff_graph()
    topologies = {"turn": build_topology(graph), "handoff": build_handoff_topology(handoff_graph)}

    app = FastAPI(title="Pawrise Assistant", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/turns")
    async def turns(req: TurnRequest, request: Request) -> AssistantResponse:
        with tracing.turn_span(
            "turn", request.headers, **{"pawrise.thread_id": req.thread_id}
        ) as span:
            out = await graph.ainvoke(initial_state(req), context=deps.for_run())
            response: AssistantResponse = out["response"]
            span.set_attribute("pawrise.path", response.metadata.path)
            span.set_attribute("pawrise.escalation", response.escalation.trigger)
            return response

    @app.post("/v1/turns/stream")
    async def turns_stream(req: TurnRequest, request: Request) -> EventSourceResponse:
        async def stream() -> AsyncIterator[dict[str, Any]]:
            with tracing.turn_span(
                "turn", request.headers, **{"pawrise.thread_id": req.thread_id}
            ) as span:
                parts = graph.astream(
                    initial_state(req),
                    context=deps.for_run(),
                    stream_mode=["updates", "tasks"],
                    version="v2",
                )
                async for event in owner_stream(map_stream(parts, EventMapper())):
                    if isinstance(event, TurnAnswer):
                        span.set_attribute("pawrise.path", event.response.metadata.path)
                    yield _sse(event)

        return EventSourceResponse(stream(), ping=15)

    @app.post("/v1/handoff-summaries")
    async def handoff_summaries(req: HandoffRequest, request: Request) -> HandoffSummary:
        with tracing.turn_span("handoff", request.headers, **{"pawrise.thread_id": req.thread_id}):
            try:
                return await generate_handoff_summary(handoff_graph, req, deps.for_run())
            except HandoffInvalid as e:
                raise HTTPException(422, f"dossier non conforme : {e}") from e

    @app.get("/graph")
    async def graph_topology(name: Literal["turn", "handoff"] = "turn") -> Topology:
        return topologies[name]

    if not settings.debug_api:
        return app

    @app.post("/debug/handoff-runs")
    async def debug_handoff(req: HandoffRequest) -> EventSourceResponse:
        started = RunStarted(run_id=new_run_id(), input=req.model_dump(mode="json"))
        mapper = EventMapper(run_id=started.run_id)

        async def stream() -> AsyncIterator[dict[str, Any]]:
            yield _sse(started)
            parts = handoff_graph.astream(
                {"request": req, "trace": []},
                context=deps.for_run(),
                stream_mode=["updates", "tasks"],
                version="v2",
            )
            async for event in map_stream(parts, mapper):
                yield _sse(event)

        return EventSourceResponse(stream())

    kb = deps.retriever if isinstance(deps.retriever, KnowledgeBase) else None
    app.include_router(workbench_router(settings, deps))

    @app.get("/debug/info")
    async def info() -> dict[str, Any]:
        """Ce qui tourne, pour l'en-tête de la console, et les chiens de démonstration."""
        ai = settings.llm == "openai"
        return {
            "ai": ai,
            "models": [settings.llm_model_nano, settings.llm_model_main] if ai else [],
            "retriever": settings.retriever,
            "embedder": kb.embedder if kb else None,
            "reranker": deps.reranker.name,
            "knowledge_editable": kb is not None,
            "pets_editable": isinstance(deps.core_api, InMemoryCoreApi),
            # Le modèle utilisé à chaque étape, pour la console. Vide en mode sans IA.
            "step_models": (
                {
                    "circuit_breaker": {
                        "model": settings.llm_model_nano,
                        "note": "si les règles ne suffisent pas",
                    },
                    "query_understanding": {"model": settings.llm_model_nano, "note": None},
                    "generation": {
                        "model": settings.llm_model_main,
                        "note": f"politesse : {settings.llm_model_nano}",
                    },
                    "guardrail": {"model": settings.llm_model_nano, "note": "après les règles"},
                    **(
                        {
                            "retrieval": {
                                "model": kb.embedder,
                                "note": "pour la recherche par le sens",
                            }
                        }
                        if kb and settings.embedder == "openai"
                        else {}
                    ),
                }
                if ai
                else {}
            ),
            "pets": [
                {"pet_ref": p.pet_ref, "name": p.name, "breed": p.breed, "age_years": p.age_years}
                for p in fake_data.PROFILES.values()
            ],
        }

    @app.get("/debug/scenarios")
    async def scenarios() -> list[Scenario]:
        return SCENARIOS

    @app.get("/debug/faults")
    async def faults() -> list[str]:
        return sorted(FAULTS)

    saver = debug_checkpointer()
    debug_graph = build_graph(checkpointer=saver)
    registry = RunRegistry(saver)

    def _deps(faults: list[str]) -> Deps:
        try:
            return deps.for_run(frozenset(faults))
        except ValueError as e:
            raise HTTPException(422, str(e)) from e

    def _stream(
        graph_input: Any, config: RunnableConfig, run_deps: Deps, started: RunStarted
    ) -> EventSourceResponse:
        prior = Counter(step.node for step in started.reused)
        mapper = EventMapper(run_id=started.run_id, prior=prior)
        thread: RunnableConfig = {
            "configurable": {"thread_id": config.get("configurable", {})["thread_id"]}
        }

        async def stream() -> AsyncIterator[dict[str, Any]]:
            yield _sse(started)
            parts = debug_graph.astream(
                graph_input,
                config,
                context=run_deps,
                stream_mode=["updates", "tasks"],
                version="v2",
                durability="sync",
            )
            async for event in map_stream(parts, mapper):
                yield _sse(event)
            registry.record(started.run_id, (await debug_graph.aget_state(thread)).config)

        return EventSourceResponse(stream())

    @app.post("/debug/runs")
    async def debug_run(req: DebugRunRequest) -> EventSourceResponse:
        run_deps = _deps(req.faults)
        run_id = new_run_id()
        turn = TurnRequest(
            thread_id=f"debug-{run_id}",
            turn_id="t1",
            pet_ref=req.pet_ref,
            user_message=req.user_message,
            history=req.history,
            alert_context=req.alert_context,
        )
        started = RunStarted(run_id=run_id, input=req.model_dump(mode="json"))
        config: RunnableConfig = {"configurable": {"thread_id": run_id}}
        return _stream(initial_state(turn), config, run_deps, started)

    @app.post("/debug/runs/{run_id}/fork")
    async def fork_run(run_id: str, req: ForkRequest) -> EventSourceResponse:
        run_deps = _deps(req.faults)
        try:
            config = await fork_config(
                debug_graph, registry.head(run_id), req.node, req.attempt, req.overrides
            )
        except ReplayError as e:
            raise HTTPException(404 if "inconnu" in str(e) else 422, str(e)) from e
        state = await debug_graph.aget_state(config)
        started = RunStarted(
            run_id=new_run_id(),
            input={"faults": req.faults, "overrides": req.overrides},
            fork_of=run_id,
            from_node=req.node,
            from_attempt=req.attempt,
            reused=reused_steps(state.values.get("trace", [])),
        )
        return _stream(None, config, run_deps, started)

    return app


class ForkRequest(BaseModel):
    node: str
    attempt: int = Field(default=1, ge=1)
    overrides: dict[str, Any] | None = None
    faults: list[str] = Field(default_factory=list)


def _sse(event: BaseModel) -> dict[str, Any]:
    return {"event": event.type, "data": event.model_dump_json()}  # type: ignore[attr-defined]
