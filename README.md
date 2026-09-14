# Pawrise Assistant

Assistant conversationnel de Pawrise Care — la **moitié réactive** du Care Engine.

Pipeline LangGraph borné à 6 nœuds, RAG sur corpus vétérinaire, garde-fous anti-diagnostic en
3 couches. Il contextualise l'état d'un chien à partir des données du collier, répond aux questions
du propriétaire, et produit le dossier de pré-consultation quand une escalade vers un vétérinaire
est pertinente.

> **L'assistant n'établit jamais de diagnostic médical.** Code rural, article L243-1. Ce n'est pas
> une consigne de prompt : c'est une propriété du graphe (voir `docs/conception.md` §3).

## Ce que ce repo ne fait pas

| Hors périmètre | Où ça vit |
|---|---|
| Baseline, détection d'anomalies, règles vétérinaires (FR13–15) | La moitié **proactive** du Care Engine — Epic 5 |
| Threads, messages, WebSocket, handoff, routage vétérinaire | `pawrise-dialog` (Rust) |
| Profil animal, télémétrie, alertes | Core API (Rust) — consommés par tool calls |
| Rendu du PDF | File & Export — ce repo produit la synthèse JSON |

L'assistant est **sans état** : il reçoit un tour de conversation, il répond, il ne mémorise rien.

## Démarrage

```bash
uv sync                  # installe tout, Python 3.13
uv run pytest            # tests
uv run ruff check .      # lint
uv run mypy src          # types
uv run dev               # API + harnais de développement
```

## Documentation

| Document | Contenu |
|---|---|
| `docs/conception.md` | **Le document de référence** — périmètre, flux, graphe, contrats, stack, plan par lots |
| `pawrise-chatbot-architecture/architecture-chatbot.md` | Spec amont, les 10 ADR |

Les amendements apportés à la spec amont sont listés en `docs/conception.md` §9.

## État

Lot 0 — scaffolding. Voir le plan d'implémentation en `docs/conception.md` §10.
