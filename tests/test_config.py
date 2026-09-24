"""La configuration a des défauts sains et lit l'environnement."""

import pytest

from pawrise_assistant.config import AuditSinkName, LLMProviderName, Settings, get_settings


def test_defauts_sains() -> None:
    settings = Settings(_env_file=None)  # type: ignore[call-arg]

    assert settings.llm_provider is LLMProviderName.OPENAI
    assert settings.audit_sink is AuditSinkName.JSONL


def test_contrainte_adr_004_par_defaut() -> None:
    """ADR-004 impose un p95 < 200 ms sur les tool calls : le timeout le reflète."""
    settings = Settings(_env_file=None)  # type: ignore[call-arg]

    assert settings.core_api_timeout_ms == 200


def test_lecture_de_l_environnement(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PAWRISE_LLM_PROVIDER", "azure_openai")

    settings = Settings(_env_file=None)  # type: ignore[call-arg]

    assert settings.llm_provider is LLMProviderName.AZURE_OPENAI


def test_provider_inconnu_rejete(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PAWRISE_LLM_PROVIDER", "llama-chez-moi")

    with pytest.raises(ValueError, match="llm_provider"):
        Settings(_env_file=None)  # type: ignore[call-arg]


def test_settings_mis_en_cache() -> None:
    assert get_settings() is get_settings()
