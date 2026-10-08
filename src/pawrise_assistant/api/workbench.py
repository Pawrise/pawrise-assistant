"""Routes de l'atelier de la console : connaissances, chiens, règles, évaluations, audit.

Toutes sous `/debug`, donc coupées avec `PAWRISE_DEBUG_API=false`. Les modifications (corpus,
données des chiens) vivent le temps du process : c'est un bac à sable de démonstration, que
`reset` remet à l'état d'origine.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import asdict, replace
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from pawrise_assistant.api import catalog
from pawrise_assistant.api.settings import Settings
from pawrise_assistant.components.audit import MemoryAuditSink, recent
from pawrise_assistant.core_api import fake_data
from pawrise_assistant.core_api.client import InMemoryCoreApi
from pawrise_assistant.graph.deps import Deps
from pawrise_assistant.graph.nodes import TOP_K, TOP_N
from pawrise_assistant.knowledge import (
    ChunkView,
    DocView,
    InvalidDocument,
    KnowledgeBase,
    UnknownChunk,
)

EVAL_CONCURRENCY = 4


class ChunkPatch(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=4000)
    section: str | None = Field(default=None, min_length=1, max_length=200)
    enabled: bool | None = None


class NewSection(BaseModel):
    section: str = Field(default="", max_length=200)
    text: str = Field(max_length=4000)


class NewDocument(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    sections: list[NewSection] = Field(min_length=1, max_length=30)


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)


class PetPatch(BaseModel):
    activity_drop_pct: float | None = Field(default=None, ge=0, le=80)
    sleep_rise_pct: float | None = Field(default=None, ge=0, le=60)
    alert: bool | None = None


def _pet_view(pet_ref: str) -> dict[str, Any]:
    profile = fake_data.PROFILES[pet_ref]
    return {
        **profile.model_dump(),
        "series": [
            {"days_ago": i, **asdict(day)} for i, day in enumerate(fake_data.SERIES[pet_ref])
        ],
        "alerts": [a.model_dump() for a in fake_data.ALERTS[pet_ref]],
        "summary": fake_data.summarize(pet_ref, fake_data.RECENT_DAYS).model_dump(),
        "controls": asdict(fake_data.controls(pet_ref)),
        "modified": fake_data.modified(pet_ref),
    }


def _sse(event: dict[str, Any]) -> dict[str, str]:
    return {"event": event["type"], "data": json.dumps(event, ensure_ascii=False, default=str)}


def workbench_router(settings: Settings, deps: Deps) -> APIRouter:
    router = APIRouter(prefix="/debug")
    kb = deps.retriever if isinstance(deps.retriever, KnowledgeBase) else None
    pets_editable = isinstance(deps.core_api, InMemoryCoreApi)

    def knowledge() -> KnowledgeBase:
        if kb is None:
            raise HTTPException(409, "corpus non modifiable dans cette configuration")
        return kb

    def editable_pet(pet_ref: str) -> None:
        if not pets_editable:
            raise HTTPException(409, "données des chiens servies par un Core API externe")
        if pet_ref not in fake_data.PROFILES:
            raise HTTPException(404, f"chien inconnu : {pet_ref}")

    def overview() -> dict[str, Any]:
        base = knowledge()
        return {
            "retriever": base.name,
            "reranker": deps.reranker.name,
            "embedder": base.embedder,
            "documents": [d.model_dump() for d in base.documents()],
        }

    # — Fiches santé —

    @router.get("/knowledge")
    async def get_knowledge() -> dict[str, Any]:
        return overview()

    @router.patch("/knowledge/chunks/{chunk_id:path}")
    async def patch_chunk(chunk_id: str, body: ChunkPatch) -> ChunkView:
        try:
            return await knowledge().update_chunk(
                chunk_id, text=body.text, section=body.section, enabled=body.enabled
            )
        except UnknownChunk as e:
            raise HTTPException(404, f"passage inconnu : {chunk_id}") from e

    @router.delete("/knowledge/chunks/{chunk_id:path}", status_code=204)
    async def delete_chunk(chunk_id: str) -> Response:
        try:
            await knowledge().delete_chunk(chunk_id)
        except UnknownChunk as e:
            raise HTTPException(404, f"passage inconnu : {chunk_id}") from e
        return Response(status_code=204)

    @router.post("/knowledge/documents")
    async def add_document(body: NewDocument) -> DocView:
        try:
            return await knowledge().add_document(
                body.title, [(s.section, s.text) for s in body.sections]
            )
        except InvalidDocument as e:
            raise HTTPException(422, str(e)) from e

    @router.post("/knowledge/reset")
    async def reset_knowledge() -> dict[str, Any]:
        await knowledge().reset()
        return overview()

    @router.post("/knowledge/search")
    async def search(body: SearchRequest) -> dict[str, Any]:
        """Les nœuds 3 et 4 seuls, sur la question telle quelle (sans reformulation)."""
        found = await deps.retriever.search(body.query, TOP_K)
        kept = await deps.reranker.rerank(body.query, found, TOP_N)
        kept_ids = {c.chunk_id for c in kept}
        return {
            "query": body.query,
            "retrieval": {
                "retriever": deps.retriever.name,
                "candidates": [
                    {
                        "id": c.chunk_id,
                        **c.scores,
                        "source": c.source,
                        "section": c.section,
                        "text": c.text,
                    }
                    for c in found
                ],
            },
            "relevance": {
                "reranker": deps.reranker.name,
                "kept": [{"id": c.chunk_id, **c.scores} for c in kept],
                "dropped": [c.chunk_id for c in found if c.chunk_id not in kept_ids],
            },
        }

    # — Chiens —

    @router.get("/pets")
    async def get_pets() -> list[dict[str, Any]]:
        return [_pet_view(ref) for ref in fake_data.PROFILES]

    @router.patch("/pets/{pet_ref}")
    async def patch_pet(pet_ref: str, body: PetPatch) -> dict[str, Any]:
        editable_pet(pet_ref)
        fake_data.apply(
            pet_ref,
            activity_drop_pct=body.activity_drop_pct,
            sleep_rise_pct=body.sleep_rise_pct,
            alert=body.alert,
        )
        return _pet_view(pet_ref)

    @router.post("/pets/reset")
    async def reset_pets() -> list[dict[str, Any]]:
        if not pets_editable:
            raise HTTPException(409, "données des chiens servies par un Core API externe")
        fake_data.reset()
        return [_pet_view(ref) for ref in fake_data.PROFILES]

    # — Règles et textes —

    @router.get("/rules")
    async def rules() -> dict[str, Any]:
        return catalog.catalog()

    # — Évaluations —

    @router.post("/evals")
    async def run_evals() -> EventSourceResponse:
        from pawrise_assistant import evals  # evals importe api.app : import tardif

        sets = evals.load_sets(settings.evals_dir)
        # Le journal d'audit reste celui des vrais tours : les cas d'éval n'y sont pas écrits.
        eval_deps = replace(deps, audit=MemoryAuditSink())

        async def stream() -> AsyncIterator[dict[str, str]]:
            total = sum(len(c) for c in sets.values())
            validated = all(c.get("validated") for cases in sets.values() for c in cases)
            yield _sse({"type": "eval_started", "total": total, "validated": validated})
            outputs: dict[str, dict[str, Any]] = {}
            try:
                async for name, case, out in evals.run_cases(sets, eval_deps, EVAL_CONCURRENCY):
                    outputs[case["id"]] = out
                    r = out["response"]
                    yield _sse(
                        {
                            "type": "eval_case",
                            "set": name,
                            "id": case["id"],
                            "message": case["message"],
                            "intent": out.get("intent"),
                            "template_id": r.metadata.template_id,
                            "escalate": r.escalation.trigger,
                            "urgency": r.escalation.urgency,
                            "latency_ms": r.metadata.latency_ms,
                            "response_text": r.response_text,
                            "citations": [c.source_id for c in r.citations],
                        }
                    )
                report = evals.build_report(sets, outputs)
            except Exception as e:  # le flux dit toujours comment il finit
                yield _sse({"type": "eval_error", "message": str(e) or repr(e)})
                return
            yield _sse(
                {
                    "type": "eval_finished",
                    "report": {
                        "passed": report.passed,
                        "validated": report.validated,
                        "cases": report.cases,
                        "kpis": [{**asdict(k), "passed": k.passed} for k in report.kpis],
                    },
                }
            )

        return EventSourceResponse(stream())

    # — Journal d'audit —

    @router.get("/audit")
    async def audit(limit: int = 50) -> list[dict[str, Any]]:
        return recent(deps.audit, max(1, min(limit, 500)))

    return router
