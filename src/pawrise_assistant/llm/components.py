"""Composants LLM (lots 3 et 5). Mêmes interfaces que les composants de dev.

Principe : le LLM ajoute de la couverture, il ne retire jamais une règle.
- Classifieur : les règles d'abord (certaines et gratuites) ; le LLM ne voit que ce qu'elles
  laissent passer, et il ne peut que durcir le classement.
- Vérification : un claim doit passer la règle ET le contrôle LLM ; il est diagnostique si l'un des
  deux le dit. Les règles d'escalade restent déterministes.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

from pawrise_assistant.components.generation import apply_faults
from pawrise_assistant.components.guardrail import (
    GuardrailContext,
    RuleGuardrail,
    is_vet_referral,
    restates_message,
)
from pawrise_assistant.components.intent import IntentResult, RuleIntentClassifier, is_courtesy
from pawrise_assistant.components.understanding import RuleQueryUnderstanding, Understanding
from pawrise_assistant.domain.models import (
    MESSAGE_SOURCE,
    TELEMETRY_SOURCE,
    AlertContext,
    Chunk,
    Claim,
    ClaimCheck,
    DraftAnswer,
    GuardrailVerdict,
    Intent,
    PetContext,
)
from pawrise_assistant.llm import prompts
from pawrise_assistant.llm.provider import LLMProvider, LLMUnavailable

# — Nœud 1 —


class IntentOut(BaseModel):
    intent: Intent
    confidence: float = Field(ge=0, le=1)
    reason: str


class LLMIntentClassifier:
    def __init__(self, provider: LLMProvider) -> None:
        self.provider, self.rules = provider, RuleIntentClassifier()

    async def classify(self, message: str) -> IntentResult:
        ruled = await self.rules.classify(message)
        if ruled.intent != "clean":
            return ruled
        if is_courtesy(message):  # politesse : pas besoin du LLM, et il s'y trompait
            return IntentResult("clean", 0.99, "politesse")
        out = await self.provider.parse(
            tier="nano",
            system=prompts.load("intent"),
            user=message,
            schema=IntentOut,
            max_tokens=120,
        )
        return IntentResult(out.intent, out.confidence, f"LLM : {out.reason}")


# — Nœud 2 —


class UnderstandingOut(BaseModel):
    canonical_query: str
    needs_retrieval: bool
    telemetry_days: Literal[1, 2, 7] | None
    alerts_days: Literal[7] | None


class LLMQueryUnderstanding:
    def __init__(self, provider: LLMProvider) -> None:
        self.provider, self.rules = provider, RuleQueryUnderstanding()

    async def understand(self, message: str, alert: AlertContext | None) -> Understanding:
        user = message if alert is None else f"{message}\n\n[Contexte : alerte « {alert.summary} »]"
        out = await self.provider.parse(
            tier="nano",
            system=prompts.load("understanding"),
            user=user,
            schema=UnderstandingOut,
            max_tokens=160,
        )
        # On cherche avec les mots-clés du LLM ET ceux du propriétaire : la recherche lexicale
        # rate les fiches quand la reformulation s'éloigne trop des mots d'origine.
        query = f"{out.canonical_query} · {message}"
        if alert is not None:  # flux B : le contexte de l'alerte est toujours chargé
            return Understanding(query, True, 7, 7)
        # Sauter la recherche, c'est répondre sans source : il faut que les règles ET le LLM
        # y voient un simple échange courant. Le LLM seul ne peut pas en décider.
        ruled = await self.rules.understand(message, None)
        needs = out.needs_retrieval or ruled.needs_retrieval
        return Understanding(query, needs, out.telemetry_days, out.alerts_days)


# — Nœud 5 —


class ClaimOut(BaseModel):
    text: str
    source_ids: list[str]


class DraftOut(BaseModel):
    claims: list[ClaimOut] = Field(max_length=5)
    suggest_vet: bool


def _context(message: str, pet: PetContext | None, chunks: list[Chunk]) -> str:
    parts = [f"Message du propriétaire [{MESSAGE_SOURCE}] :\n{message}"]
    if pet and pet.telemetry:
        parts.append(f"Données du collier [{TELEMETRY_SOURCE}] :\n{pet.describe()}")
    elif pet and pet.profile:
        parts.append(f"Chien : {pet.describe()}")
    if chunks:
        parts.append(
            "Passages :\n"
            + "\n".join(f"[{c.chunk_id}] {c.source} · {c.section} : {c.text}" for c in chunks)
        )
    return "\n\n".join(parts)


def _strip_emoji(text: str) -> str:
    return re.sub(r"[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F]", "", text).strip()


class SmallTalkOut(BaseModel):
    text: str = Field(min_length=1, max_length=300)


class LLMGenerator:
    name = "LLM principal"

    def __init__(self, provider: LLMProvider) -> None:
        self.provider = provider

    async def generate(
        self,
        *,
        message: str,
        pet: PetContext | None,
        chunks: list[Chunk],
        hardened: bool,
        faults: frozenset[str],
        small_talk: bool = False,
    ) -> DraftAnswer:
        if "llm_down" in faults:
            raise LLMUnavailable("fournisseur LLM injoignable (panne injectée)")
        # Échange courant (merci, bonjour) : rien à affirmer, donc rien à sourcer. Une question
        # santé sans passage trouvé ne prend jamais ce chemin : elle ne peut citer que le collier
        # et le message, sinon elle est rejetée (constaté : recherche en panne → réponse libre).
        if small_talk:
            name = pet.profile.name if pet and pet.profile else None
            reply = await self.provider.parse(
                tier="nano",
                system=prompts.load("small_talk"),
                user=message if not name else f"{message}\n\n[Chien : {name}]",
                schema=SmallTalkOut,
                max_tokens=80,
            )
            return DraftAnswer(response_text=_strip_emoji(reply.text))
        system = prompts.load("generation")
        if hardened:
            system += "\n\n" + prompts.load("generation_hardened")
        out = await self.provider.parse(
            tier="main",
            system=system,
            user=_context(message, pet, chunks),
            schema=DraftOut,
            max_tokens=500,
        )
        claims = apply_faults(
            [Claim(text=c.text, source_ids=c.source_ids) for c in out.claims], pet, hardened, faults
        )
        return DraftAnswer(response_text=" ".join(c.text for c in claims), claims=claims)


# — Nœud 6 —


class CheckOut(BaseModel):
    index: int
    supported: bool
    diagnostic: bool


class GuardrailOut(BaseModel):
    checks: list[CheckOut]


class LLMGuardrail:
    name = "règles + LLM"

    def __init__(self, provider: LLMProvider) -> None:
        self.provider, self.rules = provider, RuleGuardrail()

    async def check(self, draft: DraftAnswer, ctx: GuardrailContext) -> GuardrailVerdict:
        ruled = await self.rules.check(draft, ctx)
        if not draft.claims:
            return ruled
        sources = {c.chunk_id: c.text for c in ctx.chunks}
        sources[MESSAGE_SOURCE] = ctx.user_message
        if ctx.pet and ctx.pet.telemetry:
            sources[TELEMETRY_SOURCE] = ctx.pet.describe()
        lines = []
        for i, claim in enumerate(draft.claims):
            cited = (
                "\n".join(
                    f"    [{s}] {sources.get(s, '(source inconnue)')}" for s in claim.source_ids
                )
                or "    (aucune source)"
            )
            lines.append(f"{i}. {claim.text}\n{cited}")
        out = await self.provider.parse(
            tier="nano",
            system=prompts.load("guardrail"),
            user="\n\n".join(lines),
            schema=GuardrailOut,
            max_tokens=60 + 30 * len(draft.claims),
        )
        llm = {c.index: c for c in out.checks}
        checks = [
            ClaimCheck(
                text=r.text,
                grounded=r.grounded
                and (
                    (i in llm and llm[i].supported)
                    or is_vet_referral(r.text)
                    or restates_message(r.text, ctx.user_message)
                ),
                diagnostic=r.diagnostic or (i in llm and llm[i].diagnostic),
                source_ids=r.source_ids,
            )
            for i, r in enumerate(ruled.checks)
        ]
        reasons = [f"langage diagnostique : « {c.text} »" for c in checks if c.diagnostic]
        reasons += [
            f"affirmation non appuyée par sa source : « {c.text} »"
            for c in checks
            if not c.grounded
        ]
        return GuardrailVerdict(
            passed=not reasons, checks=checks, reasons=reasons, escalation=ruled.escalation
        )
