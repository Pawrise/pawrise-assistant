"""Application FastAPI.

Le service est appelé par `pawrise-dialog`, jamais directement par l'application mobile
(conception §1.3). Les routes de conversation arrivent au lot 2.
"""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from pawrise_assistant import __version__


class Health(BaseModel):
    """Réponse de la sonde de disponibilité."""

    status: Literal["ok"]
    version: str


def create_app() -> FastAPI:
    """Construit l'application. Factory, pour que les tests isolent chaque instance."""
    app = FastAPI(
        title="Pawrise Assistant",
        version=__version__,
        description="Assistant conversationnel — pipeline LangGraph borné, garde-fous 3 couches.",
    )

    @app.get("/health", response_model=Health, tags=["ops"])
    async def health() -> Health:
        """Sonde de disponibilité, consommée par Kubernetes."""
        return Health(status="ok", version=__version__)

    return app


app = create_app()
