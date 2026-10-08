"""`uv run dev` : l'API de l'assistant en mode développement, sur le port 8100.

La console se lance à côté : `npm --prefix console run dev` (port 5173, proxy vers 8100).
"""

from __future__ import annotations

import uvicorn


def main() -> None:
    uvicorn.run(
        "pawrise_assistant.api.app:create_app",
        factory=True,
        host="127.0.0.1",
        port=8100,
        reload=True,
        reload_dirs=["src"],
    )
