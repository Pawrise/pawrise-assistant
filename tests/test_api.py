from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from pawrise_assistant.api.app import create_app
from pawrise_assistant.api.settings import Settings
from pawrise_assistant.core_api.client import HttpCoreApi, UnknownPet
from pawrise_assistant.core_api.fake_app import app as fake_core_app
from pawrise_assistant.graph.builder import ON_ERROR, build_graph
from pawrise_assistant.graph.deps import Deps
from pawrise_assistant.graph.topology import NODE_META, build_topology


@pytest.fixture
def client(deps: Deps, tmp_path: Any) -> TestClient:
    return TestClient(create_app(Settings(audit_path=tmp_path / "a.jsonl"), deps=deps))


def _events(body: str) -> list[dict[str, Any]]:
    out = []
    for block in body.replace("\r\n", "\n").split("\n\n"):
        data = [line[5:].strip() for line in block.splitlines() if line.startswith("data:")]
        if data:
            out.append(json.loads("".join(data)))
    return out


def test_prod_turn_endpoint(client: TestClient) -> None:
    r = client.post(
        "/v1/turns",
        json={
            "thread_id": "th",
            "turn_id": "t",
            "pet_ref": "pet_demo_rex",
            "user_message": "Rex dort beaucoup depuis quelques jours",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["schema_version"] == "1"
    assert body["metadata"]["path"][-1] == "finalize"


def test_graph_endpoint_is_derived_from_the_compiled_graph(client: TestClient) -> None:
    topo = client.get("/graph").json()
    ids = {n["id"] for n in topo["nodes"]}
    assert {"circuit_breaker", "guardrail", "safe_fallback", "finalize", "core_api"} <= ids
    assert not any(i.startswith("__error_handler__") for i in ids)
    kinds = {(e["source"], e["target"]): e["kind"] for e in topo["edges"]}
    assert kinds[("guardrail", "generation")] == "conditional"
    assert kinds[("generation", "safe_fallback")] == "error"


def test_every_conditional_edge_and_node_is_described() -> None:
    topo = build_topology(build_graph())
    for e in topo.edges:
        if e.kind in ("conditional", "error"):
            assert e.label, f"arête sans libellé : {e.source} → {e.target}"
    assert {n.id for n in topo.nodes} <= set(NODE_META)
    assert set(ON_ERROR) <= {n.id for n in topo.nodes}


def test_debug_run_streams_node_events_in_order(client: TestClient) -> None:
    with client.stream(
        "POST",
        "/debug/runs",
        json={
            "user_message": "Il boite de la patte arrière depuis hier, c'est grave ?",
            "faults": ["draft_diagnostic", "draft_ungrounded"],
        },
    ) as r:
        events = _events(r.read().decode())
    types = [e["type"] for e in events]
    assert types[0] == "run_started" and types[-1] == "run_finished"
    finished = [
        (e["node"], e["attempt"], e["status"]) for e in events if e["type"] == "node_finished"
    ]
    assert ("generation", 2, "ok") in finished
    assert ("guardrail", 2, "rejected") in finished
    assert finished[-1][0] == "finalize"
    starts = [e for e in events if e["type"] == "node_started"]
    assert len(starts) == len(finished)
    assert all(e["duration_ms"] >= 0 for e in events if e["type"] == "node_finished")


def test_debug_run_reports_recovered_errors(client: TestClient) -> None:
    with client.stream(
        "POST", "/debug/runs", json={"user_message": "Rex dort beaucoup", "faults": ["llm_down"]}
    ) as r:
        events = _events(r.read().decode())
    gen = next(e for e in events if e["type"] == "node_finished" and e["node"] == "generation")
    assert gen["status"] == "error" and gen["recovered_to"] == "safe_fallback"
    assert events[-1]["response"]["metadata"]["template_id"] == "SR-FALLBACK-02"


def _run(client: TestClient, path: str, body: dict[str, Any]) -> list[dict[str, Any]]:
    with client.stream("POST", path, json=body) as r:
        assert r.status_code == 200, r.read()
        return _events(r.read().decode())


def test_fork_reruns_from_a_node_with_other_faults(client: TestClient) -> None:
    original = _run(
        client,
        "/debug/runs",
        {
            "user_message": "Il boite de la patte arrière depuis hier, c'est grave ?",
            "faults": ["draft_diagnostic", "draft_ungrounded"],
        },
    )
    run_id = original[0]["run_id"]
    assert original[-1]["response"]["metadata"]["template_id"] == "SR-FALLBACK-02"

    fork = _run(client, f"/debug/runs/{run_id}/fork", {"node": "generation", "faults": []})
    started = fork[0]
    assert started["fork_of"] == run_id
    assert [s["node"] for s in started["reused"]] == [
        "circuit_breaker",
        "query_understanding",
        "retrieval",
        "relevance_filter",
    ]
    rerun = [e["node"] for e in fork if e["type"] == "node_finished"]
    assert rerun == ["generation", "guardrail", "finalize"]
    assert fork[-1]["response"]["metadata"]["template_id"] is None

    # On peut forker le fork : repartir du 2ᵉ passage n'a pas de sens ici, il n'y en a qu'un.
    second = client.post(
        f"/debug/runs/{started['run_id']}/fork", json={"node": "guardrail", "attempt": 2}
    )
    assert second.status_code == 422


def test_fork_can_force_a_node_output(client: TestClient) -> None:
    original = _run(client, "/debug/runs", {"user_message": "Rex dort beaucoup"})
    fork = _run(
        client,
        f"/debug/runs/{original[0]['run_id']}/fork",
        {"node": "circuit_breaker", "overrides": {"intent": "diagnosis_request"}},
    )
    assert fork[0]["reused"][-1]["summary"] == "Sortie forcée depuis la console"
    assert fork[-1]["response"]["metadata"]["template_id"] == "SR-DIAG-01"
    assert [e["node"] for e in fork if e["type"] == "node_finished"] == [
        "safe_response_escalate",
        "finalize",
    ]


def test_fork_validates_its_input(client: TestClient) -> None:
    original = _run(client, "/debug/runs", {"user_message": "Rex dort beaucoup"})
    rid = original[0]["run_id"]
    assert client.post("/debug/runs/inconnu/fork", json={"node": "generation"}).status_code == 404
    bad = client.post(
        f"/debug/runs/{rid}/fork", json={"node": "generation", "overrides": {"draft": "x"}}
    )
    assert bad.status_code == 422
    wrong = client.post(
        f"/debug/runs/{rid}/fork",
        json={"node": "circuit_breaker", "overrides": {"intent": "nimporte"}},
    )
    assert wrong.status_code == 422


def test_debug_rejects_unknown_fault(client: TestClient) -> None:
    r = client.post("/debug/runs", json={"user_message": "x", "faults": ["meteor"]})
    assert r.status_code == 422


def test_debug_endpoints_can_be_disabled(deps: Deps, tmp_path: Any) -> None:
    c = TestClient(create_app(Settings(debug_api=False, audit_path=tmp_path / "a"), deps=deps))
    assert c.post("/debug/runs", json={"user_message": "x"}).status_code == 404
    assert c.get("/debug/scenarios").status_code == 404
    assert c.get("/health").json() == {"status": "ok"}


def test_scenarios_endpoint(client: TestClient) -> None:
    ids = [s["id"] for s in client.get("/debug/scenarios").json()]
    assert ids == ["A", "S", "B", "U", "C", "D", "F"]
    assert "llm_down" in client.get("/debug/faults").json()


async def test_http_core_api_against_fake_service() -> None:
    api = HttpCoreApi("http://core", transport=httpx.ASGITransport(app=fake_core_app))
    assert (await api.get_pet_profile("pet_demo_rex")).name == "Rex"
    assert (await api.get_recent_telemetry("pet_demo_nala", 7)).activity_delta_pct < -28
    assert len(await api.get_recent_alerts("pet_demo_nala", 7)) == 2
    with pytest.raises(UnknownPet):
        await api.get_pet_profile("pet_unknown")
    await api.aclose()
