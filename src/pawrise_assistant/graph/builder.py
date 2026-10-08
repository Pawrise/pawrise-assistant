"""Construction du graphe (conception §3.3).

Le routage est du code : chaque fonction `route_*` est pure et testée. Le LLM ne décide jamais du
nœud suivant (ADR-001).

Deux sortes d'échec, deux mécanismes :
- panne technique (exception) → `error_handler` par nœud, cible fixée dans `ON_ERROR` ;
- rejet du guardrail (pas une exception) → arête conditionnelle avec `retry_count`.
"""

from __future__ import annotations

from typing import Any, Literal

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.errors import NodeError
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command

from pawrise_assistant.domain.models import NodeStatus, NodeTrace
from pawrise_assistant.domain.state import AssistantState
from pawrise_assistant.graph import nodes
from pawrise_assistant.graph.deps import Deps
from pawrise_assistant.graph.nodes import metered, traced

MAIN = [
    "circuit_breaker",
    "query_understanding",
    "retrieval",
    "relevance_filter",
    "generation",
    "guardrail",
]
EXITS = ["safe_response", "safe_response_escalate", "safe_fallback"]

ON_ERROR: dict[str, tuple[str, str, dict[str, Any]]] = {
    # nœud: (cible, politique, écritures de repli)
    "circuit_breaker": ("safe_fallback", "fail-closed", {}),
    "query_understanding": ("retrieval", "fail-open", {"needs_retrieval": True}),
    "retrieval": ("relevance_filter", "fail-open", {"candidates": []}),
    "relevance_filter": ("generation", "fail-open", {}),
    "generation": ("safe_fallback", "fail-closed", {}),
    "guardrail": ("safe_fallback", "fail-closed", {}),
}


def route_intent(
    state: AssistantState,
) -> Literal["query_understanding", "safe_response", "safe_response_escalate"]:
    intent = state.get("intent")
    if intent == "clean":
        return "query_understanding"
    if intent == "diagnosis_request":
        return "safe_response_escalate"
    return "safe_response"


def route_retrieval(state: AssistantState) -> Literal["retrieval", "generation"]:
    return "retrieval" if state.get("needs_retrieval", True) else "generation"


def route_verdict(state: AssistantState) -> Literal["finalize", "generation", "safe_fallback"]:
    verdict = state.get("verdict")
    if verdict is not None and verdict.passed:
        return "finalize"
    return "generation" if state.get("retry_count", 0) <= 1 else "safe_fallback"


def _handler(node: str) -> Any:
    target, policy, fallback = ON_ERROR[node]

    async def handle(state: AssistantState, error: NodeError) -> Command[Any]:
        update: dict[str, Any] = dict(fallback)
        if node == "query_understanding":
            update["canonical_query"] = state["user_message"]
        if node == "relevance_filter":
            update["context_chunks"] = state.get("candidates", [])[: nodes.TOP_N]
        status: NodeStatus = "degraded" if policy == "fail-open" else "error"
        update["trace"] = [
            NodeTrace(
                node=node,
                status=status,
                summary=f"Échec ({policy}) : {error.error}",
                data={"error": repr(error.error), "policy": policy, "next": target},
            )
        ]
        return Command(goto=target, update=update)

    handle.__name__ = f"on_error_{node}"
    return handle


def build_graph(
    checkpointer: BaseCheckpointSaver[Any] | None = None,
) -> CompiledStateGraph[AssistantState, Deps, AssistantState, AssistantState]:
    g = StateGraph(AssistantState, context_schema=Deps)
    for name in MAIN:
        g.add_node(name, traced(name, metered(getattr(nodes, name))), error_handler=_handler(name))
    for name in EXITS:
        g.add_node(name, traced(name, getattr(nodes, name)))
    g.add_node("finalize", traced("finalize", nodes.finalize))

    g.add_edge(START, "circuit_breaker")
    g.add_conditional_edges("circuit_breaker", route_intent)
    g.add_conditional_edges("query_understanding", route_retrieval)
    g.add_edge("retrieval", "relevance_filter")
    g.add_edge("relevance_filter", "generation")
    g.add_edge("generation", "guardrail")
    g.add_conditional_edges("guardrail", route_verdict)
    for name in EXITS:
        g.add_edge(name, "finalize")
    g.add_edge("finalize", END)
    return g.compile(checkpointer=checkpointer)
