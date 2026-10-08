"""Nœud 6 : vérifier claim par claim avant que quoi que ce soit n'atteigne le propriétaire.

ADR-007, couche 3. Trois contrôles :
1. aucun claim au langage diagnostique ou prescriptif ;
2. chaque claim est ancré : une source retenue par le nœud 4, ou la télémétrie ;
3. règles d'escalade métier, explicites, qui peuvent forcer `escalation.trigger`.

Les règles déterministes restent en place quand le contrôle LLM arrive (lot 3) : le LLM ajoute de
la couverture, il ne remplace pas une règle qu'on peut lire et tester.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol

from pawrise_assistant.components.text import fold
from pawrise_assistant.domain.models import (
    TELEMETRY_SOURCE,
    AlertContext,
    Chunk,
    ClaimCheck,
    DraftAnswer,
    Escalation,
    GuardrailVerdict,
    PetContext,
)

_DIAGNOSTIC = [
    r"\b(il s agit|c est|souffre|atteint|a)\b.{0,25}\b(probablement|surement|certainement|"
    r"sans doute|vraisemblablement)\b",
    r"\b(probablement|surement|certainement)\b.{0,10}\b(une|un|d)\b.{0,30}\b(maladie|dysplasie|"
    r"infection|arthrose|cancer|tumeur|diabete|lyme|leishmaniose|piroplasmose|fracture|hernie)",
    r"\bdiagnostic (est|serait)\b",
    r"\b(donnez|donner|administrez|administrer)\b.{0,30}\b(amoxicilline|antibiotique|ibuprofene|"
    r"paracetamol|aspirine|cortisone|anti-?inflammatoire)",
    r"\b\d+([.,]\d+)?\s?(mg|ml|comprimes?|gelules?)\b",
]

URGENT_SIGNALS = re.compile(
    r"\b(chocolat|raisins?|xylitol|oignons?|mort aux rats|antigel|poison|toxique|empoisonn|"
    r"ne respire|respire mal|du mal a respirer|convuls|s est effondre|effondrement|"
    r"ventre (est )?(gonfle|dur)|essaie de vomir|saigne beaucoup|hemorragie|inconscient)"
)


@dataclass(frozen=True)
class GuardrailContext:
    user_message: str
    chunks: list[Chunk]
    pet: PetContext | None
    alert: AlertContext | None


def is_diagnostic(text: str) -> bool:
    t = fold(text).replace("'", " ").replace("’", " ")
    return any(re.search(p, t) for p in _DIAGNOSTIC)


def escalation_rules(ctx: GuardrailContext) -> Escalation:
    """Règles d'escalade explicites. Ordre : la plus urgente gagne."""
    message = fold(ctx.user_message).replace("'", " ").replace("’", " ")
    if hit := URGENT_SIGNALS.search(message):
        return Escalation(
            trigger=True, urgency="high", reason=f"R-ESC-01 signal d'urgence (« {hit.group(0)} »)"
        )
    alert = ctx.alert
    if (
        alert
        and alert.kind == "activity_drop"
        and alert.persisted_days >= 5
        and (alert.delta_pct or 0) <= -30
    ):
        return Escalation(
            trigger=True,
            urgency="medium",
            reason="R-ESC-03 baisse d'activité ≥ 30 % pendant ≥ 5 jours",
        )
    tel = ctx.pet.telemetry if ctx.pet else None
    if tel and tel.period_days >= 5 and tel.activity_delta_pct <= -30:
        return Escalation(
            trigger=True,
            urgency="medium",
            reason="R-ESC-03 baisse d'activité ≥ 30 % pendant ≥ 5 jours",
        )
    return Escalation()


class Guardrail(Protocol):
    name: str

    async def check(self, draft: DraftAnswer, ctx: GuardrailContext) -> GuardrailVerdict: ...


class RuleGuardrail:
    name = "règles (dev)"

    async def check(self, draft: DraftAnswer, ctx: GuardrailContext) -> GuardrailVerdict:
        allowed = {c.chunk_id for c in ctx.chunks}
        if ctx.pet and ctx.pet.telemetry:
            allowed.add(TELEMETRY_SOURCE)
        checks = [
            ClaimCheck(
                text=c.text,
                grounded=bool(c.source_ids) and set(c.source_ids) <= allowed,
                diagnostic=is_diagnostic(c.text),
                source_ids=c.source_ids,
            )
            for c in draft.claims
        ]
        reasons = [f"langage diagnostique : « {c.text} »" for c in checks if c.diagnostic]
        reasons += [f"affirmation sans source : « {c.text} »" for c in checks if not c.grounded]
        if not draft.response_text.strip():
            reasons.append("réponse vide")
        escalation = escalation_rules(ctx)
        if not escalation.trigger and draft.escalation.trigger:
            escalation = draft.escalation
        return GuardrailVerdict(
            passed=not reasons, checks=checks, reasons=reasons, escalation=escalation
        )
