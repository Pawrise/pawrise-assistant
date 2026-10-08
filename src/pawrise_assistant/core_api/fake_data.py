"""Données simulées du faux Core API (conception §4.2).

Deux chiens de référence, 30 jours d'historique chacun, générés de façon déterministe :
- `pet_demo_rex`  : variation modérée (sommeil en hausse, activité en légère baisse) ;
- `pet_demo_nala` : deux anomalies scénarisées (baisse d'activité progressive sur 7 jours,
  pic de fréquence cardiaque nocturne il y a 3 jours).

Le but : démontrer le produit sans hardware et rendre les évals reproductibles.
"""

from __future__ import annotations

from dataclasses import dataclass

from pawrise_assistant.domain.models import Alert, PetProfile, TelemetrySummary

HISTORY_DAYS = 30


@dataclass(frozen=True)
class Day:
    activity_min: float
    sleep_h: float
    resting_hr: int
    night_hr_peak: int


def _rex_day(i: int) -> Day:
    """i = 0 pour aujourd'hui, 29 pour il y a 29 jours."""
    wobble = (i * 7 % 5) - 2  # bruit déterministe, ±2
    recent = i < 7
    return Day(
        activity_min=(84.0 if recent else 95.0) + wobble,
        sleep_h=(14.2 if recent else 12.0) + wobble / 10,
        resting_hr=78 + wobble,
        night_hr_peak=96 + wobble,
    )


def _nala_day(i: int) -> Day:
    wobble = (i * 3 % 5) - 2
    activity = 102.0 + wobble
    if i < 7:  # baisse progressive : -12 % il y a 6 jours → -50 % aujourd'hui
        activity *= 1 - (0.12 + (6 - i) * 0.063)
    return Day(
        activity_min=activity,
        sleep_h=12.5 + wobble / 10 + (0.9 if i < 7 else 0.0),
        resting_hr=82 + wobble,
        night_hr_peak=(148 if i == 3 else 101 + wobble),
    )


PROFILES: dict[str, PetProfile] = {
    "pet_demo_rex": PetProfile(
        pet_ref="pet_demo_rex",
        name="Rex",
        species="dog",
        breed="golden retriever",
        age_years=5,
        weight_kg=31,
    ),
    "pet_demo_nala": PetProfile(
        pet_ref="pet_demo_nala",
        name="Nala",
        species="dog",
        breed="berger australien",
        age_years=8,
        weight_kg=22,
        declared_conditions=["arthrose légère (déclarée)"],
    ),
}

SERIES: dict[str, list[Day]] = {
    "pet_demo_rex": [_rex_day(i) for i in range(HISTORY_DAYS)],
    "pet_demo_nala": [_nala_day(i) for i in range(HISTORY_DAYS)],
}

ALERTS: dict[str, list[Alert]] = {
    "pet_demo_rex": [],
    "pet_demo_nala": [
        Alert(
            alert_id="A-0192",
            kind="activity_drop",
            level="vigilance",
            days_ago=0,
            summary="activité -32 % par rapport à la baseline, en baisse depuis 6 jours",
        ),
        Alert(
            alert_id="A-0187",
            kind="night_heart_rate",
            level="info",
            days_ago=3,
            summary="pic de fréquence cardiaque nocturne (148 bpm)",
        ),
    ],
}


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def summarize(pet_ref: str, period_days: int) -> TelemetrySummary:
    series = SERIES[pet_ref]
    period_days = max(1, min(period_days, 7))
    recent, baseline = series[:period_days], series[7:]
    act = _mean([d.activity_min for d in recent]) / _mean([d.activity_min for d in baseline]) - 1
    slp = _mean([d.sleep_h for d in recent]) / _mean([d.sleep_h for d in baseline]) - 1
    return TelemetrySummary(
        pet_ref=pet_ref,
        period_days=period_days,
        activity_delta_pct=round(act * 100, 1),
        sleep_delta_pct=round(slp * 100, 1),
        resting_hr_bpm=round(_mean([d.resting_hr for d in recent])),
        night_hr_peak_bpm=max(d.night_hr_peak for d in recent),
        baseline_ready=len(baseline) >= 7,
    )


def alerts(pet_ref: str, period_days: int) -> list[Alert]:
    return [a for a in ALERTS[pet_ref] if a.days_ago < period_days]
