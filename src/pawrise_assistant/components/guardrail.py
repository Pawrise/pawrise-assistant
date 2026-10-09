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

from pawrise_assistant.components.text import fold, sentences, stem, tokens
from pawrise_assistant.domain.models import (
    MESSAGE_SOURCE,
    OPENING_SOURCE,
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
    # « Aucun soin nécessaire » : rassurer à tort est aussi un avis médical.
    r"\b(le repos|attendre|surveiller)\b.{0,20}\bsuffi(t|ra|rait)\b",
    r"\bpas (besoin|la peine|necessaire) d(e)? ?(consulter|voir un veterinaire|l emmener|appeler)",
]

_TOXIC = r"(chocolat|raisins?|xylitol|oignons?|mort aux rats|antigel|poison|toxique|medicaments?)"
_INGESTED = r"(mange|avale|ingere|croque|leche|bu|pris|bouffe|acces)"
# Un toxique n'est une urgence que s'il a été ingéré : « une recette au chocolat » n'en est pas une
# (faux positif constaté lors de la validation réelle). Les signes graves, eux, suffisent seuls.
URGENT_SIGNALS = re.compile(
    rf"\b{_INGESTED}\w*\b.{{0,40}}\b{_TOXIC}|\b{_TOXIC}\b.{{0,40}}\b{_INGESTED}"
    r"|\b(empoisonn\w*|ne respire|respire mal|du mal a respirer|convuls\w*|s est effondre|"
    r"effondrement|ventre (est )?(gonfle|dur)|essaie de vomir|saigne beaucoup|hemorragie|inconscient)"
)


@dataclass(frozen=True)
class GuardrailContext:
    user_message: str
    chunks: list[Chunk]
    pet: PetContext | None
    alert: AlertContext | None


_VET_REFERRAL = re.compile(
    r"\bveterinaire\b.{0,40}\b(consult|avis|examin|contact|appel|voir|montr)"
    r"|\b(consult|avis|examin|contact|appel|voir|montr)\w*\b.{0,40}\bveterinaire\b"
)


_REPORTING = frozenset(
    [
        "vous",
        "dites",
        "dit",
        "indiquez",
        "indique",
        "mentionnez",
        "signalez",
        "precisez",
        "expliquez",
        "proprietaire",
        "avez",
        "que",
        "qu",
        "selon",
        "votre",
        "vos",
        "message",
        # Verbes de reprise vus en réel (« Vous observez que… »), et leurs voisins.
        "observez",
        "observe",
        "remarquez",
        "remarque",
        "constatez",
        "constate",
        "notez",
        "decrivez",
        "decrit",
        "parlez",
        "ecrivez",
        "trouvez",
        "voyez",
        "racontez",
        "rapportez",
        "le",
        "la",
        "les",
    ]
)


def restates_message(text: str, message: str) -> bool:
    """Une phrase qui ne fait que reprendre les mots du propriétaire : sa source, c'est le message.

    Constaté en réel : « Vous dites que Rex dort beaucoup depuis quelques jours » était rédigé sans
    source, rejeté deux fois, et une question anodine finissait en réponse de repli (16 s).
    """
    said = {stem(w) for w in tokens(message)}
    words = [stem(w) for w in tokens(text) if w not in _REPORTING]
    return bool(words) and all(w in said for w in words) and not is_diagnostic(text)


_PII_MARKER = re.compile(r"\[(email|iban|nir|phone|postcode)\]")


def leaks_marker(text: str) -> bool:
    """Un marqueur de masquage laissé dans la réponse.

    Constaté en réel : « je garde votre demande de rappel au [phone] » ; le propriétaire voyait le
    marqueur interne, et l'assistant promettait un rappel qu'il ne peut pas faire.
    """
    return bool(_PII_MARKER.search(text))


def is_opening(text: str) -> bool:
    """Une phrase d'accueil acceptable : courte, sans chiffre, sans diagnostic.

    Elle rend la réponse humaine (« Je comprends que ça vous interroge. ») sans rien affirmer ;
    le LLM de vérification contrôle en plus qu'elle ne dit rien de la santé du chien.
    """
    return len(text.split()) <= 18 and not re.search(r"\d", text) and not is_diagnostic(text)


def is_vet_referral(text: str) -> bool:
    """Une invitation à consulter : pas besoin de source, tant qu'elle n'affirme rien sur le chien."""
    return bool(_VET_REFERRAL.search(fold(text))) and not is_diagnostic(text)


def is_diagnostic(text: str) -> bool:
    t = fold(text).replace("'", " ").replace("’", " ")
    return any(re.search(p, t) for p in _DIAGNOSTIC)


def is_urgent(message: str) -> bool:
    """R-ESC-01 seule : un signal d'urgence dans le message, sans contexte ni LLM."""
    return URGENT_SIGNALS.search(fold(message).replace("'", " ").replace("’", " ")) is not None


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
    active = [
        a
        for a in (ctx.pet.alerts if ctx.pet else [])
        if a.kind == "activity_drop" and a.level in ("vigilance", "action")
    ]
    if active:
        return Escalation(
            trigger=True,
            urgency="medium",
            reason=f"R-ESC-03 alerte active du collier ({active[0].alert_id})",
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
        allowed = {c.chunk_id for c in ctx.chunks} | {MESSAGE_SOURCE}
        if ctx.pet and ctx.pet.telemetry:
            allowed.add(TELEMETRY_SOURCE)
        checks = [
            ClaimCheck(
                text=c.text,
                grounded=(bool(c.source_ids) and set(c.source_ids) <= allowed)
                or (c.source_ids == [OPENING_SOURCE] and is_opening(c.text))
                or is_vet_referral(c.text)
                or restates_message(c.text, ctx.user_message),
                diagnostic=is_diagnostic(c.text),
                source_ids=c.source_ids,
            )
            for c in draft.claims
        ]
        reasons = [f"langage diagnostique : « {c.text} »" for c in checks if c.diagnostic]
        reasons += [f"donnée masquée citée : « {c.text} »" for c in checks if leaks_marker(c.text)]
        reasons += [f"affirmation sans source : « {c.text} »" for c in checks if not c.grounded]
        if not draft.response_text.strip():
            reasons.append("réponse vide")
        if (
            not draft.claims
        ):  # réponse libre (small-talk) : pas de source, mais jamais de diagnostic
            reasons += [
                f"langage diagnostique : « {s} »"
                for s in sentences(draft.response_text)
                if is_diagnostic(s)
            ]
        escalation = escalation_rules(ctx)
        if not escalation.trigger and draft.escalation.trigger:
            escalation = draft.escalation
        return GuardrailVerdict(
            passed=not reasons, checks=checks, reasons=reasons, escalation=escalation
        )
