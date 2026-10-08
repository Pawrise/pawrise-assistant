"""Embeddings pour la recherche dense (ADR-008).

- `HashEmbedder` : dev, sans réseau. Astuce de hachage sur racines et trigrammes : capte le
  recouvrement lexical flou, pas le sens. Étiqueté comme tel dans les traces.
- `OpenAIEmbedder` : cible. `text-embedding-3-large` réduit à 1024 dimensions (l'index HNSW de
  pgvector est limité à 2000).
"""

from __future__ import annotations

import hashlib
import math
from typing import Any, Protocol

from pawrise_assistant.components.text import fold, stems
from pawrise_assistant.llm.provider import LLMUnavailable, Usage, record


class Embedder(Protocol):
    name: str
    dims: int

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


def _normalize(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v] if n else v


class HashEmbedder:
    def __init__(self, dims: int = 256) -> None:
        self.dims = dims
        self.name = f"hachage-{dims} (dev)"

    def _features(self, text: str) -> list[str]:
        padded = f"  {fold(text)}  "
        trigrams = [padded[i : i + 3] for i in range(len(padded) - 2)]
        return [*(f"w:{s}" for s in stems(text)), *(f"t:{t}" for t in trigrams)]

    async def embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for text in texts:
            v = [0.0] * self.dims
            for f in self._features(text):
                h = int.from_bytes(hashlib.blake2b(f.encode(), digest_size=8).digest(), "big")
                v[h % self.dims] += 1.0 if (h >> 32) & 1 else -1.0
            out.append(_normalize(v))
        return out


class OpenAIEmbedder:
    def __init__(
        self, client: Any, model: str = "text-embedding-3-large", dims: int = 1024
    ) -> None:
        self.client, self.model, self.dims = client, model, dims
        self.name = f"{model}-{dims}"

    async def embed(self, texts: list[str]) -> list[list[float]]:
        try:
            r = await self.client.embeddings.create(
                model=self.model, input=texts, dimensions=self.dims
            )
        except Exception as e:
            raise LLMUnavailable(f"embeddings : {e}") from e
        if getattr(r, "usage", None) is not None:
            record(Usage(self.model, r.usage.prompt_tokens, 0))
        return [d.embedding for d in r.data]
