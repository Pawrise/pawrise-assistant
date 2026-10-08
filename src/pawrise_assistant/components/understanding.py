"""Nœud 2 : reformuler en termes vétérinaires et décider du contexte à charger (ADR-009)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol

from pawrise_assistant.components.text import fold, tokens
from pawrise_assistant.domain.models import AlertContext


@dataclass(frozen=True)
class Understanding:
    canonical_query: str
    needs_retrieval: bool
    telemetry_days: int | None
    """None : pas de télémétrie à charger."""
    alerts_days: int | None


class QueryUnderstanding(Protocol):
    async def understand(self, message: str, alert: AlertContext | None) -> Understanding: ...


_SMALL_TALK = re.compile(
    r"^\s*(merci|ok|okay|d accord|super|genial|parfait|top|bonjour|salut|hello|coucou|au revoir|"
    r"bonne (journee|soiree)|tu peux repeter|c est rassurant|cool)\b[\s!.,a-z]{0,40}$"
)
_BEHAVIOUR = re.compile(
    r"\b(dort|sommeil|boite|bouge|actif|active|activite|mange|appetit|fatigue|halete|tousse|"
    r"depuis|ces derniers|en ce moment|hier|aujourd hui|alerte|collier|coeur|cardiaque)\b"
)
_CANON = {
    "sommeil": "temps de sommeil",
    "boiterie": "boiterie aiguë du membre",
    "activite": "baisse d'activité",
    "appetit": "baisse d'appétit",
    "toux": "toux",
    "abattement": "abattement, léthargie",
    "cardiaque": "fréquence cardiaque",
}


class RuleQueryUnderstanding:
    async def understand(self, message: str, alert: AlertContext | None) -> Understanding:
        text = fold(message).replace("'", " ").replace("’", " ")
        if alert is None and _SMALL_TALK.match(text):
            return Understanding(
                message.strip(), needs_retrieval=False, telemetry_days=None, alerts_days=None
            )
        toks = tokens(message)
        concepts = [_CANON[t] for t in dict.fromkeys(toks) if t in _CANON]
        if alert is not None:
            concepts.insert(
                0,
                "baisse d'activité progressive" if alert.kind == "activity_drop" else alert.summary,
            )
        others = [t for t in dict.fromkeys(toks) if t not in _CANON and len(t) > 3]
        topic = ", ".join([*dict.fromkeys(concepts), *others])
        canonical = f"{topic} chez le chien"
        behaviour = alert is not None or bool(_BEHAVIOUR.search(text))
        days = 2 if re.search(r"\b(hier|aujourd hui|ce matin|cette nuit)\b", text) else 7
        return Understanding(
            canonical_query=canonical,
            needs_retrieval=True,
            telemetry_days=days if behaviour else None,
            alerts_days=7 if behaviour else None,
        )
