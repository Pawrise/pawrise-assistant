"""Corpus éditable en session, pour la console (vue Connaissances).

`KnowledgeBase` implémente le protocole `Retriever` et remplace `deps.retriever` : une fiche
modifiée, désactivée ou ajoutée change aussitôt ce que l'assistant trouve. En mémoire, l'index
BM25/trigrammes est reconstruit à chaque modification ; avec Postgres, seule la ligne concernée
est ré-embarquée ou retirée. Une fiche désactivée reste listée mais n'est plus cherchable.

C'est un bac à sable de démonstration : `reset` remet le corpus d'amorce. En prod, modifier le
corpus médical passe par une relecture vétérinaire, pas par cette route.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Literal, Protocol

from pydantic import BaseModel

from pawrise_assistant.components.retrieval import InMemoryHybridRetriever
from pawrise_assistant.domain.models import Chunk

Origin = Literal["seed", "edited", "added"]


class ChunkStore(Protocol):
    """Ce qu'un index persistant (Postgres) doit savoir faire pour suivre les modifications."""

    name: str

    async def search(self, query: str, top_k: int) -> list[Chunk]: ...

    async def upsert(self, chunks: list[Chunk]) -> None: ...

    async def delete(self, chunk_ids: list[str]) -> None: ...

    async def replace_all(self, chunks: list[Chunk]) -> None: ...


class ChunkView(BaseModel):
    chunk_id: str
    section: str
    text: str
    enabled: bool
    origin: Origin


class DocView(BaseModel):
    doc_id: str
    title: str
    origin: Literal["seed", "added"]
    chunks: list[ChunkView]


class UnknownChunk(LookupError):
    pass


class InvalidDocument(ValueError):
    pass


@dataclass
class _Entry:
    chunk: Chunk
    enabled: bool = True
    origin: Origin = "seed"


@dataclass
class _Doc:
    title: str
    origin: Literal["seed", "added"]
    entries: list[_Entry] = field(default_factory=list)


def _slug(title: str) -> str:
    folded = unicodedata.normalize("NFKD", title.lower())
    ascii_only = "".join(c for c in folded if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-") or "fiche"


class KnowledgeBase:
    def __init__(
        self,
        seed: list[Chunk],
        store: ChunkStore | None = None,
        embedder: str = "aucun : trigrammes de caractères (dev)",
    ) -> None:
        self._seed = list(seed)
        self._store = store
        self.embedder = embedder
        """Ce qui donne le sens des passages, affiché par la console."""
        self._docs: dict[str, _Doc] = {}
        self._load(self._seed)
        self.name = store.name if store else self._memory.name

    # — Protocole Retriever —

    async def search(self, query: str, top_k: int) -> list[Chunk]:
        if self._store:
            return await self._store.search(query, top_k)
        return await self._memory.search(query, top_k)

    # — Lecture —

    def documents(self) -> list[DocView]:
        return [
            DocView(
                doc_id=doc_id,
                title=doc.title,
                origin=doc.origin,
                chunks=[self._view(e) for e in doc.entries],
            )
            for doc_id, doc in self._docs.items()
        ]

    def enabled_chunks(self) -> list[Chunk]:
        return [e.chunk for d in self._docs.values() for e in d.entries if e.enabled]

    # — Écriture —

    async def update_chunk(
        self,
        chunk_id: str,
        *,
        text: str | None = None,
        section: str | None = None,
        enabled: bool | None = None,
    ) -> ChunkView:
        entry = self._entry(chunk_id)
        content = {}
        if text is not None and text.strip() != entry.chunk.text:
            content["text"] = " ".join(text.split())
        if section is not None and section.strip() != entry.chunk.section:
            content["section"] = section.strip()
        if content:
            entry.chunk = entry.chunk.model_copy(update=content)
            if entry.origin == "seed":
                entry.origin = "edited"
        was_enabled = entry.enabled
        if enabled is not None:
            entry.enabled = enabled
        await self._sync(entry, changed=bool(content), was_enabled=was_enabled)
        return self._view(entry)

    async def delete_chunk(self, chunk_id: str) -> None:
        doc_id = chunk_id.partition("#")[0]
        entry = self._entry(chunk_id)
        doc = self._docs[doc_id]
        doc.entries.remove(entry)
        if not doc.entries:
            del self._docs[doc_id]
        if self._store:
            await self._store.delete([chunk_id])
        else:
            self._rebuild()

    async def add_document(self, title: str, sections: list[tuple[str, str]]) -> DocView:
        title = title.strip()
        kept = [(s.strip(), " ".join(t.split())) for s, t in sections if t.strip()]
        if not title or not kept:
            raise InvalidDocument("une fiche demande un titre et au moins une section non vide")
        base = _slug(title)
        doc_id, n = base, 2
        while doc_id in self._docs:
            doc_id, n = f"{base}-{n}", n + 1
        doc = _Doc(title=title, origin="added")
        for i, (section, text) in enumerate(kept, start=1):
            chunk = Chunk(
                chunk_id=f"{doc_id}#{i}", source=title, section=section or title, text=text
            )
            doc.entries.append(_Entry(chunk=chunk, origin="added"))
        self._docs[doc_id] = doc
        if self._store:
            await self._store.upsert([e.chunk for e in doc.entries])
        else:
            self._rebuild()
        return next(d for d in self.documents() if d.doc_id == doc_id)

    async def reset(self) -> list[DocView]:
        self._load(self._seed)
        if self._store:
            await self._store.replace_all(self._seed)
        return self.documents()

    # — Interne —

    def _load(self, chunks: list[Chunk]) -> None:
        self._docs = {}
        for c in chunks:
            doc_id = c.chunk_id.partition("#")[0]
            doc = self._docs.setdefault(doc_id, _Doc(title=c.source, origin="seed"))
            doc.entries.append(_Entry(chunk=c))
        self._rebuild()

    def _rebuild(self) -> None:
        self._memory = InMemoryHybridRetriever(self.enabled_chunks())

    def _entry(self, chunk_id: str) -> _Entry:
        doc = self._docs.get(chunk_id.partition("#")[0])
        entry = (
            next((e for e in doc.entries if e.chunk.chunk_id == chunk_id), None) if doc else None
        )
        if entry is None:
            raise UnknownChunk(chunk_id)
        return entry

    async def _sync(self, entry: _Entry, *, changed: bool, was_enabled: bool) -> None:
        if not self._store:
            self._rebuild()
            return
        if not entry.enabled:
            if was_enabled:
                await self._store.delete([entry.chunk.chunk_id])
        elif changed or not was_enabled:
            await self._store.upsert([entry.chunk])

    @staticmethod
    def _view(e: _Entry) -> ChunkView:
        return ChunkView(
            chunk_id=e.chunk.chunk_id,
            section=e.chunk.section,
            text=e.chunk.text,
            enabled=e.enabled,
            origin=e.origin,
        )
