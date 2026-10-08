"""Réponses cadrées : textes fixes, relus, qui ne passent par aucun LLM (ADR-007, couche 1)."""

from __future__ import annotations

from dataclasses import dataclass

from pawrise_assistant.domain.models import Escalation, Intent


@dataclass(frozen=True)
class SafeTemplate:
    template_id: str
    text: str
    escalation: Escalation


SAFE_RESPONSES: dict[Intent, SafeTemplate] = {
    "diagnosis_request": SafeTemplate(
        "SR-DIAG-01",
        "Je ne peux ni établir de diagnostic ni recommander un médicament : seul un vétérinaire "
        "peut le faire. Si vous êtes inquiet, un vétérinaire pourra examiner votre chien. Je peux "
        "préparer un dossier avec ses données récentes pour la consultation.",
        Escalation(trigger=True, urgency="medium", reason="demande de diagnostic ou de traitement"),
    ),
    "jailbreak": SafeTemplate(
        "SR-JB-01",
        "Je suis l'assistant Pawrise : j'explique les données de votre chien et je réponds aux "
        "questions générales, mais je ne change pas de rôle. Que voulez-vous savoir ?",
        Escalation(),
    ),
    "abuse": SafeTemplate(
        "SR-ABUSE-01",
        "Je préfère qu'on reste sur un ton cordial. Je suis là pour vous aider à comprendre l'état "
        "de votre chien.",
        Escalation(),
    ),
    "out_of_scope": SafeTemplate(
        "SR-OOS-01",
        "Je ne peux répondre qu'aux questions sur la santé et le comportement de votre chien.",
        Escalation(),
    ),
}

FALLBACK = SafeTemplate(
    "SR-FALLBACK-02",
    "Je préfère ne pas vous répondre de façon approximative. Si vous êtes inquiet, un vétérinaire "
    "pourra vous conseiller : je peux préparer un dossier avec les données récentes de votre chien.",
    Escalation(trigger=True, urgency="medium", reason="réponse non validée par le guardrail"),
)

URGENT_PREFIX = "Contactez un vétérinaire dès maintenant. "
