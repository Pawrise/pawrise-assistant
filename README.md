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

## La console

Le graphe complet, en direct : chaque nœud s'allume quand il travaille, l'arête empruntée se trace,
les nœuds jamais appelés passent en pointillés. Une chronologie permet de rejouer le tour pas à pas,
et l'inspecteur montre ce que chaque nœud a lu, écrit et décidé (intention, outils appelés,
passages retenus, vérification claim par claim).

Sept scénarios prêts à lancer, et des pannes à injecter (LLM, reranker, Core API…) pour vérifier
que le graphe échoue fermé aux deux bouts et ouvert au milieu.

## API

| Route | Rôle |
|---|---|
| `POST /v1/turns` | L'API de prod, appelée par `pawrise-dialog` : un tour entre, une réponse JSON sort (ADR-005) |
| `GET /graph` | Topologie du graphe compilé, pour la console |
| `POST /debug/runs` | Le même tour en flux SSE, nœud par nœud. Désactivé si `PAWRISE_DEBUG_API=false` |
| `GET /debug/scenarios`, `GET /debug/faults` | Scénarios de démo et pannes injectables |

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
