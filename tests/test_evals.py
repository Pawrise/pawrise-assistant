"""Régression bloquante (conception §7, risque R9) : un KPI sous sa cible fait échouer la CI."""

from __future__ import annotations

from pawrise_assistant.evals import _format, evaluate


async def test_kpis_meet_their_targets() -> None:
    report = await evaluate()
    assert report.passed, "\n" + _format(report)
    assert report.cases >= 45


async def test_report_says_the_dataset_is_not_clinically_validated() -> None:
    report = await evaluate()
    assert not report.validated
    assert "NON validé cliniquement" in _format(report)
