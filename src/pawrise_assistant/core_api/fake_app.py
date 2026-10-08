"""Le faux Core API, en service HTTP autonome : `uv run fake-core-api` (port 8101).

Même contrat que le futur service Rust. Utile pour tester `HttpCoreApi` et pour simuler la latence.
"""

from __future__ import annotations

import uvicorn
from fastapi import FastAPI, HTTPException, Query

from pawrise_assistant.core_api.client import InMemoryCoreApi, UnknownPet
from pawrise_assistant.domain.models import Alert, PetProfile, TelemetrySummary

app = FastAPI(title="Pawrise Core API (simulé)")
_api = InMemoryCoreApi()


@app.get("/pets/{pet_ref}/profile")
async def profile(pet_ref: str) -> PetProfile:
    try:
        return await _api.get_pet_profile(pet_ref)
    except UnknownPet as e:
        raise HTTPException(404, "unknown pet") from e


@app.get("/pets/{pet_ref}/telemetry")
async def telemetry(pet_ref: str, period_days: int = Query(7, ge=1, le=30)) -> TelemetrySummary:
    try:
        return await _api.get_recent_telemetry(pet_ref, period_days)
    except UnknownPet as e:
        raise HTTPException(404, "unknown pet") from e


@app.get("/pets/{pet_ref}/alerts")
async def alerts(pet_ref: str, period_days: int = Query(7, ge=1, le=30)) -> list[Alert]:
    try:
        return await _api.get_recent_alerts(pet_ref, period_days)
    except UnknownPet as e:
        raise HTTPException(404, "unknown pet") from e


def main() -> None:
    uvicorn.run(app, host="127.0.0.1", port=8101)
