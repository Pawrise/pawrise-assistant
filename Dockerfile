FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS build
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN uv sync --locked --no-dev --no-editable

FROM python:3.13-slim-bookworm
WORKDIR /app
RUN useradd --create-home --uid 10001 app && mkdir -p /app/var && chown app /app/var
COPY --from=build /app/.venv /app/.venv
COPY corpus ./corpus
ENV PATH="/app/.venv/bin:$PATH" \
    PAWRISE_DEBUG_API=false \
    PAWRISE_AUDIT_PATH=/app/var/audit.jsonl \
    PAWRISE_CORPUS_DIR=/app/corpus/seed
USER app
EXPOSE 8100
CMD ["uvicorn", "pawrise_assistant.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8100"]
