"""Le state qui circule entre les nœuds (conception §3.1).

`pet_ref` et jamais `pet_id` : la pseudonymisation est portée par le type.
`history` arrive en entrée : l'assistant ne mémorise rien (§1.3).
`trace` est accumulé : une seule source pour l'audit et pour la console.
"""

from __future__ import annotations

from operator import add
from typing import Annotated, NotRequired, TypedDict

from pawrise_assistant.domain.models import (
    AlertContext,
    AssistantResponse,
    Chunk,
    DraftAnswer,
    GuardrailVerdict,
    Intent,
    NodeTrace,
    PetContext,
    Turn,
)


class AssistantState(TypedDict):
    # — Identité —
    thread_id: str
    turn_id: str
    pet_ref: str

    # — Entrée (fournie par dialog) —
    user_message: str
    history: list[Turn]
    alert_context: NotRequired[AlertContext | None]

    # — Nœud 1 —
    intent: NotRequired[Intent]
    intent_confidence: NotRequired[float]

    # — Nœud 2 —
    canonical_query: NotRequired[str]
    needs_retrieval: NotRequired[bool]
    pet_context: NotRequired[PetContext]

    # — Nœuds 3 et 4 —
    candidates: NotRequired[list[Chunk]]
    context_chunks: NotRequired[list[Chunk]]

    # — Nœuds 5 et 6 —
    draft: NotRequired[DraftAnswer]
    verdict: NotRequired[GuardrailVerdict]
    retry_count: int

    # — Sortie —
    template_id: NotRequired[str]
    response: NotRequired[AssistantResponse]

    # — Transverse —
    trace: Annotated[list[NodeTrace], add]
