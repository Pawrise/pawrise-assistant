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
    return summarize_series(SERIES[pet_ref], period_days, pet_ref)


def summarize_series(
    series: list[Day], period_days: int, pet_ref: str = "pet_demo"
) -> TelemetrySummary:
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


# — Modifications depuis la console (vue Connaissances › Chiens) —
# Les séries et alertes ci-dessus sont la référence ; la console peut les modifier en session pour
# montrer une escalade (R-ESC-03), puis tout remettre d'aplomb avec `reset`.

_ORIGINAL_SERIES = {ref: list(days) for ref, days in SERIES.items()}
_ORIGINAL_ALERTS = {ref: list(items) for ref, items in ALERTS.items()}
RECENT_DAYS = 7


@dataclass(frozen=True)
class Controls:
    activity_drop_pct: float
    sleep_rise_pct: float
    alert: bool


def _measured(pet_ref: str) -> Controls:
    """Les réglages qui décrivent les données d'origine."""
    s = summarize_series(_ORIGINAL_SERIES[pet_ref], RECENT_DAYS)
    return Controls(
        activity_drop_pct=max(0.0, -s.activity_delta_pct),
        sleep_rise_pct=max(0.0, s.sleep_delta_pct),
        alert=any(a.kind == "activity_drop" for a in _ORIGINAL_ALERTS[pet_ref]),
    )


_CONTROLS: dict[str, Controls] = {ref: _measured(ref) for ref in PROFILES}


def controls(pet_ref: str) -> Controls:
    return _CONTROLS[pet_ref]


def modified(pet_ref: str) -> bool:
    return (
        SERIES[pet_ref] != _ORIGINAL_SERIES[pet_ref] or ALERTS[pet_ref] != _ORIGINAL_ALERTS[pet_ref]
    )


def apply(
    pet_ref: str,
    *,
    activity_drop_pct: float | None = None,
    sleep_rise_pct: float | None = None,
    alert: bool | None = None,
) -> None:
    """Réécrit les 7 derniers jours (activité, sommeil) et l'alerte d'activité d'un chien."""
    current = _CONTROLS[pet_ref]
    new = Controls(
        activity_drop_pct=current.activity_drop_pct
        if activity_drop_pct is None
        else activity_drop_pct,
        sleep_rise_pct=current.sleep_rise_pct if sleep_rise_pct is None else sleep_rise_pct,
        alert=current.alert if alert is None else alert,
    )
    if activity_drop_pct is not None or sleep_rise_pct is not None:
        original = _ORIGINAL_SERIES[pet_ref]
        base_act = _mean([d.activity_min for d in original[RECENT_DAYS:]])
        base_sleep = _mean([d.sleep_h for d in original[RECENT_DAYS:]])
        SERIES[pet_ref] = [
            Day(
                activity_min=round(
                    base_act * (1 - new.activity_drop_pct / 100) + ((i * 7 % 5) - 2) * 0.4, 1
                ),
                sleep_h=round(
                    base_sleep * (1 + new.sleep_rise_pct / 100) + ((i * 3 % 5) - 2) / 20, 2
                ),
                resting_hr=d.resting_hr,
                night_hr_peak=d.night_hr_peak,
            )
            if i < RECENT_DAYS
            else d
            for i, d in enumerate(original)
        ]
    others = [a for a in ALERTS[pet_ref] if a.kind != "activity_drop"]
    if new.alert:
        previous = next((a for a in ALERTS[pet_ref] if a.kind == "activity_drop"), None)
        drop = round(new.activity_drop_pct)
        ALERTS[pet_ref] = [
            Alert(
                alert_id=previous.alert_id if previous else f"A-DEMO-{pet_ref.rsplit('_', 1)[-1]}",
                kind="activity_drop",
                level="vigilance",
                days_ago=0,
                summary=f"activité -{drop} % par rapport à la baseline, depuis {RECENT_DAYS} jours",
            ),
            *others,
        ]
    else:
        ALERTS[pet_ref] = others
    _CONTROLS[pet_ref] = new


def reset() -> None:
    for ref in PROFILES:
        SERIES[ref] = list(_ORIGINAL_SERIES[ref])
        ALERTS[ref] = list(_ORIGINAL_ALERTS[ref])
        _CONTROLS[ref] = _measured(ref)
