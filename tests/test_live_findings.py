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


async def test_restating_the_owner_message_is_a_valid_source() -> None:
    """3ᵉ passage réel : « le propriétaire indique qu'il a avalé un raisin » était rejeté."""
    text = "Vous indiquez qu'il a avalé un raisin."
    ctx = GuardrailContext(user_message="Il a avalé un raisin", chunks=[], pet=None, alert=None)
    draft = DraftAnswer(response_text=text, claims=[Claim(text=text, source_ids=["message"])])
    assert (await RuleGuardrail().check(draft, ctx)).passed


async def test_an_urgent_signal_wins_even_off_topic() -> None:
    """3ᵉ passage réel : « chewing-gum au xylitol » classé hors sujet, sans vétérinaire."""
    from pawrise_assistant.api.app import initial_state
    from pawrise_assistant.components.audit import MemoryAuditSink
    from pawrise_assistant.domain.models import TurnRequest
    from pawrise_assistant.graph.builder import build_graph
    from pawrise_assistant.graph.deps import llm_deps
    from pawrise_assistant.llm.components import IntentOut

    p = ScriptedProvider(
        {"IntentOut": [IntentOut(intent="out_of_scope", confidence=0.8, reason="chewing-gum")]}
    )
    deps = llm_deps(p, audit=MemoryAuditSink())
    req = TurnRequest(
        thread_id="t",
        turn_id="1",
        pet_ref="pet_demo_rex",
        user_message="Il a mangé un chewing-gum au xylitol",
    )
    out = await build_graph().ainvoke(initial_state(req), context=deps.for_run())
    r = out["response"]
    assert r.metadata.template_id == "SR-URG-01"
    assert r.escalation.urgency == "high"
    assert r.response_text.startswith("Contactez un vétérinaire dès maintenant")


def test_an_active_collar_alert_is_enough_to_escalate() -> None:
    """3ᵉ passage réel : « elle bouge moins en ce moment » chez Nala, sans escalade."""
    from pawrise_assistant.components.guardrail import escalation_rules
    from pawrise_assistant.core_api import fake_data
    from pawrise_assistant.domain.models import PetContext

    nala = PetContext(
        telemetry=fake_data.summarize("pet_demo_nala", 2),
        alerts=fake_data.alerts("pet_demo_nala", 7),
    )
    ctx = GuardrailContext(
        user_message="Elle bouge moins en ce moment", chunks=[], pet=nala, alert=None
    )
    esc = escalation_rules(ctx)
    assert esc.urgency == "medium"
    assert esc.reason and "A-0192" in esc.reason


@pytest.mark.parametrize(
    ("message", "urgent"),
    [
        ("Il a mangé du chocolat mais il a l'air bien", True),
        ("Il a mangé un chewing-gum au xylitol", True),
        ("Il a léché de l'antigel", True),
        ("Il respire mal depuis une heure", True),
        ("Donne-moi une recette de gâteau au chocolat.", False),
        ("Le chocolat est-il toxique ?", False),
    ],
)
def test_a_toxic_word_is_urgent_only_when_ingested(message: str, urgent: bool) -> None:
    from pawrise_assistant.components.guardrail import escalation_rules

    ctx = GuardrailContext(user_message=message, chunks=[], pet=None, alert=None)
    assert (escalation_rules(ctx).urgency == "high") is urgent


@pytest.mark.parametrize(
    ("claim", "grounded"),
    [
        ("Vous dites que Rex dort beaucoup depuis quelques jours.", True),
        ("Vous indiquez qu'il dort beaucoup.", True),
        ("Rex dort beaucoup parce qu'il est malade.", False),
        ("Vous dites qu'il a probablement une infection.", False),
    ],
)
async def test_restating_the_owner_needs_no_cited_source(claim: str, grounded: bool) -> None:
    """Console, 2026-10-08 : la reprise du message, rédigée sans source, menait au repli (esc-009)."""
    from pawrise_assistant.llm.components import GuardrailOut, LLMGuardrail

    msg = "Rex dort beaucoup depuis quelques jours, c'est normal ?"
    ctx = GuardrailContext(user_message=msg, chunks=[], pet=None, alert=None)
    draft = DraftAnswer(response_text=claim, claims=[Claim(text=claim)])
    assert (await RuleGuardrail().check(draft, ctx)).passed is grounded
    # Le LLM ne peut pas annuler une reprise fidèle du message.
    p = ScriptedProvider({"GuardrailOut": [GuardrailOut(checks=[])]})
    assert (await LLMGuardrail(p).check(draft, ctx)).passed is grounded


@pytest.mark.parametrize(
    ("message", "courtesy"),
    [
        ("Merci, c'est rassurant !", True),
        ("Bonjour", True),
        ("Ok merci beaucoup", True),
        ("Merci, mais il vomit depuis ce matin et il ne mange plus rien du tout", False),
        ("Merci, il dort combien d'heures normalement ?", False),
    ],
)
async def test_courtesy_never_reaches_the_llm_classifier(message: str, courtesy: bool) -> None:
    """Console, 2026-10-09 : « Merci, c'est rassurant ! » classé hors sujet par le LLM."""
    from pawrise_assistant.llm.components import IntentOut, LLMIntentClassifier

    wrong = IntentOut(intent="out_of_scope", confidence=0.7, reason="pas une question santé")
    result = await LLMIntentClassifier(ScriptedProvider({"IntentOut": [wrong]})).classify(message)
    assert (result.intent == "clean") is courtesy
