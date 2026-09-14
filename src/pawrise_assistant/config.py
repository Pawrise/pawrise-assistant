"""Configuration du service, lue depuis l'environnement."""

from enum import StrEnum
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class LLMProviderName(StrEnum):
    """Providers supportés derrière l'interface `LLMProvider` (ADR-002)."""

    OPENAI = "openai"
    AZURE_OPENAI = "azure_openai"
    MISTRAL = "mistral"


class AuditSinkName(StrEnum):
    """Destinations du journal d'audit (ADR-010)."""

    JSONL = "jsonl"
    OBJECT_STORAGE = "object_storage"


class Settings(BaseSettings):
    """Configuration du service.

    Toutes les variables sont préfixées `PAWRISE_`. Voir `.env.example`.
    """

    model_config = SettingsConfigDict(
        env_prefix="PAWRISE_",
        env_file=".env",
        extra="ignore",
    )

    # — LLM (ADR-002) —
    llm_provider: LLMProviderName = LLMProviderName.OPENAI
    openai_api_key: str = ""
    azure_openai_endpoint: str = ""
    azure_openai_api_key: str = ""

    # — Reranking (ADR-003) —
    cohere_api_key: str = ""

    # — Données (conception §5.2) —
    database_url: str = "postgresql://pawrise:pawrise@localhost:5432/pawrise_assistant"

    # — Core API (ADR-004) —
    core_api_url: str = "http://localhost:8081"
    core_api_timeout_ms: int = Field(
        default=200,
        description="Contrainte ADR-004 : p95 < 200 ms, repli gracieux au-delà.",
    )

    # — Audit (ADR-010) —
    audit_sink: AuditSinkName = AuditSinkName.JSONL
    audit_path: Path = Path("./audit")


@lru_cache
def get_settings() -> Settings:
    """Configuration du processus, résolue une seule fois."""
    return Settings()
