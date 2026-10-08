"""Construction du graphe (conception §3.3).

Le routage est du code : chaque fonction `route_*` est pure et testée. Le LLM ne décide jamais du
nœud suivant (ADR-001).

Le tri (nœud 1) et la reformulation (nœud 2) tournent en parallèle : la reformulation est
spéculative, et son résultat est jeté si le tri arrête la demande. On gagne la durée d'un appel
LLM sur chaque tour. Le masquage des PII passe donc avant les deux, dans un nœud déterministe, et
la jonction `gate` attend les deux branches avant d'aiguiller.

Deux sortes d'échec, deux mécanismes :
- panne technique (exception) → `error_handler` par nœud, cible fixée dans `ON_ERROR` ;
- rejet du guardrail (pas une exception) → arête conditionnelle avec `retry_count`.
"""

from __future__ import annotations

import functools
from typing import Any, Literal

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.errors import NodeError
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command

from pawrise_assistant.components.guardrail import is_urgent
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
PARALLEL = {"circuit_breaker", "query_understanding"}
EXITS = ["safe_response", "safe_response_escalate", "safe_fallback"]

ON_ERROR: dict[str, tuple[str, str, dict[str, Any]]] = {
    # nœud: (cible, politique, écritures de repli)
    "circuit_breaker": ("gate", "fail-closed", {"classifier_failed": True}),
    "query_understanding": ("gate", "fail-open", {"needs_retrieval": True}),
    "retrieval": ("relevance_filter", "fail-open", {"candidates": []}),
    "relevance_filter": ("generation", "fail-open", {}),
    "generation": ("safe_fallback", "fail-closed", {}),
    "guardrail": ("safe_fallback", "fail-closed", {}),
}


def route_gate(
    state: AssistantState,
) -> Literal["retrieval", "generation", "safe_response", "safe_response_escalate", "safe_fallback"]:
    """Le tri décide ; la reformulation ne sert que si le message est à traiter."""
    if is_urgent(state["user_message"]):
        return "safe_response_escalate"  # urgence : texte fixe immédiat, quel que soit le tri
    if state.get("classifier_failed") or "intent" not in state:
        return "safe_fallback"  # tri en panne : on échoue fermé
    intent = state["intent"]
    if intent == "diagnosis_request":
        return "safe_response_escalate"
    if intent != "clean":
        return "safe_response"
    return "retrieval" if state.get("needs_retrieval", True) else "generation"


def route_verdict(state: AssistantState) -> Literal["finalize", "generation", "safe_fallback"]:
    verdict = state.get("verdict")
    if verdict is not None and verdict.passed:
        return "finalize"
    return "generation" if state.get("retry_count", 0) <= 1 else "safe_fallback"


def _fallback(node: str, state: AssistantState, error: BaseException) -> dict[str, Any]:
    """Les écritures de repli d'un nœud en panne, selon sa politique (`ON_ERROR`)."""
    target, policy, fallback = ON_ERROR[node]
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
            summary=f"Échec ({policy}) : {error}",
            data={"error": repr(error), "policy": policy, "next": target},
        )
    ]
    return update


def _handler(node: str) -> Any:
    """`error_handler` LangGraph, pour les nœuds qui s'exécutent seuls dans leur étape."""

    async def handle(state: AssistantState, error: NodeError) -> Command[Any]:
        return Command(goto=ON_ERROR[node][0], update=_fallback(node, state, error.error))

    handle.__name__ = f"on_error_{node}"
    return handle


def _catching(node: str, fn: Any) -> Any:
    """Pour les nœuds parallèles : en LangGraph 1.2.14, l'`error_handler` d'un nœud qui tourne en
    parallèle d'un autre n'est pas appelé, l'exception fait tomber le tour (reproduit le
    2026-10-08). Le nœud rattrape donc lui-même sa panne, avec la même politique ; la jonction
    `gate` route ensuite."""

    @functools.wraps(fn)
    async def wrapper(state: AssistantState, runtime: Any) -> dict[str, Any]:
        try:
            result: dict[str, Any] = await fn(state, runtime)
            return result
        except Exception as e:
            return _fallback(node, state, e)

    return wrapper


def build_graph(
    checkpointer: BaseCheckpointSaver[Any] | None = None,
) -> CompiledStateGraph[AssistantState, Deps, AssistantState, AssistantState]:
    g = StateGraph(AssistantState, context_schema=Deps)
    g.add_node("redact", traced("redact", nodes.redact))
    for name in MAIN:
        fn = metered(getattr(nodes, name))
        if name in PARALLEL:
            g.add_node(name, traced(name, _catching(name, fn)))
        else:
            g.add_node(name, traced(name, fn), error_handler=_handler(name))
    # Déclarée après les nœuds qu'elle attend : la disposition du graphe suit cet ordre.
    g.add_node("gate", traced("gate", nodes.gate))
    for name in EXITS:
        g.add_node(name, traced(name, getattr(nodes, name)))
    g.add_node("finalize", traced("finalize", nodes.finalize))

    g.add_edge(START, "redact")
    g.add_edge("redact", "circuit_breaker")
    g.add_edge("redact", "query_understanding")
    g.add_edge(["circuit_breaker", "query_understanding"], "gate")
    g.add_conditional_edges("gate", route_gate)
    g.add_edge("retrieval", "relevance_filter")
    g.add_edge("relevance_filter", "generation")
    g.add_edge("generation", "guardrail")
    g.add_conditional_edges("guardrail", route_verdict)
    for name in EXITS:
        g.add_edge(name, "finalize")
    g.add_edge("finalize", END)
    return g.compile(checkpointer=checkpointer)
