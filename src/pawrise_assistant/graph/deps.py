"""Dépendances injectées dans chaque tour via le contexte d'exécution LangGraph."""

from __future__ import annotations

import time
from dataclasses import dataclass, field, replace
from pathlib import Path

from pawrise_assistant.components.audit import AuditSink, MemoryAuditSink
from pawrise_assistant.components.generation import Generator, TemplateGenerator
from pawrise_assistant.components.guardrail import Guardrail, RuleGuardrail
from pawrise_assistant.components.intent import IntentClassifier, RuleIntentClassifier
from pawrise_assistant.components.retrieval import (
    OverlapRelevanceFilter,
    RelevanceFilter,
    Retriever,
    load_corpus,
)
from pawrise_assistant.components.understanding import QueryUnderstanding, RuleQueryUnderstanding
from pawrise_assistant.core_api.client import CoreApi, InMemoryCoreApi
from pawrise_assistant.knowledge import KnowledgeBase
from pawrise_assistant.llm.provider import LLMProvider

SEED_CORPUS = Path(__file__).resolve().parents[3] / "corpus" / "seed"

FAULTS = frozenset(
    {
        "classifier_down",
        "core_api_timeout",
        "retriever_down",
        "reranker_down",
        "llm_down",
        "draft_diagnostic",
        "draft_ungrounded",
    }
)
"""Pannes injectables depuis la console. Jamais acceptées par l'endpoint de prod."""


@dataclass(frozen=True)
class Deps:
    core_api: CoreApi
    classifier: IntentClassifier
    understanding: QueryUnderstanding
    retriever: Retriever
    reranker: RelevanceFilter
    generator: Generator
    guardrail: Guardrail
    audit: AuditSink
    prompt_version: str = "dev-0.1"
    faults: frozenset[str] = frozenset()
    started_at: float = field(default_factory=time.perf_counter)

    def for_run(self, faults: frozenset[str] = frozenset()) -> Deps:
        unknown = faults - FAULTS
        if unknown:
            raise ValueError(f"pannes inconnues : {sorted(unknown)}")
        return replace(self, faults=faults, started_at=time.perf_counter())

    def elapsed_ms(self) -> int:
        return round((time.perf_counter() - self.started_at) * 1000)


def dev_deps(audit: AuditSink | None = None, corpus_dir: Path = SEED_CORPUS) -> Deps:
    """Tout en mémoire, sans réseau ni clé : ce que le lot 2 démontre."""
    return Deps(
        core_api=InMemoryCoreApi(),
        classifier=RuleIntentClassifier(),
        understanding=RuleQueryUnderstanding(),
        retriever=KnowledgeBase(load_corpus(corpus_dir)),
        reranker=OverlapRelevanceFilter(),
        generator=TemplateGenerator(),
        guardrail=RuleGuardrail(),
        audit=audit or MemoryAuditSink(),
    )


def llm_deps(
    provider: LLMProvider, audit: AuditSink | None = None, corpus_dir: Path = SEED_CORPUS
) -> Deps:
    """Nœuds 1, 2, 5 et 6 servis par un LLM ; les règles restent actives sous chacun d'eux.

    Recherche et rerank restent ceux de dev tant que le lot 4 (pgvector, Cohere) n'est pas branché.
    """
    from pawrise_assistant.llm import prompts
    from pawrise_assistant.llm.components import (
        LLMGenerator,
        LLMGuardrail,
        LLMIntentClassifier,
        LLMQueryUnderstanding,
    )

    base = dev_deps(audit, corpus_dir)
    return replace(
        base,
        classifier=LLMIntentClassifier(provider),
        understanding=LLMQueryUnderstanding(provider),
        generator=LLMGenerator(provider),
        guardrail=LLMGuardrail(provider),
        prompt_version=prompts.version(),
    )
