# Pawrise Assistant

Assistant conversationnel de Pawrise Care — la **moitié réactive** du Care Engine.

Pipeline LangGraph borné, RAG sur corpus vétérinaire, garde-fous anti-diagnostic en 3 couches. Il
contextualise l'état d'un chien à partir des données du collier, répond aux questions du
propriétaire, et signale quand un vétérinaire doit prendre le relais.

> **L'assistant n'établit jamais de diagnostic médical.** Code rural, article L243-1. Ce n'est pas
> une consigne de prompt : c'est une propriété du graphe (voir `docs/conception.md` §3).

## Démarrer

```bash
uv sync                                  # Python 3.13, toutes les dépendances
uv run dev                               # API sur http://127.0.0.1:8100
npm --prefix console install
npm --prefix console run dev             # console sur http://127.0.0.1:5173
```

Aucune clé ni service externe n'est nécessaire : en mode dev, le Core API est simulé (deux chiens,
30 jours de données) et les nœuds tournent avec des composants déterministes.

## Côté propriétaire : le flux SSE

`POST /v1/turns/stream` envoie des phrases d'attente (`status`), puis la réponse vérifiée
(`response`). Aucun texte ne part avant la vérification.

```bash
curl -N http://127.0.0.1:8100/v1/turns/stream -H 'content-type: application/json' \
  -d '{"thread_id":"t","turn_id":"1","pet_ref":"pet_demo_rex","user_message":"Rex dort beaucoup, normal ?"}'
```

## La console

Trois vues, sur téléphone, tablette et ordinateur :

- **Discuter** : l'assistant tel que le propriétaire le voit, avec les phrases d'attente en direct.
- **Parcours** : le chemin de chaque réponse, étape par étape. Chaque étape dit qui la fait (IA,
  règle, recherche, texte fixe) ; on rejoue le tour et on relance depuis n'importe quelle étape.
- **Tester** : les scénarios et leur résultat attendu, « Tout lancer », et des pannes à simuler
  (IA, recherche, Core API…) pour vérifier que l'assistant reste prudent.

## Configuration

Tout se règle par variables d'environnement `PAWRISE_*`. Chaque brique a une version de dev, sans
réseau ni secret (le défaut), et une version cible :

| Brique | Défaut (dev) | Cible |
|---|---|---|
| LLM (nœuds 1, 2, 5, 6) | règles et gabarits | `PAWRISE_LLM=openai` ; Azure EU via `PAWRISE_LLM_BASE_URL` |
| Recherche | BM25 + trigrammes en mémoire | `PAWRISE_RETRIEVER=postgres` + `PAWRISE_DATABASE_URL` |
| Embeddings | hachage | `PAWRISE_EMBEDDER=openai` |
| Rerank | recouvrement lexical | `PAWRISE_RERANKER=cohere` + `PAWRISE_COHERE_TOKEN` |
| Core API | simulé en process | `PAWRISE_CORE_API_URL` |
| Traces | désactivées | `PAWRISE_OTEL=true` + variables OTLP standard |

Le secret OpenAI se pose dans la variable d'environnement standard du SDK ; il n'est jamais lu
ni écrit par le code. Même avec un LLM, les règles des nœuds 1 et 6 restent actives.

```bash
docker compose up -d db                  # Postgres + pgvector sur 127.0.0.1:5433
PAWRISE_RETRIEVER=postgres PAWRISE_DATABASE_URL=postgresql://pawrise@127.0.0.1:5433/pawrise \
  uv run ingest                          # indexe le corpus (plein texte + vecteurs)
uv run evals                             # les KPI du MVP sur les jeux d'évaluation
```

## API

| Route | Rôle |
|---|---|
| `POST /v1/turns` | L'API de prod, appelée par `pawrise-dialog` : un tour entre, une réponse JSON sort (ADR-005) |
| `POST /v1/handoff-summaries` | Le dossier pré-consultation (JSON sourcé, non diagnostique), appelé par `dialog` au handoff |
| `GET /graph?name=turn\|handoff` | Topologie du graphe compilé, pour la console |
| `POST /debug/runs` | Le même tour en flux SSE, nœud par nœud |
| `POST /debug/runs/{id}/fork` | Rejouer un tour depuis un nœud (réexécuté, ou sortie forcée) |
| `POST /debug/handoff-runs` | Le dossier en flux SSE |
| `GET /debug/scenarios`, `GET /debug/faults` | Scénarios de démo et pannes injectables |

Les routes `/debug/*` sont désactivées par `PAWRISE_DEBUG_API=false` (la valeur à mettre en prod).

## Qualité

```bash
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest --cov
npm --prefix console run lint && npm --prefix console test && npm --prefix console run build
```

## Ce que ce repo ne fait pas

| Hors périmètre | Où ça vit |
|---|---|
| Baseline, détection d'anomalies, règles vétérinaires (FR13–15) | La moitié **proactive** du Care Engine — Epic 5 |
| Threads, messages, WebSocket, handoff, routage vétérinaire | `pawrise-dialog` (Rust) |
| Profil animal, télémétrie, alertes | Core API (Rust) — consommés par tool calls |
| Rendu du PDF | File & Export — ce repo produit la synthèse JSON |

L'assistant est **sans état** : il reçoit un tour de conversation, il répond, il ne mémorise rien.

## Documentation

`docs/conception.md` est le document de référence : périmètre, flux, graphe, contrats, stack, plan
par lots.
