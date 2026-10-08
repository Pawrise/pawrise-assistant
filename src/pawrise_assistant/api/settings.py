from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from pawrise_assistant.graph.deps import SEED_CORPUS


class Settings(BaseSettings):
    """Lu depuis les variables d'environnement préfixées `PAWRISE_`."""

    model_config = SettingsConfigDict(env_prefix="PAWRISE_", extra="ignore")

    debug_api: bool = True
    """Active /debug/* (flux de la console, pannes injectées). À False en prod."""
    audit_path: Path = Path("var/audit.jsonl")
    corpus_dir: Path = SEED_CORPUS
    core_api_url: str | None = None
    """None : Core API simulé en process."""
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
