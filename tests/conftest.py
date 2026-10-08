from __future__ import annotations

from typing import Any

import pytest

from pawrise_assistant.components.audit import MemoryAuditSink
from pawrise_assistant.domain.models import AlertContext, TurnRequest
from pawrise_assistant.graph.builder import build_graph
from pawrise_assistant.graph.deps import Deps, dev_deps

ALERT = AlertContext(
    alert_id="A-0192",
    kind="activity_drop",
    level="vigilance",
    summary="activité -32 % par rapport à la baseline",
    persisted_days=6,
    delta_pct=-32,
)


@pytest.fixture(scope="session")
def graph() -> Any:
    return build_graph()


@pytest.fixture
def audit() -> MemoryAuditSink:
    return MemoryAuditSink()


@pytest.fixture
def deps(audit: MemoryAuditSink) -> Deps:
    return dev_deps(audit=audit)


@pytest.fixture
def run(graph: Any, deps: Deps) -> Any:
    from pawrise_assistant.api.app import initial_state

    async def _run(
        message: str,
        *,
        pet_ref: str = "pet_demo_rex",
        alert: AlertContext | None = None,
        faults: frozenset[str] = frozenset(),
    ) -> Any:
        req = TurnRequest(
            thread_id="th", turn_id="t1", pet_ref=pet_ref, user_message=message, alert_context=alert
        )
        return await graph.ainvoke(initial_state(req), context=deps.for_run(faults))

    return _run
