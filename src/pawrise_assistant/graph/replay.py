"""Rejouer un tour depuis un nœud (conception §8.4) — console seulement.

En prod, l'assistant reste sans état. En debug, le graphe a un checkpointer en mémoire
(`durability="sync"` : un point de reprise après chaque nœud) et l'on garde les 50 derniers tours.

Deux façons de repartir d'un nœud :
- le **réexécuter** (éventuellement avec d'autres pannes) : tout ce qui suit est recalculé ;
- **forcer sa sortie** (`overrides`) : le nœud n'est pas exécuté, ses écritures sont remplacées, et
  le routage repart de là. C'est ce qui permet de forcer une intention, par exemple.
"""

from __future__ import annotations

import inspect
from collections import OrderedDict
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.types import StateSnapshot
from pydantic import BaseModel, TypeAdapter, ValidationError

from pawrise_assistant.domain import models
from pawrise_assistant.domain.models import Intent, NodeTrace

KEEP_RUNS = 50

# Les écritures qu'on accepte de forcer, par nœud, avec leur type.
OVERRIDABLE: dict[str, dict[str, TypeAdapter[Any]]] = {
    "circuit_breaker": {"intent": TypeAdapter(Intent)},
    "query_understanding": {
        "needs_retrieval": TypeAdapter(bool),
        "canonical_query": TypeAdapter(str),
    },
}


class ReplayError(LookupError):
    pass


def debug_checkpointer() -> InMemorySaver:
    """Checkpointer en mémoire qui n'accepte de désérialiser que nos propres modèles."""
    allowed = [
        (models.__name__, name)
        for name, obj in vars(models).items()
        if inspect.isclass(obj) and issubclass(obj, BaseModel) and obj.__module__ == models.__name__
    ]
    return InMemorySaver(serde=JsonPlusSerializer(allowed_msgpack_modules=allowed))


class RunRegistry:
    """run_id → configuration du dernier checkpoint du tour (sa « tête »)."""

    def __init__(self, saver: InMemorySaver, keep: int = KEEP_RUNS) -> None:
        self.saver, self.keep = saver, keep
        self._heads: OrderedDict[str, RunnableConfig] = OrderedDict()
        self._threads: OrderedDict[str, None] = OrderedDict()

    def record(self, run_id: str, head: RunnableConfig) -> None:
        self._heads[run_id] = head
        self._heads.move_to_end(run_id)
        thread = head.get("configurable", {})["thread_id"]
        self._threads[thread] = None
        self._threads.move_to_end(thread)
        while len(self._heads) > self.keep:
            self._heads.popitem(last=False)
        while len(self._threads) > self.keep:
            old, _ = self._threads.popitem(last=False)
            self.saver.delete_thread(old)

    def head(self, run_id: str) -> RunnableConfig:
        try:
            return self._heads[run_id]
        except KeyError as e:
            raise ReplayError(f"tour inconnu ou expiré : {run_id}") from e


async def lineage(graph: Any, head: RunnableConfig) -> list[StateSnapshot]:
    """Les checkpoints d'un tour, du premier au dernier, en suivant les parents (branches exclues)."""
    chain: list[StateSnapshot] = []
    config: RunnableConfig | None = head
    while config is not None:
        snap = await graph.aget_state(config)
        chain.append(snap)
        config = snap.parent_config
    return list(reversed(chain))


async def fork_config(
    graph: Any,
    head: RunnableConfig,
    node: str,
    attempt: int,
    overrides: dict[str, Any] | None,
) -> RunnableConfig:
    """La configuration à partir de laquelle relancer le graphe (`astream(None, config)`)."""
    before = [s for s in await lineage(graph, head) if s.next == (node,)]
    if len(before) < attempt:
        raise ReplayError(f"le nœud {node} n'a pas eu de passage n°{attempt} dans ce tour")
    config: RunnableConfig = before[attempt - 1].config
    if not overrides:
        return config
    allowed = OVERRIDABLE.get(node)
    if not allowed or not set(overrides) <= set(allowed):
        raise ReplayError(f"valeurs forçables pour {node} : {sorted(allowed or [])}")
    try:
        values: dict[str, Any] = {k: allowed[k].validate_python(v) for k, v in overrides.items()}
    except ValidationError as e:
        raise ReplayError(f"valeur forcée invalide : {e.errors()[0]['msg']}") from e
    values["trace"] = [
        NodeTrace(
            node=node,
            status="ok" if values.get("intent", "clean") == "clean" else "redirected",
            summary="Sortie forcée depuis la console",
            data={"forced": values.copy()},
        )
    ]
    updated: RunnableConfig = await graph.aupdate_state(config, values, as_node=node)
    return updated
