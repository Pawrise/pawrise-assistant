"""Schémas de frontière : entrée de dialog, contexte animal, chunks, sortie (ADR-005).

Aucun identifiant réel n'apparaît ici : l'animal est désigné par un `pet_ref` pseudonyme (ADR-006).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Intent = Literal["clean", "diagnosis_request", "abuse", "jailbreak", "out_of_scope"]
Urgency = Literal["low", "medium", "high"]
NodeStatus = Literal["ok", "redirected", "rejected", "degraded", "error"]
AlertKind = Literal["activity_drop", "night_heart_rate", "geofence_exit", "other"]

TELEMETRY_SOURCE = "telemetry"
"""Identifiant de source réservé : un claim ancré sur les données du collier, pas sur le corpus."""


class Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class Turn(Frozen):
    role: Literal["owner", "assistant"]
    content: str


class AlertContext(Frozen):
    alert_id: str
    kind: AlertKind
    level: Literal["info", "vigilance", "action"]
    summary: str
    persisted_days: int = 0
    delta_pct: float | None = None


class TurnRequest(Frozen):
    """Un tour de conversation, tel que dialog l'envoie. L'historique vient avec : pas de mémoire."""

    thread_id: str
    turn_id: str
    pet_ref: str
    user_message: str = Field(min_length=1, max_length=4000)
    history: list[Turn] = Field(default_factory=list)
    alert_context: AlertContext | None = None


# — Tools Core API (ADR-004) —


class PetProfile(Frozen):
    pet_ref: str
    name: str
    species: Literal["dog"]
    breed: str
    age_years: float
    weight_kg: float
    declared_conditions: list[str] = Field(default_factory=list)


class TelemetrySummary(Frozen):
    pet_ref: str
    period_days: int
    activity_delta_pct: float
    sleep_delta_pct: float
    resting_hr_bpm: int
    night_hr_peak_bpm: int
    baseline_ready: bool


class Alert(Frozen):
    alert_id: str
    kind: AlertKind
    level: Literal["info", "vigilance", "action"]
    days_ago: int
    summary: str


class PetContext(Frozen):
    profile: PetProfile | None = None
    telemetry: TelemetrySummary | None = None
    alerts: list[Alert] = Field(default_factory=list)

    def describe(self) -> str:
        """Résumé fonctionnel minimal : ce que le LLM a le droit de voir (ADR-006)."""
        parts: list[str] = []
        if self.profile:
            p = self.profile
            parts.append(f"{p.name}, {p.breed}, {p.age_years:g} ans, {p.weight_kg:g} kg")
        if self.telemetry:
            t = self.telemetry
            parts.append(
                f"sur {t.period_days} j : activité {t.activity_delta_pct:+.0f} %, "
                f"sommeil {t.sleep_delta_pct:+.0f} %"
            )
        parts.extend(a.summary for a in self.alerts)
        return " · ".join(parts)


# — RAG —


class Chunk(Frozen):
    chunk_id: str
    source: str
    section: str
    text: str
    scores: dict[str, float] = Field(default_factory=dict)

    def with_scores(self, **scores: float) -> Chunk:
        return self.model_copy(update={"scores": {**self.scores, **scores}})


# — Génération et vérification —


class Escalation(Frozen):
    trigger: bool = False
    urgency: Urgency | None = None
    reason: str | None = None


class Claim(Frozen):
    text: str
    source_ids: list[str] = Field(default_factory=list)


class DraftAnswer(Frozen):
    response_text: str
    claims: list[Claim] = Field(default_factory=list)
    escalation: Escalation = Escalation()


class ClaimCheck(Frozen):
    text: str
    grounded: bool
    diagnostic: bool
    source_ids: list[str]


class GuardrailVerdict(Frozen):
    passed: bool
    checks: list[ClaimCheck] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)
    escalation: Escalation = Escalation()


# — Sortie (ADR-005) —


class Citation(Frozen):
    source_id: str
    snippet: str
    url: str | None = None


class SuggestedAction(Frozen):
    label: str
    action_id: Literal["open_vet_handoff"]


class ResponseMetadata(Frozen):
    thread_id: str
    turn_id: str
    path: list[str]
    latency_ms: int
    prompt_version: str
    template_id: str | None = None


class AssistantResponse(Frozen):
    schema_version: Literal["1"] = "1"
    response_text: str
    citations: list[Citation] = Field(default_factory=list)
    escalation: Escalation = Escalation()
    suggested_actions: list[SuggestedAction] = Field(default_factory=list)
    metadata: ResponseMetadata


# — Trace (audit + console, une seule source) —


class NodeTrace(Frozen):
    node: str
    status: NodeStatus
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)
    cost_eur: float = 0.0
