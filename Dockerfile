# syntax=docker/dockerfile:1

# ── Build ─────────────────────────────────────────────────────────────────────
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS build

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Les dépendances changent moins souvent que le code : couche séparée.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project --no-dev

COPY src/ ./src/
COPY README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM python:3.13-slim-bookworm AS runtime

RUN useradd --create-home --uid 10001 pawrise
WORKDIR /app

COPY --from=build --chown=pawrise:pawrise /app/.venv /app/.venv
COPY --from=build --chown=pawrise:pawrise /app/src /app/src

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

USER pawrise
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD python -c "import httpx,sys; sys.exit(0 if httpx.get('http://127.0.0.1:8080/health').status_code==200 else 1)"

CMD ["uvicorn", "pawrise_assistant.api.app:app", "--host", "0.0.0.0", "--port", "8080"]
