#!/usr/bin/env bash
# Lance l'assistant comme en prod, en local : LLM OpenAI (nano + mini), Postgres + pgvector,
# embeddings OpenAI. La clé OpenAI est lue par le SDK dans l'environnement : elle n'est écrite
# ni ici ni dans le dépôt.
#
#   OPENAI_…=<clé> scripts/prod-local.sh      puis la console : npm --prefix console run dev
set -euo pipefail
cd "$(dirname "$0")/.."

export PAWRISE_LLM=openai
export PAWRISE_RETRIEVER=postgres
export PAWRISE_EMBEDDER=openai
export PAWRISE_DATABASE_URL=postgresql://pawrise@127.0.0.1:5433/pawrise

docker compose up -d --wait db
uv run ingest
exec uv run dev
