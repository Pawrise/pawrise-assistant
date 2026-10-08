"""Nœud 1 : classer l'intention avant tout le reste (ADR-007, couche 1).

`RuleIntentClassifier` est l'implémentation de dev, déterministe. L'implémentation LLM (lot 3) garde
la même interface. Dans les deux cas, le nœud échoue fermé.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol

from pawrise_assistant.components.text import fold
from pawrise_assistant.domain.models import Intent


@dataclass(frozen=True)
class IntentResult:
    intent: Intent
    confidence: float
    matched: str | None = None


class IntentClassifier(Protocol):
    async def classify(self, message: str) -> IntentResult: ...


_JAILBREAK = [
    r"\b(oublie|ignore|ignorez|oubliez)\b.{0,30}\b(consignes?|instructions?|regles?|prompt)",
    r"\btu es (maintenant|desormais)\b",
    r"\b(system prompt|prompt systeme|jailbreak|mode developpeur|dan mode)\b",
    r"\bfais comme si tu etais\b",
]
_DIAGNOSIS = [
    r"\b(a|aurait|souffre|atteint)\b.{0,30}\b(la maladie|une maladie|cancer|infection|lyme|"
    r"leishmaniose|piroplasmose|dysplasie|diabete|tumeur|virus)",
    r"\bdiagnosti",
    r"\bc ?est quoi (sa|comme) maladie\b",
    r"\b(quel|quelle|quels)\b.{0,20}\b(medicament|traitement|antibiotique|dose|posologie)",
    r"\bje (peux|dois|vais) lui donner\b",
    r"\b(amoxicilline|antibiotique|ibuprofene|paracetamol|doliprane|aspirine|cortisone|"
    r"anti-?inflammatoire|vermifuge)\b.{0,30}\?",
    r"\bprescri",
    r"\bcombien de (mg|milligrammes|comprimes)\b",
]
_ABUSE = [r"\b(connard|connasse|salope|encule|ta gueule|nique)\b"]
_ANIMAL_HINTS = re.compile(
    r"\b(chien|chienne|chiot|rex|nala|patte|collier|veto|veterinaire|mange|dort|boite|"
    r"alerte|activite|sommeil|merci|bonjour|salut|ok|super)\b"
)
_OFF_TOPIC = [r"\b(recette|bourse|meteo|horoscope|code python|javascript|politique|elections?)\b"]


def _first(patterns: list[str], text: str) -> str | None:
    for p in patterns:
        m = re.search(p, text)
        if m:
            return m.group(0)
    return None


class RuleIntentClassifier:
    async def classify(self, message: str) -> IntentResult:
        text = fold(message).replace("'", " ").replace("’", " ")
        if hit := _first(_ABUSE, text):
            return IntentResult("abuse", 0.97, hit)
        if hit := _first(_JAILBREAK, text):
            return IntentResult("jailbreak", 0.99, hit)
        if hit := _first(_DIAGNOSIS, text):
            return IntentResult("diagnosis_request", 0.94, hit)
        if (hit := _first(_OFF_TOPIC, text)) and not _ANIMAL_HINTS.search(text):
            return IntentResult("out_of_scope", 0.9, hit)
        return IntentResult("clean", 0.95)
