"""Lot 4 : embeddings, fusion RRF, rerank Cohere, store Postgres (intégration si une base est là)."""

from __future__ import annotations

import json
import os
from dataclasses import replace
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from pawrise_assistant.api.app import initial_state
from pawrise_assistant.api.settings import Settings
from pawrise_assistant.components.audit import MemoryAuditSink
from pawrise_assistant.components.retrieval import load_corpus, rrf_fuse
from pawrise_assistant.domain.models import Chunk, TurnRequest
from pawrise_assistant.graph.builder import build_graph
from pawrise_assistant.graph.deps import SEED_CORPUS, dev_deps
from pawrise_assistant.llm.provider import LLMUnavailable
from pawrise_assistant.rag.cohere import CohereRelevanceFilter
from pawrise_assistant.rag.embedding import HashEmbedder
from pawrise_assistant.wiring import ConfigError, build_deps

DB = os.environ.get("PAWRISE_TEST_DATABASE_URL")


def _chunk(cid: str, text: str = "texte") -> Chunk:
    return Chunk(chunk_id=cid, source="S", section="s", text=text)


async def test_hash_embedder_is_deterministic_normalized_and_lexically_meaningful() -> None:
    e = HashEmbedder(dims=128)
    a, b, c = await e.embed(
        ["le chocolat est toxique", "chocolat toxique pour le chien", "durée du sommeil"]
    )
    assert a == (await e.embed(["le chocolat est toxique"]))[0]
    assert sum(x * x for x in a) == pytest.approx(1.0)

    def cos(u: list[float], v: list[float]) -> float:
        return sum(x * y for x, y in zip(u, v, strict=True))

    assert cos(a, b) > cos(a, c)


def test_rrf_rewards_agreement_between_both_rankings() -> None:
    by_id = {k: _chunk(k) for k in "abcd"}
    fused = rrf_fuse(["a", "b", "c"], ["b", "d", "a"], by_id, 3)
    assert [c.chunk_id for c in fused] == ["b", "a", "d"]
    assert fused[0].scores["bm25_rank"] == 2 and fused[0].scores["dense_rank"] == 1


def _cohere(handler: Any) -> CohereRelevanceFilter:
    return CohereRelevanceFilter(SecretStr("t"), transport=httpx.MockTransport(handler))


async def test_cohere_rerank_keeps_relevant_passages_in_its_order() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["model"] == "rerank-v3.5" and len(body["documents"]) == 3
        assert request.headers["Authorization"] == "Bearer t"
        return httpx.Response(
            200,
            json={
                "results": [
                    {"index": 2, "relevance_score": 0.91},
                    {"index": 0, "relevance_score": 0.40},
                    {"index": 1, "relevance_score": 0.05},
                ]
            },
        )

    kept = await _cohere(handler).rerank("q", [_chunk("a"), _chunk("b"), _chunk("c")], 5)
    assert [(c.chunk_id, c.scores["rerank"]) for c in kept] == [("c", 0.91), ("a", 0.4)]
    assert await _cohere(handler).rerank("q", [], 5) == []


async def test_cohere_failure_is_reported_so_the_node_can_fail_open() -> None:
    with pytest.raises(LLMUnavailable):
        await _cohere(lambda r: httpx.Response(503)).rerank("q", [_chunk("a")], 5)


def test_wiring_refuses_incomplete_configuration(tmp_path: Any) -> None:
    audit = MemoryAuditSink()
    with pytest.raises(ConfigError):
        build_deps(Settings(retriever="postgres", database_url=None), audit)
    with pytest.raises(ConfigError):
        build_deps(Settings(reranker="cohere", cohere_token=None), audit)
    deps = build_deps(Settings(reranker="cohere", cohere_token=SecretStr("t")), audit)
    assert deps.reranker.name.startswith("Cohere")


@pytest.mark.skipif(not DB, reason="PAWRISE_TEST_DATABASE_URL non défini")
async def test_postgres_hybrid_retrieval_end_to_end() -> None:
    from pawrise_assistant.rag.pgstore import EmbedderMismatch, PgHybridRetriever

    assert DB is not None
    store = PgHybridRetriever(DB, HashEmbedder())
    await store.init_schema()
    assert await store.ingest(load_corpus(SEED_CORPUS)) >= 25

    # La recherche ramène large (top-20) ; c'est le reranker qui ordonne finement ensuite.
    found = await store.search("chocolat chez le chien", 20)
    top5 = [c for c in found[:5] if c.chunk_id.startswith("toxiques-courants")]
    assert top5 and top5[0].scores["bm25_rank"] >= 1 and top5[0].scores["dense_rank"] >= 1

    with pytest.raises(EmbedderMismatch):
        await _mismatch(DB)

    deps = replace(dev_deps(), retriever=store)
    req = TurnRequest(
        thread_id="t",
        turn_id="1",
        pet_ref="pet_demo_rex",
        user_message="Il a mangé du chocolat mais il a l'air bien",
    )
    out = await build_graph().ainvoke(initial_state(req), context=deps.for_run())
    assert any(c.source_id.startswith("toxiques-courants") for c in out["response"].citations)
    assert out["trace"][2].data["retriever"].startswith("Postgres")


async def _mismatch(db: str) -> None:
    from pawrise_assistant.rag.pgstore import PgHybridRetriever

    class Other(HashEmbedder):
        def __init__(self) -> None:
            super().__init__(256)
            self.name = "autre"

    await PgHybridRetriever(db, Other()).search("x", 5)
