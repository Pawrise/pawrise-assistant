"""Points d'entrée en ligne de commande."""

from pawrise_assistant.config import get_settings


def dev() -> None:  # pragma: no cover - démarre un serveur, testé manuellement
    """Démarre l'API en rechargement automatique, pour le développement."""
    import uvicorn

    get_settings()  # échoue tôt si la configuration est invalide
    uvicorn.run(
        "pawrise_assistant.api.app:app",
        host="127.0.0.1",
        port=8080,
        reload=True,
    )
