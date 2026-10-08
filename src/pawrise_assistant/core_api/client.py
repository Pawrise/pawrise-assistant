"""Les trois tools du Core API (ADR-004, conception §4.1).

On développe contre un contrat : le Core API Rust n'existe pas encore. `InMemoryCoreApi` sert les
données simulées en process ; `HttpCoreApi` parle à un vrai service (ou au faux, lancé à part).
"""

from __future__ import annotations

from typing import Protocol

import httpx
from pydantic import TypeAdapter

from pawrise_assistant.core_api import fake_data
from pawrise_assistant.domain.models import Alert, PetProfile, TelemetrySummary


class UnknownPet(LookupError):
    pass


class CoreApi(Protocol):
    async def get_pet_profile(self, pet_ref: str) -> PetProfile: ...

    async def get_recent_telemetry(self, pet_ref: str, period_days: int) -> TelemetrySummary: ...

    async def get_recent_alerts(self, pet_ref: str, period_days: int) -> list[Alert]: ...


class InMemoryCoreApi:
    async def get_pet_profile(self, pet_ref: str) -> PetProfile:
        try:
            return fake_data.PROFILES[pet_ref]
        except KeyError as e:
            raise UnknownPet(pet_ref) from e

    async def get_recent_telemetry(self, pet_ref: str, period_days: int) -> TelemetrySummary:
        if pet_ref not in fake_data.SERIES:
            raise UnknownPet(pet_ref)
        return fake_data.summarize(pet_ref, period_days)

    async def get_recent_alerts(self, pet_ref: str, period_days: int) -> list[Alert]:
        if pet_ref not in fake_data.ALERTS:
            raise UnknownPet(pet_ref)
        return fake_data.alerts(pet_ref, period_days)


_alerts = TypeAdapter(list[Alert])


class HttpCoreApi:
    """Client HTTP. Timeout court : le contrat est p95 < 200 ms, le nœud 2 échoue ouvert."""

    def __init__(
        self,
        base_url: str,
        timeout_s: float = 0.8,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client = httpx.AsyncClient(base_url=base_url, timeout=timeout_s, transport=transport)

    async def _get(self, path: str, **params: int) -> bytes:
        r = await self._client.get(path, params=params)
        if r.status_code == 404:
            raise UnknownPet(path)
        r.raise_for_status()
        return r.content

    async def get_pet_profile(self, pet_ref: str) -> PetProfile:
        return PetProfile.model_validate_json(await self._get(f"/pets/{pet_ref}/profile"))

    async def get_recent_telemetry(self, pet_ref: str, period_days: int) -> TelemetrySummary:
        raw = await self._get(f"/pets/{pet_ref}/telemetry", period_days=period_days)
        return TelemetrySummary.model_validate_json(raw)

    async def get_recent_alerts(self, pet_ref: str, period_days: int) -> list[Alert]:
        raw = await self._get(f"/pets/{pet_ref}/alerts", period_days=period_days)
        return _alerts.validate_json(raw)

    async def aclose(self) -> None:
        await self._client.aclose()
