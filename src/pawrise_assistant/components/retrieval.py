"""Nœuds 3 et 4 : retrieval hybride (ADR-008) et filtre de pertinence (ADR-003).

Implémentations de dev, en mémoire et sans dépendance réseau :
- lexical : BM25 ;
- « dense » : similarité cosinus sur trigrammes de caractères. Ce n'est pas un embedding : il
  remplace pgvector tant que le lot 4 n'est pas fait, et il est étiqueté comme tel dans la trace ;
- fusion : Reciprocal Rank Fusion (k = 60), seuls les rangs comptent ;
- rerank : recouvrement lexical normalisé, en attendant Cohere Rerank 3.5.

Les interfaces `Retriever` et `RelevanceFilter` restent celles des implémentations finales.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from pawrise_assistant.components.text import fold, stems
from pawrise_assistant.domain.models import Chunk

RRF_K = 60


class Retriever(Protocol):
    name: str

    async def search(self, query: str, top_k: int) -> list[Chunk]: ...


class RelevanceFilter(Protocol):
    name: str

    async def rerank(self, query: str, chunks: list[Chunk], top_n: int) -> list[Chunk]: ...


def load_corpus(directory: Path) -> list[Chunk]:
    """Une section `##` = un chunk. L'identifiant est stable : `fichier#n`."""
    chunks: list[Chunk] = []
    for path in sorted(directory.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        title_match = re.search(r"^# (.+)$", text, flags=re.M)
        title = title_match.group(1).strip() if title_match else path.stem
        for n, block in enumerate(re.split(r"^## ", text, flags=re.M)[1:], start=1):
            heading, _, body = block.partition("\n")
            chunks.append(
                Chunk(
                    chunk_id=f"{path.stem}#{n}",
                    source=title,
                    section=heading.strip(),
                    text=" ".join(body.split()),
                )
            )
    return chunks


@dataclass
class _Bm25:
    docs: list[list[str]]
    k1: float = 1.2
    b: float = 0.75

    def __post_init__(self) -> None:
        self.avgdl = sum(map(len, self.docs)) / max(len(self.docs), 1)
        df: Counter[str] = Counter()
        for d in self.docs:
            df.update(set(d))
        n = len(self.docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        self.tf = [Counter(d) for d in self.docs]

    def scores(self, query: list[str]) -> list[float]:
        out = []
        for tf, doc in zip(self.tf, self.docs, strict=True):
            s = 0.0
            for t in query:
                if t in tf:
                    f = tf[t]
                    s += (
                        self.idf[t]
                        * f
                        * (self.k1 + 1)
                        / (f + self.k1 * (1 - self.b + self.b * len(doc) / self.avgdl))
                    )
            out.append(s)
        return out


def _trigrams(text: str) -> Counter[str]:
    t = f"  {fold(text)}  "
    return Counter(t[i : i + 3] for i in range(len(t) - 2))


def _cosine(a: Counter[str], b: Counter[str]) -> float:
    dot = sum(v * b[k] for k, v in a.items() if k in b)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def _ranks(scores: list[float], top_k: int) -> dict[int, int]:
    order = sorted((i for i, s in enumerate(scores) if s > 0), key=lambda i: -scores[i])
    return {i: r for r, i in enumerate(order[:top_k], start=1)}


class InMemoryHybridRetriever:
    name = "bm25 + trigrammes (dev) → RRF"

    def __init__(self, chunks: list[Chunk]) -> None:
        self.chunks = chunks
        self._bm25 = _Bm25([stems(f"{c.source} {c.section} {c.text}") for c in chunks])
        self._vecs = [_trigrams(f"{c.section} {c.text}") for c in chunks]

    async def search(self, query: str, top_k: int) -> list[Chunk]:
        lex = _ranks(self._bm25.scores(stems(query)), top_k)
        qv = _trigrams(query)
        dense = _ranks([_cosine(qv, v) for v in self._vecs], top_k)
        ids = [c.chunk_id for c in self.chunks]
        return rrf_fuse(
            [ids[i] for i in sorted(lex, key=lex.__getitem__)],
            [ids[i] for i in sorted(dense, key=dense.__getitem__)],
            {c.chunk_id: c for c in self.chunks},
            top_k,
        )


def rrf_fuse(
    lexical: list[str], dense: list[str], by_id: dict[str, Chunk], top_k: int
) -> list[Chunk]:
    """Reciprocal Rank Fusion : chaque liste (ordonnée) contribue 1 / (k + rang)."""
    lex = {cid: r for r, cid in enumerate(lexical, start=1)}
    den = {cid: r for r, cid in enumerate(dense, start=1)}
    fused = {
        cid: sum(1 / (RRF_K + ranks[cid]) for ranks in (lex, den) if cid in ranks)
        for cid in {*lex, *den}
    }
    order = sorted(fused, key=lambda cid: (-fused[cid], cid))[:top_k]
    return [
        by_id[cid].with_scores(
            bm25_rank=lex.get(cid, 0),
            dense_rank=den.get(cid, 0),
            rrf=round(fused[cid], 5),
            rrf_rank=r,
        )
        for r, cid in enumerate(order, start=1)
    ]


class OverlapRelevanceFilter:
    """Remplaçant de dev du reranker : part (pondérée par la rareté) des termes de la requête
    présents dans le chunk."""

    name = "recouvrement lexical (dev)"

    def __init__(self, threshold: float = 0.15) -> None:
        self.threshold = threshold

    async def rerank(self, query: str, chunks: list[Chunk], top_n: int) -> list[Chunk]:
        q = set(stems(query))
        if not q or not chunks:
            return chunks[:top_n]
        docs = [set(stems(f"{c.source} {c.section} {c.text}")) for c in chunks]
        n = len(docs)
        idf = {t: math.log(1 + n / (1 + sum(t in d for d in docs))) for t in q}
        total = sum(idf.values())
        scored = sorted(
            ((sum(idf[t] for t in q & d) / total, c) for d, c in zip(docs, chunks, strict=True)),
            key=lambda x: -x[0],
        )
        kept = [c.with_scores(rerank=round(s, 3)) for s, c in scored if s >= self.threshold]
        return kept[:top_n]
