"""Corpus dans PostgreSQL : index plein texte (français) et index vectoriel pgvector (§5.2).

Les deux classements vivent dans le même moteur ; la fusion RRF se fait ensuite, sur les rangs.
"""

from __future__ import annotations

from typing import Any

import psycopg
from pgvector import Vector
from pgvector.psycopg import register_vector_async

from pawrise_assistant.components.retrieval import rrf_fuse
from pawrise_assistant.domain.models import Chunk
from pawrise_assistant.rag.embedding import Embedder

SCHEMA = """
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS corpus_chunks (
    chunk_id  text PRIMARY KEY,
    source    text NOT NULL,
    section   text NOT NULL,
    body      text NOT NULL,
    tsv       tsvector GENERATED ALWAYS AS (
                  to_tsvector('french', source || ' ' || section || ' ' || body)) STORED,
    embedding vector({dims}) NOT NULL,
    embedder  text NOT NULL
);
CREATE INDEX IF NOT EXISTS corpus_chunks_tsv ON corpus_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS corpus_chunks_embedding
    ON corpus_chunks USING hnsw (embedding vector_cosine_ops);
"""

# plainto_tsquery joint les termes par ET ; une question de propriétaire en contient trop pour
# qu'un passage les ait tous. On les joint par OU et on laisse le classement trier.
_LEXICAL = """
SELECT chunk_id, source, section, body
FROM corpus_chunks,
     (SELECT replace(plainto_tsquery('french', %s)::text, '&', '|') AS raw) AS terms,
     LATERAL (SELECT CASE WHEN terms.raw = '' THEN NULL ELSE terms.raw::tsquery END AS q) AS query
WHERE query.q IS NOT NULL AND tsv @@ query.q
ORDER BY ts_rank_cd(tsv, query.q) DESC
LIMIT %s
"""
_DENSE = """
SELECT chunk_id, source, section, body
FROM corpus_chunks
ORDER BY embedding <=> %s
LIMIT %s
"""


class EmbedderMismatch(RuntimeError):
    pass


class PgHybridRetriever:
    def __init__(self, conninfo: str, embedder: Embedder) -> None:
        self.conninfo, self.embedder = conninfo, embedder
        self.name = f"Postgres FTS ∥ pgvector ({embedder.name}) → RRF"

    async def _connect(self) -> psycopg.AsyncConnection[Any]:
        conn = await psycopg.AsyncConnection.connect(self.conninfo, autocommit=True)
        await register_vector_async(conn)
        return conn

    async def init_schema(self) -> None:
        async with await psycopg.AsyncConnection.connect(self.conninfo, autocommit=True) as conn:
            await conn.execute(SCHEMA.format(dims=self.embedder.dims))

    async def ingest(self, chunks: list[Chunk], batch: int = 64) -> int:
        async with await self._connect() as conn:
            for i in range(0, len(chunks), batch):
                part = chunks[i : i + batch]
                vectors = await self.embedder.embed(
                    [f"{c.source} · {c.section} : {c.text}" for c in part]
                )
                async with conn.cursor() as cur:
                    await cur.executemany(
                        """INSERT INTO corpus_chunks (chunk_id, source, section, body, embedding, embedder)
                           VALUES (%s, %s, %s, %s, %s, %s)
                           ON CONFLICT (chunk_id) DO UPDATE SET source = EXCLUDED.source,
                               section = EXCLUDED.section, body = EXCLUDED.body,
                               embedding = EXCLUDED.embedding, embedder = EXCLUDED.embedder""",
                        [
                            (c.chunk_id, c.source, c.section, c.text, Vector(v), self.embedder.name)
                            for c, v in zip(part, vectors, strict=True)
                        ],
                    )
        return len(chunks)

    # — Suivi des modifications faites depuis la console (`KnowledgeBase`) —

    async def upsert(self, chunks: list[Chunk]) -> None:
        await self.ingest(chunks)

    async def delete(self, chunk_ids: list[str]) -> None:
        async with await self._connect() as conn:
            await conn.execute("DELETE FROM corpus_chunks WHERE chunk_id = ANY(%s)", (chunk_ids,))

    async def replace_all(self, chunks: list[Chunk]) -> None:
        async with await self._connect() as conn:
            await conn.execute("TRUNCATE corpus_chunks")
        await self.ingest(chunks)

    async def search(self, query: str, top_k: int) -> list[Chunk]:
        (qv,) = await self.embedder.embed([query])
        async with await self._connect() as conn:
            row = await (
                await conn.execute("SELECT DISTINCT embedder FROM corpus_chunks LIMIT 2")
            ).fetchall()
            if row and [r[0] for r in row] != [self.embedder.name]:
                raise EmbedderMismatch(
                    f"corpus indexé avec {[r[0] for r in row]}, requête avec {self.embedder.name} : "
                    "relancer `uv run ingest`"
                )
            lexical = await (await conn.execute(_LEXICAL, (query, top_k))).fetchall()
            dense = await (await conn.execute(_DENSE, (Vector(qv), top_k))).fetchall()
        by_id = {
            r[0]: Chunk(chunk_id=r[0], source=r[1], section=r[2], text=r[3])
            for r in [*lexical, *dense]
        }
        return rrf_fuse([r[0] for r in lexical], [r[0] for r in dense], by_id, top_k)
