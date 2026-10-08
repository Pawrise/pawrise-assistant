"""Masquage des PII avant tout appel LLM (ADR-006, version MVP par expressions régulières)."""

from __future__ import annotations

import re

_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("email", re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")),
    ("iban", re.compile(r"\bFR\d{2}(?:\s?[\dA-Z]{4}){5}\s?[\dA-Z]{3}\b", re.I)),
    ("nir", re.compile(r"\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b")),
    ("phone", re.compile(r"(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}\b")),
    ("postcode", re.compile(r"\b\d{5}\b")),
]


def redact(text: str) -> tuple[str, dict[str, int]]:
    counts: dict[str, int] = {}
    for kind, pattern in _PATTERNS:
        text, n = pattern.subn(f"[{kind}]", text)
        if n:
            counts[kind] = n
    return text, counts
