"""Consignes versionnées. La version (empreinte du texte) part dans les traces et la réponse.

Changer une consigne change la version : la régression d'évals (tests/test_evals.py) le détecte.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

DIR = Path(__file__).parent / "prompts"


def load(name: str) -> str:
    return (DIR / f"{name}.md").read_text(encoding="utf-8").strip()


def version() -> str:
    digest = hashlib.sha256()
    for path in sorted(DIR.glob("*.md")):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return f"p-{digest.hexdigest()[:8]}"
