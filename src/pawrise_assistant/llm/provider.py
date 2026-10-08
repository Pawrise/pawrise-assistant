"""Interface `LLMProvider` (ADR-002) : OpenAI en dev, Azure OpenAI EU en cible, même code.

Deux niveaux de modèle (cascade) : `nano` pour classer, comprendre et vérifier, `main` pour rédiger.
Toujours en sortie structurée, validée par Pydantic. `store=False` : rien n'est conservé chez le
fournisseur.

Le secret d'accès n'apparaît jamais dans le code : le SDK le lit dans sa variable d'environnement
standard, posée par l'opérateur.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Literal, Protocol, TypeVar

from pydantic import BaseModel

Tier = Literal["nano", "main"]
T = TypeVar("T", bound=BaseModel)

# Prix publics en $ par million de tokens (entrée, sortie), relevés le 2026-07-02 pour le dossier.
# Parité $/€ retenue. À revérifier au moment de configurer Azure (conception §6).
PRICES: dict[str, tuple[float, float]] = {
    "gpt-5.4-nano": (0.20, 1.25),
    "gpt-5.4": (2.50, 15.0),
}


@dataclass(frozen=True)
class Usage:
    model: str
    input_tokens: int
    output_tokens: int

    @property
    def cost_eur(self) -> float:
        pin, pout = PRICES.get(self.model, (0.0, 0.0))
        return (self.input_tokens * pin + self.output_tokens * pout) / 1_000_000


_usage: ContextVar[list[Usage] | None] = ContextVar("llm_usage", default=None)


@contextlib.contextmanager
def usage_scope() -> Iterator[list[Usage]]:
    """Collecte les appels LLM faits pendant un nœud, pour sa trace (tokens, coût)."""
    collected: list[Usage] = []
    token = _usage.set(collected)
    try:
        yield collected
    finally:
        _usage.reset(token)


def record(usage: Usage) -> None:
    scope = _usage.get()
    if scope is not None:
        scope.append(usage)


def summarize(usages: list[Usage]) -> dict[str, Any]:
    if not usages:
        return {}
    return {
        "models": sorted({u.model for u in usages}),
        "tokens_in": sum(u.input_tokens for u in usages),
        "tokens_out": sum(u.output_tokens for u in usages),
        "cost_eur": round(sum(u.cost_eur for u in usages), 6),
    }


class LLMUnavailable(RuntimeError):
    pass


class LLMProvider(Protocol):
    async def parse(
        self, *, tier: Tier, system: str, user: str, schema: type[T], max_tokens: int = 800
    ) -> T: ...


class OpenAIProvider:
    """Fonctionne avec OpenAI et avec l'API v1 d'Azure OpenAI (même SDK, autre `base_url`)."""

    def __init__(self, client: Any, models: dict[Tier, str]) -> None:
        self.client, self.models = client, models

    @classmethod
    def from_env(cls, models: dict[Tier, str], base_url: str | None = None) -> OpenAIProvider:
        from openai import AsyncOpenAI

        return cls(AsyncOpenAI(base_url=base_url, timeout=20.0, max_retries=1), models)

    async def parse(
        self, *, tier: Tier, system: str, user: str, schema: type[T], max_tokens: int = 800
    ) -> T:
        from pawrise_assistant.tracing import llm_span

        model = self.models[tier]
        with llm_span(model) as span:
            try:
                result = await self.client.responses.parse(
                    model=model,
                    instructions=system,
                    input=user,
                    text_format=schema,
                    max_output_tokens=max_tokens,
                    store=False,
                )
            except Exception as e:  # réseau, quota, refus : le nœud décide (fail-open ou fermé)
                span.set_attribute("error.type", type(e).__name__)
                raise LLMUnavailable(f"{model} : {e}") from e
            usage = getattr(result, "usage", None)
            if usage is not None:
                record(Usage(model, usage.input_tokens, usage.output_tokens))
                span.set_attribute("gen_ai.usage.input_tokens", usage.input_tokens)
                span.set_attribute("gen_ai.usage.output_tokens", usage.output_tokens)
        parsed = result.output_parsed
        if parsed is None:
            raise LLMUnavailable(f"{model} : sortie structurée absente")
        value: T = parsed
        return value


class ScriptedProvider:
    """Fournisseur de test : renvoie, par schéma, les réponses prévues dans l'ordre."""

    def __init__(self, script: dict[str, list[BaseModel | Exception]]) -> None:
        self.script = {k: list(v) for k, v in script.items()}
        self.calls: list[tuple[Tier, str, str, str]] = []

    async def parse(
        self, *, tier: Tier, system: str, user: str, schema: type[T], max_tokens: int = 800
    ) -> T:
        self.calls.append((tier, schema.__name__, system, user))
        queue = self.script.get(schema.__name__)
        if not queue:
            raise LLMUnavailable(f"aucune réponse scriptée pour {schema.__name__}")
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        record(Usage(f"scripted-{tier}", 100, 20))
        assert isinstance(item, schema)
        return item
