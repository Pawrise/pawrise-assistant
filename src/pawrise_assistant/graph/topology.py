"""Topologie exposée à la console (`GET /graph`).

Les nœuds et arêtes viennent du graphe compilé, jamais d'un schéma dessiné à la main. Ce module
n'ajoute que ce que LangGraph ne sait pas : les libellés humains, la politique d'échec et le libellé
de chaque condition. Un test vérifie que chaque arête conditionnelle a son libellé.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

from pawrise_assistant.graph.builder import ON_ERROR

NodeKind = Literal["terminal", "step", "exit", "output", "tool", "router"]
Actor = Literal["ai", "rule", "search", "text", "data"]


class NodeMeta(BaseModel):
    id: str
    label: str
    kind: NodeKind
    role: str
    on_error: str | None = None
    step: int | None = None
    actor: Actor | None = None


class EdgeMeta(BaseModel):
    source: str
    target: str
    kind: Literal["normal", "conditional", "error", "tool"]
    label: str | None = None


class Topology(BaseModel):
    nodes: list[NodeMeta]
    edges: list[EdgeMeta]


NODE_META: dict[str, tuple[str, NodeKind, str, int | None]] = {
    "__start__": ("Début", "terminal", "Le message arrive de dialog.", None),
    "redact": (
        "Masquer les données perso",
        "step",
        "Retire téléphone, e-mail, IBAN… avant tout appel à l'IA.",
        None,
    ),
    "circuit_breaker": (
        "Trier la demande",
        "step",
        "Question santé, demande de diagnostic, détournement ou hors sujet ?",
        1,
    ),
    "query_understanding": (
        "Comprendre le contexte",
        "step",
        "Reformule la question et charge le profil, le collier et les alertes du chien.",
        2,
    ),
    "gate": (
        "Choisir la suite",
        "router",
        "Attend les deux étapes précédentes, puis oriente le message.",
        None,
    ),
    "retrieval": ("Chercher", "step", "Trouve 20 passages dans les fiches santé.", 3),
    "relevance_filter": (
        "Garder les meilleurs",
        "step",
        "Ne garde que les 5 passages les plus utiles.",
        4,
    ),
    "generation": ("Rédiger", "step", "Écrit la réponse à partir des seules sources trouvées.", 5),
    "guardrail": (
        "Vérifier",
        "step",
        "Chaque phrase doit avoir une source et aucun diagnostic. Sinon, 2ᵉ essai.",
        6,
    ),
    "safe_response": (
        "Refus poli",
        "exit",
        "Quand : insulte, détournement, hors sujet.",
        None,
    ),
    "safe_response_escalate": (
        "Refus + vétérinaire",
        "exit",
        "Quand : diagnostic demandé ou urgence.",
        None,
    ),
    "safe_fallback": (
        "Réponse prudente",
        "exit",
        "Quand : panne ou deux réponses rejetées.",
        None,
    ),
    "finalize": (
        "Envoyer",
        "output",
        "Sortie unique : ajoute l'alerte d'urgence si besoin et enregistre l'audit.",
        None,
    ),
    "__end__": ("Fin", "terminal", "La réponse part vers dialog.", None),
    "core_api": ("Core API", "tool", "Profil, collier et alertes du chien (lecture seule).", None),
}

ACTORS: dict[str, Actor] = {
    "redact": "rule",
    "circuit_breaker": "ai",
    "query_understanding": "ai",
    "gate": "rule",
    "retrieval": "search",
    "relevance_filter": "search",
    "generation": "ai",
    "guardrail": "ai",
    "safe_response": "text",
    "safe_response_escalate": "text",
    "safe_fallback": "text",
    "finalize": "rule",
    "collect": "data",
    "timeline": "rule",
    "synthesize": "rule",
    "verify": "rule",
    "core_api": "data",
}
"""Qui fait le travail, pour la console : l'IA, une règle écrite, la recherche, un texte fixe."""

EDGE_LABELS: dict[tuple[str, str], str] = {
    ("redact", "circuit_breaker"): "en parallèle",
    ("redact", "query_understanding"): "en parallèle",
    ("gate", "safe_response"): "abus · détournement · hors sujet",
    ("gate", "safe_response_escalate"): "diagnostic ou urgence",
    ("gate", "safe_fallback"): "tri en panne",
    ("gate", "retrieval"): "recherche utile",
    ("gate", "generation"): "rien à chercher",
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
    "finalize": ("Envoyer", "output", "Sortie unique : audit écrit, dossier JSON émis.", None),
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
                actor=ACTORS.get(node_id),
            )
        )
    label, kind, role, _ = meta["core_api"]
    nodes.append(NodeMeta(id="core_api", label=label, kind=kind, role=role, actor="data"))
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
