"""Ce que lit le propriétaire pendant qu'il attend : une phrase par étape, jamais de contenu.

Le texte de la réponse n'est envoyé qu'une fois vérifié par le guardrail : on ne diffuse pas de
brouillon mot à mot, il pourrait contenir ce que le guardrail va rejeter. Pour faire patienter,
on annonce les étapes. Les nœuds internes (masquage, contrôle d'abus, aiguillage, sorties à texte
fixe) n'ont pas de phrase : ils durent quelques millisecondes ou se déroulent en parallèle.
"""

from __future__ import annotations

STATUS: dict[str, str] = {
    "redact": "Je lis votre message…",
    "query_understanding": "Je regarde les données du collier…",
    "retrieval": "Je consulte les fiches santé…",
    "generation": "Je rédige la réponse…",
    "guardrail": "Je vérifie la réponse…",
    "collect": "Je rassemble les données récentes…",
    "synthesize": "Je prépare le dossier…",
    "verify": "Je vérifie le dossier…",
}

RETRY = "Je reformule plus prudemment…"


def user_status(node: str, attempt: int) -> str | None:
    if node == "generation" and attempt > 1:
        return RETRY
    return STATUS.get(node)
