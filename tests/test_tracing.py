"""Lot 7 : spans OpenTelemetry — hiérarchie, attributs GenAI, aucun contenu de message."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from pawrise_assistant.api.app import create_app
from pawrise_assistant.api.settings import Settings
from pawrise_assistant.graph.deps import Deps
from pawrise_assistant.llm.components import IntentOut
from pawrise_assistant.llm.provider import OpenAIProvider

_EXPORTER = InMemorySpanExporter()
_PROVIDER = TracerProvider()
_PROVIDER.add_span_processor(SimpleSpanProcessor(_EXPORTER))
trace.set_tracer_provider(_PROVIDER)

MESSAGE = "Rex dort beaucoup depuis quelques jours, c'est normal ?"


@pytest.fixture(autouse=True)
def _clear() -> None:
    _EXPORTER.clear()


def test_turn_span_continues_dialog_trace_and_wraps_every_node(deps: Deps, tmp_path: Any) -> None:
    client = TestClient(create_app(Settings(audit_path=tmp_path / "a"), deps=deps))
    parent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
    r = client.post(
        "/v1/turns",
        headers={"traceparent": parent},
        json={
            "thread_id": "th",
            "turn_id": "t",
            "pet_ref": "pet_demo_rex",
            "user_message": MESSAGE,
        },
    )
    assert r.status_code == 200

    spans = {s.name: s for s in _EXPORTER.get_finished_spans()}
    root = spans["invoke_workflow turn"]
    assert format(root.context.trace_id, "032x") == "0af7651916cd43dd8448eb211c80319c"
    assert root.attributes["gen_ai.operation.name"] == "invoke_workflow"
    assert {"node circuit_breaker", "node guardrail", "node finalize"} <= set(spans)
    assert all(s.context.trace_id == root.context.trace_id for s in spans.values())

    dumped = json.dumps([dict(s.attributes or {}) for s in spans.values()], default=str)
    assert "dort beaucoup" not in dumped, "jamais de contenu de message dans les spans"


async def test_llm_call_span_carries_genai_usage() -> None:
    class Responses:
        async def parse(self, **kwargs: Any) -> Any:
            return SimpleNamespace(
                output_parsed=IntentOut(intent="clean", confidence=1, reason="r"),
                usage=SimpleNamespace(input_tokens=42, output_tokens=7),
            )

    p = OpenAIProvider(
        SimpleNamespace(responses=Responses()), {"nano": "gpt-5.4-nano", "main": "x"}
    )
    await p.parse(tier="nano", system="s", user="contenu sensible", schema=IntentOut)
    (span,) = _EXPORTER.get_finished_spans()
    assert span.name == "chat gpt-5.4-nano"
    assert span.attributes["gen_ai.usage.input_tokens"] == 42
    assert "contenu sensible" not in json.dumps(dict(span.attributes or {}))
