from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import SecretStr
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

    llm: Literal["rules", "openai"] = "rules"
    """`rules` : composants déterministes, sans réseau. `openai` : OpenAI ou Azure OpenAI (v1)."""
    llm_base_url: str | None = None
    """Vide pour OpenAI ; l'URL de la ressource Azure OpenAI (`…/openai/v1/`) en cible EU."""
    llm_model_nano: str = "gpt-5.4-nano"
    llm_model_main: str = "gpt-5.4"

    retriever: Literal["memory", "postgres"] = "memory"
    database_url: str | None = None
    """Chaîne de connexion libpq, ex. `postgresql://pawrise@127.0.0.1:5433/pawrise`."""
    embedder: Literal["hash", "openai"] = "hash"
    reranker: Literal["overlap", "cohere"] = "overlap"
    cohere_token: SecretStr | None = None

    otel: bool = False
    """Export OTLP des spans (endpoint et en-têtes : variables OpenTelemetry standard)."""
