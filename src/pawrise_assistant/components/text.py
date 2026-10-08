"""Normalisation de texte partagée par les règles et le retrieval de dev."""

from __future__ import annotations

import re
import unicodedata

STOPWORDS = frozenset(
    [
        "a",
        "au",
        "aux",
        "avec",
        "ce",
        "ces",
        "c",
        "ca",
        "cela",
        "d",
        "dans",
        "de",
        "des",
        "du",
        "elle",
        "en",
        "est",
        "et",
        "etre",
        "il",
        "ils",
        "je",
        "j",
        "l",
        "la",
        "le",
        "les",
        "leur",
        "lui",
        "ma",
        "mais",
        "me",
        "mes",
        "moi",
        "mon",
        "ne",
        "nos",
        "notre",
        "nous",
        "on",
        "ou",
        "par",
        "pas",
        "pour",
        "qu",
        "que",
        "qui",
        "s",
        "sa",
        "se",
        "ses",
        "son",
        "sur",
        "ta",
        "te",
        "tes",
        "toi",
        "ton",
        "tu",
        "un",
        "une",
        "vos",
        "votre",
        "vous",
        "y",
        "ont",
        "sont",
        "fait",
        "faire",
        "peut",
        "plus",
        "tres",
        "bien",
        "quoi",
        "depuis",
        "quelques",
        "jours",
        "jour",
        "normal",
        "grave",
        "c",
        "est",
        "chien",
        "chienne",
        "viens",
        "dois",
        "air",
        "bien",
        "inquieter",
        "inquiete",
        "recevoir",
        "recu",
    ]
)

_SYNONYMS = {
    "dort": "sommeil",
    "dormir": "sommeil",
    "dodo": "sommeil",
    "endormi": "sommeil",
    "boite": "boiterie",
    "boiter": "boiterie",
    "patte": "membre",
    "bouge": "activite",
    "actif": "activite",
    "active": "activite",
    "promenade": "activite",
    "tousse": "toux",
    "halete": "halètement",
    "essouffle": "respiration",
    "coeur": "cardiaque",
    "battements": "cardiaque",
    "pouls": "cardiaque",
    "fatigue": "abattement",
    "mou": "abattement",
    "apathique": "abattement",
}


def fold(text: str) -> str:
    """Minuscules, sans accents."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def tokens(text: str) -> list[str]:
    words = re.findall(r"[a-z0-9]+", fold(text))
    out: list[str] = []
    for w in words:
        if w in STOPWORDS or len(w) < 2:
            continue
        out.append(fold(_SYNONYMS.get(w, w)))
    return out


def stem(word: str) -> str:
    """Racinisation grossière, suffisante pour un corpus d'amorce en français."""
    for suffix in ("ements", "ement", "ations", "ation", "euses", "euse", "eux", "es", "s", "e"):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


def stems(text: str) -> list[str]:
    return [stem(t) for t in tokens(text)]


def sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]
