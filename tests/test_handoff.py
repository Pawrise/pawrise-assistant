"""Flux E : le dossier pré-consultation."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from pawrise_assistant.api.app import create_app
from pawrise_assistant.api.settings import Settings
from pawrise_assistant.components.audit import MemoryAuditSink
from pawrise_assistant.domain.models import Turn
from pawrise_assistant.graph.deps import Deps
from pawrise_assistant.handoff.graph import (
    HandoffState,
    build_handoff_graph,
    generate_handoff_summary,
    verify,
)
from pawrise_assistant.handoff.models import HandoffRequest, HandoffSummary, Sourced
from tests.test_api import _events

EXTRACTS = [
    Turn(role="owner", content="Je viens de recevoir l'alerte, je dois m'inquiéter ?"),
    Turn(role="assistant", content="L'alerte indique une baisse d'activité…"),
    Turn(role="owner", content="Elle mange moins depuis deux jours aussi."),
]


async def test_dossier_is_dated_sourced_and_non_diagnostic(
    deps: Deps, audit: MemoryAuditSink
) -> None:
    req = HandoffRequest(thread_id="th", pet_ref="pet_demo_nala", thread_extracts=EXTRACTS)
    s = await generate_handoff_summary(build_handoff_graph(), req, deps.for_run())
    assert s.pet is not None and s.pet.name == "Nala"
    assert s.urgency == "medium"
    assert [e.days_ago for e in s.timeline] == sorted(
        (e.days_ago for e in s.timeline), reverse=True
    )
    assert {e.source for e in s.timeline} == {"alert:A-0192", "alert:A-0187", "telemetry"}
    assert [o.source for o in s.owner_reported] == ["thread:1", "thread:3"]
    assert any(o.source == "profile" for o in s.observations)
    assert "n'est pas un diagnostic" in s.disclaimer
    assert audit.events[-1]["kind"] == "handoff_summary"


async def test_urgent_signal_in_thread_raises_urgency(deps: Deps) -> None:
    req = HandoffRequest(
        thread_id="th",
        pet_ref="pet_demo_rex",
        thread_extracts=[Turn(role="owner", content="Il a mangé du raisin cet après-midi")],
    )
    s = await generate_handoff_summary(build_handoff_graph(), req, deps.for_run())
    assert s.urgency == "high"
    assert s.reason == "Il a mangé du raisin cet après-midi"


async def test_verify_blocks_diagnostic_wording_written_by_the_assistant() -> None:
    summary = HandoffSummary(
        pet=None,
        reason="Boiterie",
        urgency="low",
        timeline=[],
        owner_reported=[],
        observations=[Sourced(text="Il s'agit probablement d'une dysplasie.", source="profile")],
    )
    state: HandoffState = {
        "request": HandoffRequest(thread_id="t", pet_ref="p"),
        "summary": summary,
        "trace": [],
    }
    out = await verify(state)
    assert out["problems"] and "diagnostique" in out["problems"][0]


@pytest.fixture
def client(deps: Deps, tmp_path: Any) -> TestClient:
    return TestClient(create_app(Settings(audit_path=tmp_path / "a.jsonl"), deps=deps))


def test_handoff_endpoints(client: TestClient) -> None:
    body = {
        "thread_id": "th",
        "pet_ref": "pet_demo_nala",
        "thread_extracts": [t.model_dump() for t in EXTRACTS],
    }
    r = client.post("/v1/handoff-summaries", json=body)
    assert r.status_code == 200
    assert r.json()["urgency"] == "medium"

    topo = client.get("/graph", params={"name": "handoff"}).json()
    assert [n["id"] for n in topo["nodes"]][1:6] == [
        "collect",
        "timeline",
        "synthesize",
        "verify",
        "finalize",
    ]

    with client.stream("POST", "/debug/handoff-runs", json=body) as s:
        events = _events(s.read().decode())
    assert [e["node"] for e in events if e["type"] == "node_finished"] == [
        "collect",
        "timeline",
        "synthesize",
        "verify",
        "finalize",
    ]
    assert events[-1]["summary"]["urgency"] == "medium"


def test_unknown_pet_degrades_instead_of_failing(client: TestClient) -> None:
    r = client.post("/v1/handoff-summaries", json={"thread_id": "t", "pet_ref": "pet_inconnu"})
    assert r.status_code == 200
    assert r.json()["pet"] is None
