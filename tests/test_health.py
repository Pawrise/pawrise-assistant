"""L'API répond et expose sa version."""

from httpx import AsyncClient

from pawrise_assistant import __version__


async def test_health_repond_ok(client: AsyncClient) -> None:
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}


async def test_openapi_est_servi(client: AsyncClient) -> None:
    response = await client.get("/openapi.json")

    assert response.status_code == 200
    assert response.json()["info"]["title"] == "Pawrise Assistant"
