"""Ce que l'assistant applique sans IA, exposé en lecture à la console (Connaissances › Règles).

Les textes sont rédigés pour un PO ; la colonne `technical` reprend le motif réellement exécuté,
pour qu'on puisse vérifier que la phrase dit vrai. Rien ici n'est modifiable depuis la console :
changer une règle est une décision de code, testée et relue.
"""

from __future__ import annotations

import hashlib
from typing import Any

from pawrise_assistant.components import guardrail, pii
from pawrise_assistant.components.safe_responses import FALLBACK, SAFE_RESPONSES, URGENT
from pawrise_assistant.llm import prompts

RULES: list[dict[str, str]] = [
    {
        "id": "R-ESC-01",
        "title": "Urgence : vétérinaire tout de suite",
        "text": (
            "Un signe grave (souffle court, convulsions, effondrement, ventre gonflé…) ou un toxique "
            "avalé (chocolat, raisin, xylitol…) déclenche un texte fixe d'urgence, sans rédaction "
            "ni recherche, quel que soit le tri."
        ),
        "technical": guardrail.URGENT_SIGNALS.pattern,
    },
    {
        "id": "R-ESC-03",
        "title": "Baisse d'activité : vétérinaire proposé",
        "text": (
            "Une alerte d'activité active sur le collier, ou une activité en baisse d'au moins 30 % "
            "sur au moins 5 jours, ajoute une proposition de vétérinaire."
        ),
        "technical": "alerte activity_drop (vigilance|action) ou activity_delta_pct ≤ -30 sur ≥ 5 j",
    },
    {
        "id": "R-DIAG",
        "title": "Jamais de diagnostic ni de médicament",
        "text": (
            "Une phrase qui attribue une maladie au chien, conseille un médicament ou une dose, ou "
            "affirme qu'aucun soin n'est nécessaire est rejetée. Une demande de diagnostic reçoit "
            "un texte fixe."
        ),
        "technical": " | ".join(guardrail._DIAGNOSTIC),
    },
    {
        "id": "R-SRC",
        "title": "Chaque phrase a une source",
        "text": (
            "Une fiche santé retenue, les données du collier, ou les mots du propriétaire. Sinon la "
            "réponse est rejetée : 2ᵉ essai avec une consigne durcie, puis réponse prudente."
        ),
        "technical": "source_ids ⊆ passages retenus ∪ {telemetry, message}",
    },
    {
        "id": "R-MSG",
        "title": "Reprendre le propriétaire est sourcé",
        "text": "Une phrase qui ne fait que reprendre ses mots s'appuie sur son message.",
        "technical": "tous les mots porteurs de la phrase sont dans le message",
    },
    {
        "id": "R-VET",
        "title": "Inviter à consulter est toujours permis",
        "text": (
            "« Demandez l'avis d'un vétérinaire » n'a pas besoin de source, tant qu'elle "
            "n'affirme rien sur le chien."
        ),
        "technical": guardrail._VET_REFERRAL.pattern,
    },
    {
        "id": "R-PII",
        "title": "Données personnelles masquées",
        "text": (
            "Téléphone, e-mail, IBAN, numéro de sécurité sociale et code postal sont masqués "
            "avant tout appel à l'IA."
        ),
        "technical": ", ".join(kind for kind, _ in pii._PATTERNS),
    },
    {
        "id": "R-FAIL",
        "title": "En cas de panne, prudence",
        "text": (
            "Si le tri ou la vérification tombe en panne, le propriétaire reçoit une réponse prudente "
            "qui propose un vétérinaire. Si les données du chien ou la recherche manquent, "
            "l'assistant continue sans elles."
        ),
        "technical": "fail-closed aux nœuds 1 et 6, fail-open aux nœuds 2 à 4",
    },
]

_WHEN = {
    "diagnosis_request": "Diagnostic ou médicament demandé",
    "jailbreak": "Tentative de détournement",
    "abuse": "Insulte",
    "out_of_scope": "Hors sujet",
}


def templates() -> list[dict[str, Any]]:
    rows = [
        {
            "template_id": t.template_id,
            "when": _WHEN.get(intent, intent),
            "text": t.text,
            "escalation": t.escalation.model_dump(),
        }
        for intent, t in SAFE_RESPONSES.items()
    ]
    rows.append(
        {
            "template_id": URGENT.template_id,
            "when": "Signal d'urgence (R-ESC-01)",
            "text": URGENT.text,
            "escalation": URGENT.escalation.model_dump(),
        }
    )
    rows.append(
        {
            "template_id": FALLBACK.template_id,
            "when": "Panne, ou deux réponses rejetées",
            "text": FALLBACK.text,
            "escalation": FALLBACK.escalation.model_dump(),
        }
    )
    return rows


def prompt_files() -> list[dict[str, str]]:
    return [
        {
            "name": path.stem,
            "version": hashlib.sha256(path.read_bytes()).hexdigest()[:8],
            "text": path.read_text(encoding="utf-8").strip(),
        }
        for path in sorted(prompts.DIR.glob("*.md"))
    ]


def catalog() -> dict[str, Any]:
    return {
        "rules": RULES,
        "templates": templates(),
        "prompts": prompt_files(),
        "prompt_version": prompts.version(),
    }
