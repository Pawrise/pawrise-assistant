"""Fixtures partagées."""

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from pawrise_assistant.api.app import create_app


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """Client HTTP branché sur l'application, sans socket réseau."""
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
