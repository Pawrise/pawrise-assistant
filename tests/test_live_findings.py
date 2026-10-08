"""Non-régression des défauts constatés lors de la validation avec un vrai LLM (2026-10-08)."""

from __future__ import annotations

import pytest

from pawrise_assistant.components.guardrail import GuardrailContext, RuleGuardrail
from pawrise_assistant.domain.models import Claim, DraftAnswer
from pawrise_assistant.llm.components import (
    LLMGenerator,
    LLMQueryUnderstanding,
    SmallTalkOut,
    UnderstandingOut,
)
from pawrise_assistant.llm.provider import ScriptedProvider


@pytest.mark.parametrize(
    ("text", "passed"),
    [
        ("Comme la baisse dure, il est prudent de demander l'avis d'un vétérinaire.", True),
        ("Contactez votre vétérinaire si cela persiste.", True),
        ("Il a probablement une entorse, consultez un vétérinaire.", False),
        ("Le repos suffit généralement.", False),
    ],
)
async def test_a_vet_referral_needs_no_source_but_a_diagnosis_still_fails(
    text: str, passed: bool
) -> None:
    ctx = GuardrailContext(user_message="x", chunks=[], pet=None, alert=None)
    draft = DraftAnswer(response_text=text, claims=[Claim(text=text)])
    assert (await RuleGuardrail().check(draft, ctx)).passed is passed


async def test_the_llm_alone_cannot_skip_the_search() -> None:
    """« Combien d'heures dort un chien ? » avait été répondu de mémoire, sans source."""
    no = UnderstandingOut(
        canonical_query="sommeil", needs_retrieval=False, telemetry_days=None, alerts_days=None
    )
    understanding = LLMQueryUnderstanding(ScriptedProvider({"UnderstandingOut": [no, no]}))
    factual = await understanding.understand("Combien d'heures dort un chien adulte ?", None)
    courtesy = await understanding.understand("Merci !", None)
    assert factual.needs_retrieval
    assert not courtesy.needs_retrieval


async def test_reasoning_effort_falls_back_minimal_then_low_then_nothing() -> None:
    from types import SimpleNamespace
    from typing import Any

    from pawrise_assistant.llm.components import IntentOut
    from pawrise_assistant.llm.provider import OpenAIProvider

    sent: list[str | None] = []

    class Responses:
        async def parse(self, **kwargs: Any) -> Any:
            effort = kwargs.get("reasoning", {}).get("effort")
            sent.append(effort)
            if effort is not None:
                raise RuntimeError(f"Unsupported value for reasoning.effort: {effort}")
            ok = IntentOut(intent="clean", confidence=1, reason="r")
            return SimpleNamespace(output_parsed=ok, usage=None)

    p = OpenAIProvider(
        SimpleNamespace(responses=Responses()),
        {"nano": "m", "main": "m"},
        {"nano": "minimal", "main": "low"},
    )
    await p.parse(tier="nano", system="s", user="u", schema=IntentOut)
    assert sent == ["minimal", "low", None]
    assert p.reasoning_effort == {"nano": None, "main": "low"}


async def test_small_talk_reply_is_cleaned_of_emoji() -> None:
    p = ScriptedProvider({"SmallTalkOut": [SmallTalkOut(text="Avec plaisir ! 😊")]})
    d = await LLMGenerator(p).generate(
        message="Merci", pet=None, chunks=[], hardened=False, faults=frozenset()
    )
    assert d.response_text == "Avec plaisir !"
