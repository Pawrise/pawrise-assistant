"""Nœud 5 : rédiger à partir du seul contexte fourni.

`TemplateGenerator` est le générateur de dev : il assemble des phrases tirées des chunks retenus et
de la télémétrie, chacune rattachée à sa source. Il ne « sait » rien d'autre, ce qui le rend
parfaitement prévisible pour les tests du graphe. Le générateur LLM (lot 5) garde l'interface.

Les pannes injectées (`faults`) n'existent que pour la console et les tests : elles reproduisent
les brouillons fautifs qu'un vrai LLM peut produire, pour vérifier que le guardrail les arrête.
"""

from __future__ import annotations

from typing import Protocol

from pawrise_assistant.components.text import sentences
from pawrise_assistant.domain.models import (
    TELEMETRY_SOURCE,
    Chunk,
    Claim,
    DraftAnswer,
    PetContext,
)
from pawrise_assistant.llm.provider import LLMUnavailable


def apply_faults(
    claims: list[Claim], pet: PetContext | None, hardened: bool, faults: frozenset[str]
) -> list[Claim]:
    """Ajoute les claims fautifs demandés depuis la console (brouillon 1, puis brouillon durci)."""
    out = list(claims)
    if not hardened and "draft_diagnostic" in faults and pet and pet.profile:
        p = pet.profile
        out.append(
            Claim(
                text=f"Chez un {p.breed} de {p.age_years:g} ans, il s'agit "
                "probablement d'une dysplasie de la hanche."
            )
        )
    if hardened and "draft_ungrounded" in faults:
        out.append(Claim(text="Le repos suffit généralement à résoudre ce type de problème."))
    return out


class Generator(Protocol):
    name: str

    async def generate(
        self,
        *,
        message: str,
        pet: PetContext | None,
        chunks: list[Chunk],
        hardened: bool,
        faults: frozenset[str],
    ) -> DraftAnswer: ...


def _consult_sentence(chunks: list[Chunk], skip: str | None) -> Claim | None:
    for c in chunks:
        if c.chunk_id == skip:
            continue
        for s in sentences(c.text):
            if "vétérinaire" in s:
                return Claim(text=s, source_ids=[c.chunk_id])
    return None


def _telemetry_sentence(pet: PetContext) -> Claim | None:
    t, name = pet.telemetry, pet.profile.name if pet.profile else "votre chien"
    if t is None:
        return None

    def delta(v: float) -> str:
        return f"{'en baisse' if v < 0 else 'en hausse'} d'environ {abs(v):.0f} %"

    window = "dernières 24 heures" if t.period_days == 1 else f"{t.period_days} derniers jours"
    return Claim(
        text=f"Sur les {window}, l'activité de {name} est {delta(t.activity_delta_pct)} et son "
        f"sommeil {delta(t.sleep_delta_pct)} par rapport à d'habitude.",
        source_ids=[TELEMETRY_SOURCE],
    )


class TemplateGenerator:
    name = "gabarits (dev)"

    async def generate(
        self,
        *,
        message: str,
        pet: PetContext | None,
        chunks: list[Chunk],
        hardened: bool,
        faults: frozenset[str],
    ) -> DraftAnswer:
        if "llm_down" in faults:
            raise LLMUnavailable("fournisseur LLM injoignable (panne injectée)")
        name = pet.profile.name if pet and pet.profile else "votre chien"
        if not chunks:
            return DraftAnswer(
                response_text=f"Avec plaisir ! Je reste là si vous remarquez autre chose chez {name}."
            )

        claims: list[Claim] = []
        first = chunks[0]
        claims.append(Claim(text=sentences(first.text)[0], source_ids=[first.chunk_id]))
        if pet and (tel := _telemetry_sentence(pet)):
            claims.append(tel)
        claims = apply_faults(claims, pet, hardened, faults)
        if consult := _consult_sentence(chunks, skip=first.chunk_id):
            claims.append(consult)
        return DraftAnswer(response_text=" ".join(c.text for c in claims), claims=claims)
