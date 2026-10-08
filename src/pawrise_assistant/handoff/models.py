"""Le dossier pré-consultation (flux E, FR18/FR35).

Ce repo produit la synthèse JSON ; le rendu PDF revient à File & Export (conception §9.4).
Chaque élément du dossier porte sa source : un vétérinaire doit pouvoir vérifier d'où vient tout ce
qu'il lit (story 10.2).
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from pawrise_assistant.domain.models import Frozen, PetProfile, Turn, Urgency

DISCLAIMER = (
    "Synthèse préparée automatiquement à partir des données du collier et des échanges avec le "
    "propriétaire. Ce document n'est pas un diagnostic."
)


class HandoffRequest(Frozen):
    thread_id: str
    pet_ref: str
    reason: str | None = None
    """Motif transmis par dialog (ex. raison de l'escalade)."""
    thread_extracts: list[Turn] = Field(default_factory=list)
    window_days: int = Field(default=30, ge=1, le=30)


class Sourced(Frozen):
    text: str
    source: str
    """`telemetry`, `alert:<id>`, `profile`, `thread:<n>` : jamais vide."""


class TimelineEvent(Sourced):
    days_ago: int


class HandoffSummary(Frozen):
    schema_version: Literal["1"] = "1"
    pet: PetProfile | None
    reason: str
    urgency: Urgency
    timeline: list[TimelineEvent]
    owner_reported: list[Sourced]
    observations: list[Sourced]
    disclaimer: str = DISCLAIMER
