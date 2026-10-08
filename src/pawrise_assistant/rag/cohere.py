"""Filtre de pertinence par Cohere Rerank (ADR-003), derrière l'interface `RelevanceFilter`.

Échec : le nœud 4 échoue ouvert (top-5 du RRF), voir `graph/builder.py`.
"""

from __future__ import annotations

import httpx
from pydantic import SecretStr

from pawrise_assistant.domain.models import Chunk
from pawrise_assistant.llm.provider import LLMUnavailable

ENDPOINT = "https://api.cohere.com/v2/rerank"


class CohereRelevanceFilter:
    def __init__(
        self,
        token: SecretStr,
        model: str = "rerank-v3.5",
        threshold: float = 0.15,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.model, self.threshold = model, threshold
        self.name = f"Cohere {model}"
        self._client = httpx.AsyncClient(
            timeout=3.0,
            transport=transport,
            headers={"Authorization": f"Bearer {token.get_secret_value()}"},
        )

    async def rerank(self, query: str, chunks: list[Chunk], top_n: int) -> list[Chunk]:
        if not chunks:
            return []
        try:
            r = await self._client.post(
                ENDPOINT,
                json={
                    "model": self.model,
                    "query": query,
                    "documents": [f"{c.source} · {c.section} : {c.text}" for c in chunks],
                    "top_n": top_n,
                },
            )
            r.raise_for_status()
            results = r.json()["results"]
        except (httpx.HTTPError, KeyError, ValueError) as e:
            raise LLMUnavailable(f"Cohere rerank : {e}") from e
        return [
            chunks[x["index"]].with_scores(rerank=round(float(x["relevance_score"]), 3))
            for x in results
            if float(x["relevance_score"]) >= self.threshold
        ][:top_n]
