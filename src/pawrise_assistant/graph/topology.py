"""Topologie exposée à la console (`GET /graph`).

Les nœuds et arêtes viennent du graphe compilé, jamais d'un schéma dessiné à la main. Ce module
n'ajoute que ce que LangGraph ne sait pas : les libellés humains, la politique d'échec et le libellé
de chaque condition. Un test vérifie que chaque arête conditionnelle a son libellé.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

from pawrise_assistant.graph.builder import ON_ERROR

NodeKind = Literal["terminal", "step", "exit", "output", "tool"]


class NodeMeta(BaseModel):
    id: str
    label: str
    kind: NodeKind
    role: str
    on_error: str | None = None
    step: int | None = None


class EdgeMeta(BaseModel):
    source: str
    target: str
    kind: Literal["normal", "conditional", "error", "tool"]
    label: str | None = None


class Topology(BaseModel):
    nodes: list[NodeMeta]
    edges: list[EdgeMeta]


NODE_META: dict[str, tuple[str, NodeKind, str, int | None]] = {
    "__start__": ("Début", "terminal", "Un tour arrive de dialog.", None),
    "circuit_breaker": (
        "Comprendre la demande",
        "step",
        "Trie le message. Diagnostic ou détournement : arrêt ici.",
        1,
    ),
    "query_understanding": (
        "Reformuler",
        "step",
        "Reformule en termes vétérinaires et charge les données du chien.",
        2,
    ),
    "retrieval": ("Chercher", "step", "Cherche 20 passages dans la base vétérinaire.", 3),
    "relevance_filter": ("Garder l'utile", "step", "Garde les 5 passages les plus utiles.", 4),
    "generation": ("Rédiger", "step", "Rédige à partir des seuls passages et données fournis.", 5),
    "guardrail": (
        "Vérifier",
        "step",
        "Chaque affirmation doit avoir une source. Sinon, 2ᵉ essai puis repli.",
        6,
    ),
    "safe_response": (
        "Réponse encadrée",
        "exit",
        "Texte écrit à l'avance, sans vétérinaire.",
        None,
    ),
    "safe_response_escalate": (
        "Encadrée + vétérinaire",
        "exit",
        "Texte écrit à l'avance, vétérinaire proposé.",
        None,
    ),
    "safe_fallback": (
        "Réponse de repli",
        "exit",
        "Après deux rejets ou une panne : texte prudent + vétérinaire.",
        None,
    ),
    "finalize": (
        "Sortie unique",
        "output",
        "Toutes les réponses passent ici et sont enregistrées.",
        None,
    ),
    "__end__": ("Fin", "terminal", "La réponse part vers dialog.", None),
    "core_api": ("Core API", "tool", "Profil, collier et alertes du chien (lecture seule).", None),
}

EDGE_LABELS: dict[tuple[str, str], str] = {
    ("circuit_breaker", "query_understanding"): "à traiter",
    ("circuit_breaker", "safe_response"): "abus · détournement · hors sujet",
    ("circuit_breaker", "safe_response_escalate"): "diagnostic",
    ("query_understanding", "retrieval"): "recherche utile",
    ("query_understanding", "generation"): "rien à chercher",
    ("guardrail", "finalize"): "validé",
    ("guardrail", "generation"): "rejeté → 2ᵉ essai",
    ("guardrail", "safe_fallback"): "rejeté 2 fois",
}


HANDOFF_META: dict[str, tuple[str, NodeKind, str, int | None]] = {
    "__start__": ("Début", "terminal", "dialog demande le dossier au moment du handoff.", None),
    "collect": ("Collecter", "step", "Profil, 7 jours de collier et alertes de la période.", 1),
    "timeline": ("Chronologie", "step", "Range les événements par date. Aucun modèle ici.", 2),
    "synthesize": ("Synthétiser", "step", "Motif, propos du propriétaire, urgence.", 3),
    "verify": (
        "Vérifier",
        "step",
        "Chaque élément doit avoir une source ; aucun langage diagnostique.",
        4,
    ),
    "finalize": ("Sortie unique", "output", "Audit écrit, dossier JSON émis.", None),
    "__end__": ("Fin", "terminal", "Le dossier part vers dialog, puis File & Export.", None),
    "core_api": ("Core API", "tool", "Profil, collier et alertes du chien (lecture seule).", None),
}


def build_handoff_topology(graph: Any) -> Topology:
    topo = _from_graph(graph, HANDOFF_META, on_error={})
    topo.edges.append(EdgeMeta(source="collect", target="core_api", kind="tool", label="3 outils"))
    return topo


def _from_graph(
    graph: Any,
    meta: dict[str, tuple[str, NodeKind, str, int | None]],
    on_error: dict[str, tuple[str, str, dict[str, Any]]],
) -> Topology:
    drawn = graph.get_graph()
    nodes = []
    for node_id in drawn.nodes:
        if node_id.startswith("__error_handler__"):
            continue
        label, kind, role, step = meta[node_id]
        policy = on_error.get(node_id)
        nodes.append(
            NodeMeta(
                id=node_id,
                label=label,
                kind=kind,
                role=role,
                step=step,
                on_error=policy[1] if policy else None,
            )
        )
    label, kind, role, _ = meta["core_api"]
    nodes.append(NodeMeta(id="core_api", label=label, kind=kind, role=role))
    edges = [
        EdgeMeta(
            source=e.source,
            target=e.target,
            kind="conditional" if e.conditional else "normal",
            label=EDGE_LABELS.get((e.source, e.target)) if meta is NODE_META else None,
        )
        for e in drawn.edges
        if not (
            e.source.startswith("__error_handler__") or e.target.startswith("__error_handler__")
        )
    ]
    return Topology(nodes=nodes, edges=edges)


def build_topology(graph: Any) -> Topology:
    topo = _from_graph(graph, NODE_META, ON_ERROR)
    nodes, edges = topo.nodes, topo.edges

    known = {(e.source, e.target) for e in edges}
    for node, (target, policy, _) in ON_ERROR.items():
        if (node, target) not in known:
            edges.append(
                EdgeMeta(source=node, target=target, kind="error", label=f"erreur ({policy})")
            )
    edges.append(
        EdgeMeta(source="query_understanding", target="core_api", kind="tool", label="3 outils")
    )
    return Topology(nodes=nodes, edges=edges)
