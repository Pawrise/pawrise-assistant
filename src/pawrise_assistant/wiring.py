"""Assemble les dépendances d'un service à partir de la configuration (`PAWRISE_*`).

Chaque brique a une version de dev (sans réseau ni secret) et une version cible :

| Brique      | dev (défaut)                     | cible                                   |
|-------------|----------------------------------|-----------------------------------------|
| LLM         | règles et gabarits               | `PAWRISE_LLM=openai` (OpenAI / Azure)   |
| Recherche   | BM25 + trigrammes en mémoire     | `PAWRISE_RETRIEVER=postgres` (pgvector) |
| Embeddings  | hachage                          | `PAWRISE_EMBEDDER=openai`               |
| Rerank      | recouvrement lexical             | `PAWRISE_RERANKER=cohere`               |
| Core API    | simulé en process                | `PAWRISE_CORE_API_URL`                  |
"""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import replace

from pawrise_assistant.api.settings import Settings
from pawrise_assistant.components.audit import AuditSink
from pawrise_assistant.components.retrieval import load_corpus
from pawrise_assistant.core_api.client import HttpCoreApi
from pawrise_assistant.graph.deps import Deps, dev_deps, llm_deps
from pawrise_assistant.llm.provider import OpenAIProvider
from pawrise_assistant.rag.embedding import Embedder, HashEmbedder, OpenAIEmbedder


class ConfigError(RuntimeError):
    pass


def build_embedder(settings: Settings) -> Embedder:
    if settings.embedder == "openai":
        from openai import AsyncOpenAI

        return OpenAIEmbedder(AsyncOpenAI(base_url=settings.llm_base_url))
    return HashEmbedder()


def build_retriever(settings: Settings) -> object:
    from pawrise_assistant.rag.pgstore import PgHybridRetriever

    if not settings.database_url:
        raise ConfigError("PAWRISE_RETRIEVER=postgres demande PAWRISE_DATABASE_URL")
    return PgHybridRetriever(settings.database_url, build_embedder(settings))


def build_deps(settings: Settings, audit: AuditSink) -> Deps:
    if settings.llm == "openai":
        provider = OpenAIProvider.from_env(
            {"nano": settings.llm_model_nano, "main": settings.llm_model_main},
            base_url=settings.llm_base_url,
            reasoning_effort=settings.llm_reasoning_effort,
        )
        deps = llm_deps(provider, audit=audit, corpus_dir=settings.corpus_dir)
    else:
        deps = dev_deps(audit=audit, corpus_dir=settings.corpus_dir)
    if settings.retriever == "postgres":
        deps = replace(deps, retriever=build_retriever(settings))  # type: ignore[arg-type]
    if settings.reranker == "cohere":
        from pawrise_assistant.rag.cohere import CohereRelevanceFilter

        if settings.cohere_token is None:
            raise ConfigError("PAWRISE_RERANKER=cohere demande PAWRISE_COHERE_TOKEN")
        deps = replace(deps, reranker=CohereRelevanceFilter(settings.cohere_token))
    if settings.core_api_url:
        deps = replace(deps, core_api=HttpCoreApi(settings.core_api_url))
    return deps


async def _ingest(settings: Settings) -> int:
    from pawrise_assistant.rag.pgstore import PgHybridRetriever

    store = build_retriever(settings)
    assert isinstance(store, PgHybridRetriever)
    await store.init_schema()
    return await store.ingest(load_corpus(settings.corpus_dir))


def ingest_main() -> None:
    """`uv run ingest` : indexe le corpus dans Postgres (plein texte + vecteurs)."""
    argparse.ArgumentParser(description=ingest_main.__doc__).parse_args()
    settings = Settings()
    n = asyncio.run(_ingest(settings))
    print(f"{n} passages indexés depuis {settings.corpus_dir} ({build_embedder(settings).name})")
