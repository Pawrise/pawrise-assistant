# Pawrise Assistant — Conception technique

> **Statut : validé sur les arbitrages structurants (2026-09-14).** Reste à confirmer : rien de
> bloquant. Le scaffolding peut démarrer.
>
> **Amont :** `pawrise-chatbot-architecture/architecture-chatbot.md` (10 ADR) reste la spec de
> référence. Ce document ne la remplace pas — il la rend exécutable, et relève les points qu'elle
> laisse ouverts ou que l'implémentation contredit (§9).

---

## 1. Périmètre

### 1.1 Ce que porte ce repo

La **cognition** de l'assistant : la moitié réactive du Care Engine.

| Exigence | Objet |
|---|---|
| FR16 | Chat IA (LLM + RAG) sur les données de l'animal + corpus vétérinaire |
| FR17 | Signalement d'escalade, jamais de diagnostic |
| FR18 / FR35 | Synthèse structurée du dossier pré-consultation (JSON) |

Epic 6 (6.1 → 6.4), contribution à Epic 10 (10.1, 10.2).
User stories de la spec : **O1, O2, O3, O6, S1–S4**, et **O5/V1 en partie** (la synthèse, pas
l'orchestration du handoff — §1.3).

### 1.2 Ce qu'il ne porte pas

**La moitié proactive du Care Engine** — FR13 (prétraitement), FR14 (baseline + détection
d'anomalies), FR15 (règles vétérinaires / expert system). C'est Epic 5 : du traitement du signal et
de l'expert system, pas du LLM, et ça consomme Kafka en continu.

> L'assistant **consomme** les alertes. Il ne les produit pas.

C'est la raison du nom : `care-engine` désigne les deux moitiés, `pawrise-assistant` désigne
celle-ci. La seconde prendra son propre nom (`pawrise-detection` ou équivalent).

**Également hors repo :** Core API (Rust), Vet Portal, app mobile, le **rendu** du PDF — acté : ce
repo produit la synthèse JSON, le rendu revient au service File & Export — et, décision
structurante, **tout l'aspect conversationnel** (§1.3).

### 1.3 La frontière conversationnelle — le service `dialog`

**Décision (2026-09-14) : la conversation appartient à un service Rust `pawrise-dialog`, pas à ce
repo.** L'assistant est une capacité de cognition, sans état, que `dialog` appelle.

| `pawrise-dialog` (Rust) | `pawrise-assistant` (ce repo, Python) |
|---|---|
| Threads, messages, participants | Le graphe LangGraph |
| WebSocket vers l'app, relais du flux SSE | Retrieval, reranking, génération |
| Machine à états du handoff | Garde-fous |
| File d'attente et routage vétérinaire (FR34, FR40) | Synthèse du dossier, sur appel |
| Quotas fair-use (FR42) | Audit de la cognition |
| RBAC owner ↔ vétérinaire (FR37) | |

**Pourquoi c'est le bon découpage — trois raisons, dans l'ordre d'importance.**

1. **FR37 n'avait pas de maison.** « Communication sécurisée in-app par chat entre propriétaire et
   vétérinaire », exigence MVP. C'est un chat humain ↔ humain : WebSocket, présence, persistance,
   RBAC. Aucun LLM. Aucun service de l'inventaire actuel ne le porte. `dialog` n'est donc pas un
   service *supplémentaire* — c'est un service **déjà manquant**.

2. **ADR-004 était incohérent.** Il exige « source de vérité unique, pas de duplication », mais
   l'historique de conversation se retrouvait à la fois dans le checkpointer LangGraph et derrière un
   `get_chat_history`. Si `dialog` possède la conversation, l'assistant devient **sans état** : il
   reçoit un tour, il répond, il ne mémorise rien. Le checkpointer sort du périmètre, et on passe de
   quatre tool calls à trois (§4.1).

3. **L'IA ne déclenche rien.** L'assistant pose `escalation.trigger=true` dans sa sortie — c'est
   tout. `dialog` décide : vérifie le quota, cherche un vétérinaire disponible, fait entrer un humain
   dans le thread. **L'IA recommande, un service déterministe décide et route.** Un agent LLM qui
   contacterait un vétérinaire de sa propre initiative serait exactement ce qu'ADR-001 interdit.

**Quand le vétérinaire prend la main**, `dialog` bascule l'état du thread et l'assistant en sort. Il
ne s'incruste pas dans un échange entre un propriétaire et un professionnel.

**Coût assumé :** un service Rust de plus à écrire et à opérer. Et cette décision **modifie
l'inventaire de services** de `architecture.md` — elle doit passer en revue d'équipe, pas être actée
dans un document chatbot (§9.8).

### 1.4 Frontière contractuelle

Le repo ne possède **aucune donnée métier** et **aucun état de conversation**.

```
   ENTRÉE (depuis dialog)        pawrise-assistant           SORTIE (vers dialog)
   ─────────────────────         ─────────────────           ────────────────────
   tour de conversation    →                           →   réponse JSON (ADR-005)
   historique du thread    →    graphe LangGraph       →   flux de progression (SSE)
   contexte d'alerte       →    (sans état)            →   événement d'audit (ADR-010)
                                       ↕
                               3 tool calls (ADR-004)
                                vers le Core API
```

---

## 2. Les flux

Six flux. Chacun a une raison d'exister — un flux qui ne se justifie pas est un flux qu'on ne code
pas.

### Flux A — Question libre (O2)

**Pourquoi :** le cas nominal, la promesse produit de base.

`dialog` transmet un tour de conversation. Parcours complet des 6 nœuds. Sortie : réponse
+ citations + éventuel signal d'escalade.

**Variante A′ — small-talk.** Si le nœud 2 établit qu'aucun claim médical n'est en jeu (« bonjour »,
« merci », « tu peux répéter »), le graphe **saute le RAG et le reranking** et va directement à la
génération. Ce n'est pas une optimisation gratuite : c'est ce qui rend crédible le chiffrage
coût/conversation du dossier (« le small-talk coûte ~5× moins »).

### Flux B — Alerte → chat (O3)

**Pourquoi :** *le* flux différenciant. Sans lui, Pawrise est un Tractive avec un chatbot posé
dessus.

Déclenché par une alerte de la moitié proactive. Push notification → `dialog` ouvre un thread avec un
contexte **pré-injecté** : profil de l'animal, télémétrie 24 h, détail de l'alerte. L'owner arrive
dans une conversation qui a déjà du contexte.

Différence technique avec le flux A : l'état d'entrée porte un `alert_context`, et les tools
télémétrie sont appelés **avant** le premier message, pas à la demande du nœud 2.

### Flux C — Demande de diagnostic ou de prescription (O6)

**Pourquoi :** la ligne rouge juridique (Code rural L243-1). Le refus doit être une propriété du
graphe, pas une consigne dans un prompt.

Le nœud 1 classe l'intention comme `diagnosis_request`. Le graphe **court-circuite** : ni RAG, ni
LLM principal. Sortie = Safe Response cadrée + `escalation.trigger=true` + log d'audit.

Le point important : **le LLM principal ne voit jamais la question.** On ne lui demande pas de
résister à la tentation, on ne la lui présente pas.

### Flux D — Abus, jailbreak, hors-scope

**Pourquoi :** protection du système et du budget. Un jailbreak réussi sur un produit santé, c'est
une capture d'écran qui circule.

Même court-circuit que le flux C, mais **sans escalade** — proposer un vétérinaire à quelqu'un qui
teste les limites du prompt n'a pas de sens, et consommerait le quota fair-use. Safe Response + log.

### Flux E — Synthèse de dossier pré-consultation (O5, V1)

**Pourquoi :** c'est la sortie de valeur — ce qui transforme une conversation en acte.

**Ce repo ne porte que la synthèse.** `dialog` orchestre le handoff (quota, file d'attente, routage,
entrée du vétérinaire dans le thread) et **appelle** l'assistant pour produire le dossier :

```
dialog  ──generate_handoff_summary(pet_ref, window, thread_extracts)──→  assistant
        ←──────────────  dossier structuré (JSON)  ──────────────────
```

**Graphe distinct du pipeline principal.** Quatre raisons :

1. **Pas de question utilisateur en entrée** — l'entrée est un `pet_ref` + une fenêtre temporelle.
2. **Sortie de nature différente** — un dossier (chronologie, symptômes, motif, urgence), pas un tour
   de conversation.
3. **Budget de latence différent** — 30 s sont acceptables pour un dossier, pas pour un chat.
4. **Garde-fous différents.** Le destinataire est un vétérinaire, mais le document reste
   non-diagnostique (FR26). Les règles de vérification diffèrent de celles qui s'appliquent face à un
   propriétaire.

Les fusionner forcerait des branches mortes partout dans le state.

### Flux F — Dégradé (S4)

**Pourquoi :** un chat santé qui renvoie une stack trace est pire qu'un chat santé indisponible.

LLM injoignable, tool en timeout, guardrail en échec après retry. Sortie = message canné explicite
(« je ne peux pas répondre pour le moment ») + `escalation.trigger=true` + ticket. Jamais d'erreur
brute côté propriétaire.

> **L'historique de conversation (O9) n'est plus un flux de ce repo.** Il appartient à `dialog`
> (§1.3). L'assistant reçoit l'historique dont il a besoin dans sa requête.

---

## 3. Le graphe

### 3.1 State schema

Ce qui circule entre les nœuds. La pièce la plus structurante : tout le reste s'y accroche.

```python
class AssistantState(TypedDict):
    # — Identité —
    thread_id: str          # appartient à dialog, on ne fait que le porter
    pet_ref: str            # pseudonyme, JAMAIS le pet_id réel (ADR-006)
    turn_id: str

    # — Entrée (fournie par dialog) —
    user_message: str
    history: list[Turn]                                  # pas de mémoire locale
    alert_context: NotRequired[AlertContext | None]      # flux B

    # — Nœud 1 : Circuit Breaker —
    intent: NotRequired[Intent]                          # clean | diagnosis_request
                                                         # | abuse | jailbreak | out_of_scope
    intent_confidence: NotRequired[float]

    # — Nœud 2 : Query Understanding —
    canonical_query: NotRequired[str]
    needs_retrieval: NotRequired[bool]                   # False → variante small-talk
    pet_context: NotRequired[PetContext]                 # résultat des tool calls

    # — Nœud 3 : Retrieval —
    candidates: NotRequired[list[Chunk]]                 # top 20

    # — Nœud 4 : Relevance Filter —
    context_chunks: NotRequired[list[Chunk]]             # top 5

    # — Nœud 5 : Génération —
    draft: NotRequired[DraftAnswer]

    # — Nœud 6 : Guardrail —
    verdict: NotRequired[GuardrailVerdict]
    retry_count: int

    # — Sortie —
    response: NotRequired[AssistantResponse]             # ADR-005

    # — Transverse —
    trace: Annotated[list[NodeTrace], add]               # audit + UI dev
```

Trois choix à noter :

- **`pet_ref` et non `pet_id`.** La pseudonymisation est portée par le type, pas par la discipline du
  développeur. Le `pet_id` réel n'entre jamais dans le state (ADR-006).
- **`history` en entrée, pas en mémoire.** Conséquence directe de §1.3 : pas de checkpointer, pas de
  duplication de la conversation.
- **`trace` en champ accumulé.** Alimente à la fois l'audit append-only (ADR-010) et l'UI dev. Une
  seule source, deux consommateurs — pas d'instrumentation en double.

### 3.2 Les six nœuds

| # | Nœud | Entrée | Sortie | Modèle | En cas d'échec |
|---|---|---|---|---|---|
| 1 | **Circuit Breaker** | `user_message` | `intent`, `intent_confidence` | nano | *fail-closed* → Safe Response |
| 2 | **Query Understanding** | `user_message`, `alert_context`, `history` | `canonical_query`, `needs_retrieval`, `pet_context` | nano + tools | *fail-open* → query brute, contexte vide |
| 3 | **Retrieval** | `canonical_query` | `candidates` (20) | — | liste vide → génération sans source, le guardrail bloquera tout claim |
| 4 | **Relevance Filter** | `candidates` | `context_chunks` (5) | reranker | repli sur le top-5 du RRF |
| 5 | **Génération** | tout le contexte | `draft` | principal | → flux F |
| 6 | **Guardrail** | `draft`, `context_chunks` | `verdict` | nano | *fail-closed* → fallback canné |

**La règle qui gouverne la colonne « échec » :** les nœuds 1 et 6 échouent *fermé* (en cas de doute,
on bloque), les nœuds 2, 3 et 4 échouent *ouvert* (en cas de doute, on dégrade la qualité mais on
continue). C'est la traduction de la défense en profondeur d'ADR-007 : **dégrader la pertinence est
acceptable, dégrader la sécurité ne l'est pas.**

LangGraph porte ça nativement — `RetryPolicy` et `error_handler` se déclarent par nœud.

### 3.3 Edges

```
START → circuit_breaker

circuit_breaker ─ clean ─────────────→ query_understanding
                ─ diagnosis_request ─→ safe_response_escalate
                ─ abuse|jailbreak|
                  out_of_scope ──────→ safe_response

query_understanding ─ needs_retrieval ────→ retrieval
                    ─ small-talk ─────────→ generation

retrieval → relevance_filter → generation → guardrail

guardrail ─ pass ──────────────────────→ finalize
          ─ fail & retry_count == 0 ───→ generation   (system prompt durci)
          ─ fail & retry_count >= 1 ───→ safe_fallback

safe_response ─────────┐
safe_response_escalate ─┼→ finalize → END
safe_fallback ─────────┘
```

**Un seul point de sortie.** Toutes les branches convergent sur `finalize`, Safe Responses comprises.
C'est `finalize` qui écrit l'audit et émet la réponse — donc **rien ne peut sortir du système sans
être tracé**. ADR-010 devient structurel au lieu d'être une bonne intention.

**Le retry est borné à 1.** Au-delà, on tombe en canné. Un guardrail qui échoue deux fois signale un
problème de fond, pas un aléa de génération.

### 3.4 Streaming et pipeline visible

Arbitrage acté : **on ne streame jamais un texte non validé.**

```
t=0      t≈300ms    t≈900ms   t≈1.5s     t≈5s      t≈5.2s
│        │          │         │          │         │
│  nœud 1 ✓   nœud 2 ✓   nœuds 3-4 ✓  nœud 5 ✓  nœud 6 ✓ → le texte validé se déroule
└─────────── pipeline visible (stream_mode="custom") ───────┘   (stream d'affichage)
```

Mécanisme : `get_stream_writer()` dans chaque nœud émet un événement de progression ;
`graph.stream(stream_mode=["updates", "custom"])` les expose. L'assistant sert ce flux à `dialog`,
qui le relaie à l'app. Le texte final n'est diffusé qu'après le verdict du nœud 6.

> **Amendement requis à la spec (§8).** Le NFR « first token p95 < 2 s » n'a plus de sens : aucun
> token ne part avant validation. Il devient **« premier retour visible p95 < 2 s »**, satisfait par
> l'allumage du nœud 1 (~300 ms). Le NFR « réponse complète p95 < 8 s » est inchangé.

---

## 4. Contrats externes

### 4.1 Les trois tools (ADR-004)

Le Core API n'existe pas. On développe donc contre un **contrat**, pas contre un service — et ce
contrat est le livrable qui pilotera le développement Rust.

```
get_pet_profile(pet_ref)                  → race, âge, poids, pathologies déclarées, baseline
get_recent_telemetry(pet_ref, period)     → agrégats activité / sommeil / constantes
get_recent_alerts(pet_ref, period)        → alertes émises par la moitié proactive
```

`get_chat_history` a disparu : `dialog` est l'appelant et possède déjà l'historique, il le passe dans
la requête. Un aller-retour réseau de moins sur le chemin chaud.

Schémas Pydantic + export OpenAPI. Contrainte ADR-004 : **p95 < 200 ms**, repli gracieux si échec.

### 4.2 Le faux Core API

Un service FastAPI qui sert les trois tools sur des données simulées : un chien de référence avec
30 jours d'historique, une baseline établie, et deux anomalies scénarisées (baisse d'activité
progressive, pic de fréquence cardiaque nocturne).

Ce n'est pas un bouchon jetable. C'est ce qui permet de démontrer le produit en soutenance **sans
dépendre du hardware**, et ce qui rend les tests d'éval reproductibles.

### 4.3 Sortie (ADR-005)

Le JSON de la spec, tel quel : `response_text`, `citations[]`, `escalation{trigger, urgency,
reason}`, `suggested_actions[]`, `metadata{}`. Modèle Pydantic, versionné.

`escalation.trigger` est un **signal**, pas un ordre : `dialog` en fait ce qu'il veut (§1.3).

### 4.4 Audit (ADR-010)

Écrit par `finalize`, en append-only. Contenu : message d'entrée, chaîne de prompts, tool calls et
résultats, chunks retenus, verdict du guardrail, sortie. Rétention 5 ans.

En dev : fichiers JSONL. En production : object storage S3-compatible avec Object Lock. L'interface
est la même, l'implémentation est injectée.

Périmètre : **l'audit de la cognition**. L'audit de la conversation (qui a dit quoi, quand, à qui)
appartient à `dialog`.

---

## 5. RAG

### 5.1 Corpus

Le corpus curé (200–500 docs, owner Elarif + Nino + vétérinaire partenaire) est un chantier long. Il
ne doit pas bloquer le développement.

**Corpus d'amorce : 20 à 40 documents de sources ouvertes** (ANSES, ESCCAP, fiches publiques sur les
pathologies canines courantes). Objectif unique : rendre le retrieval mesurable. Le corpus réel se
branchera dessus sans changer une ligne de pipeline.

### 5.2 Store — décision

**pgvector sur PostgreSQL, avec l'index BM25 en Postgres FTS.** Ce qui tranche la question ouverte
n°4 de la spec.

Raison : le retrieval hybride d'ADR-008 exige de fusionner deux classements (RRF). Les avoir dans le
**même moteur** rend la fusion triviale et transactionnelle. Choisir Qdrant imposerait un second
datastore à opérer pour une équipe qui monte déjà Kubernetes, Kafka et un OIDC maison — et
l'architecture globale a déjà acté « une seule famille PostgreSQL ».

Qdrant reste derrière l'interface `VectorStore`, activable si le volume l'exige.

### 5.3 Pipeline

Ingestion → chunking (sémantique, avec chevauchement) → embeddings → double index (dense + FTS).
Recherche : BM25 top-20 ∥ dense top-20 → fusion RRF → top-20 → reranker → top-5.

### 5.4 Reranking

**Cohere Rerank 3.5 multilingue**, derrière une interface `RelevanceFilter`.

> **Amendement à la spec.** ADR-003 est écrit comme « décision provisoire, à benchmarker ». La
> décision est en réalité prise (le site l'expose déjà : ~100 ms contre 1,5–3 s pour un filtre LLM).
> L'ADR passe en « acté », le benchmark est rétrogradé au rang de vérification.

---

## 6. Stack

| Couche | Choix | Pourquoi |
|---|---|---|
| Langage | Python 3.13 | Contrainte LangGraph, écosystème ML |
| Packaging | `uv` | Résolution rapide, lockfile reproductible, un seul outil |
| Orchestration | LangGraph 1.x | ADR-001 ; `RetryPolicy`/`error_handler` par nœud, streaming par canaux |
| Service | FastAPI + uvicorn | SSE natif pour le pipeline visible |
| Schémas | Pydantic v2 | State, tools, sortie, validation en frontière |
| Données | PostgreSQL + pgvector + FTS | §5.2 |
| Reranker | Cohere Rerank 3.5 multilingue | ADR-003 |
| LLM | Interface `LLMProvider` — OpenAI en dev, Azure OpenAI EU en cible | ADR-002 |
| Observabilité | OpenTelemetry + **Langfuse self-hosté** | **pas LangSmith** — hébergement US, contradiction frontale avec la thèse data residency |
| Tests | pytest + pytest-asyncio | — |
| Qualité | ruff, mypy strict | — |
| CI | GitHub Actions | Couverture ≥ 80 % global, **≥ 90 % sur les nœuds 1 et 6** — aligné sur l'engagement de soutenance |

**Les versions exactes et les identifiants de modèles sont pinnés au scaffolding, pas ici.** Le
chiffrage du site date du 2 juillet ; tarifs et disponibilité des modèles seront revérifiés au moment
de configurer.

---

## 7. Éval

Sans golden set, les KPIs MVP (recall@5 ≥ 0,85, zéro faux diagnostic) sont invérifiables — et le
risque R9 (régression après changement de prompt) est ingérable.

| Jeu | Volume cible | Mesure |
|---|---|---|
| `qa_medical` | ~100 | NDCG@5, recall@5, taux de citation |
| `adversarial` | ~60 | 0 faux diagnostic, détection jailbreak ≥ 95 % |
| `escalation` | ~40 | taux d'escalade approprié (5–15 %) |

**Régression bloquante en CI** sur toute PR touchant les prompts ou le pipeline.

Une **v0** de ces trois jeux sera produite à partir du corpus. Elle est utilisable pour le
développement, mais **non validée cliniquement** tant que le vétérinaire partenaire ne l'a pas
relue — et cette mention doit figurer dans le jeu de données lui-même, pas seulement ici. Un golden
set auto-généré présenté comme validé serait exactement le type d'affirmation non étayée qu'on
cherche à éviter.

**Owner de la revue clinique : Elarif** (contact vétérinaire), avec Nino en appui. À planifier dès
que le corpus d'amorce est en place (fin du lot 4).

---

## 8. UI de développement

**Un harnais d'observation, pas une maquette produit.** Il parle directement à l'assistant, sans
passer par `dialog`.

Ce qu'il doit montrer :

- les 6 nœuds qui s'allument en direct, avec leur latence ;
- l'intention classée par le nœud 1 et sa confiance ;
- les 20 chunks récupérés avec leurs scores BM25 / dense / RRF ;
- l'avant/après reranking ;
- le verdict du guardrail, claim par claim, avec la source qui l'ancre ;
- le JSON final brut ;
- le coût du tour, décomposé par nœud.

**Technique : FastAPI + SSE + une page sans build.** Pas de Next.js ici — ajouter une toolchain Node
à un repo Python pour un outil interne est un coût permanent pour un gain nul. Un seul `uv run`
démarre tout.

`langgraph dev` fournit LangGraph Studio gratuitement pour le débogage du graphe ; les deux sont
complémentaires. Mais c'est le harnais qui rend ADR-007 **démontrable** — et un garde-fou qu'on peut
montrer vaut mieux qu'un garde-fou qu'on affirme.

**Livré en deux temps** (§10) : version minimale au lot 2, inspecteur complet au lot 6.

---

## 9. Amendements à la spec

À répercuter dans `architecture-chatbot.md` et `architecture.md` une fois ce document validé.
L'écart doc/réel est précisément ce qui a été reproché à l'équipe en évaluation.

| # | Point | Amendement |
|---|---|---|
| 9.1 | NFR first-token (§8) | « first token < 2 s » → « premier retour visible < 2 s » (§3.4) |
| 9.2 | ADR-003 | Provisoire → acté (Cohere Rerank 3.5) |
| 9.3 | Question ouverte n°4 | Tranchée : pgvector + Postgres FTS, Qdrant derrière l'interface |
| 9.4 | Frontière PDF | **Acté** : ce repo produit la synthèse JSON, le rendu PDF revient à File & Export |
| 9.5 | Nommage | Care Engine = deux moitiés. Ce repo = la moitié conversationnelle |
| 9.6 | Monorepo | L'architecture prescrit un monorepo polyglotte. Repo séparé acté — à amender explicitement |
| 9.7 | Observabilité | Proscrire LangSmith (hébergement US). Langfuse self-hosté ou OTel pur |
| 9.8 | **Inventaire de services** | **Ajout de `pawrise-dialog` (Rust)** — porte FR34, FR37, FR40, FR42 et la machine à états du handoff. ADR-004 amendé : l'historique de conversation appartient à `dialog`, l'assistant est sans état. **À valider en revue d'équipe** |

**Restent ouvertes** (arbitrage produit, hors périmètre de ce document) : quotas chatbot par tier
tarifaire, audit trail visible par le propriétaire ou non, cadence d'éval vétérinaire, nombre de
vétérinaires partenaires au MVP.

---

## 10. Plan d'implémentation

Principe de séquencement : **chaque lot se termine par quelque chose de montrable.**

| Lot | Contenu | Fin de lot = |
|---|---|---|
| **0** | Repo, `uv`, ruff/mypy/pytest, Docker, CI | CI verte |
| **1** | Schémas Pydantic (state, tools, sortie), faux Core API, données simulées | on interroge le chien simulé |
| **2** | `LLMProvider` + cascade, graphe câblé bout en bout avec nœuds bouchons, **harnais SSE minimal** | un tour traverse les 6 nœuds, on le voit |
| **3** | **Nœuds 1 et 6 réels** + jeu adversarial | « demande-lui de te diagnostiquer » → la cage tient |
| **4** | Corpus d'amorce, ingestion, pgvector + FTS, RRF, reranker → nœuds 3 et 4 | réponse sourcée |
| **5** | Nœuds 2 et 5 complets, tools télémétrie | flux A et B complets |
| **6** | Inspecteur complet (chunks, scores, verdict claim par claim, coût) | tout est inspectable |
| **7** | Audit append-only, OTel, Langfuse | audit + traces |
| **8** | Graphe de synthèse de dossier (flux E) | dossier de handoff généré |
| **9** | Éval complète, régression CI, **smoke test Azure OpenAI EU** | KPIs mesurés, data residency vérifiée |

**Deux choix d'ordre à justifier.**

**Les garde-fous (lot 3) passent avant le RAG (lot 4).** Ils portent la valeur juridique et la
différenciation produit, ils sont testables sans corpus, et c'est ce qui se démontre le mieux devant
un jury.

**Le harnais est coupé en deux.** Le `stream_mode` est déjà câblé au lot 2 : exposer un flux SSE brut
à ce moment-là coûte presque rien, et évite de déboguer les lots 3 à 5 à l'aveugle. L'inspecteur
riche attend que les nœuds soient réels — le construire plus tôt, ce serait le reconstruire.

---

## 11. Dépendances hors de ce repo

| Dépendance | Owner | Bloque |
|---|---|---|
| `pawrise-dialog` (service Rust) | à désigner | l'intégration réelle, pas le développement |
| Corpus vétérinaire curé | Elarif + Nino + vétérinaire | la qualité du RAG, pas le pipeline |
| Revue clinique du golden set | Elarif | la validité des KPIs |
| Azure OpenAI EU | Oumar | le lot 9 uniquement |
| Core API (contrats) | Yassine | rien — le faux Core API couvre le développement |

Aucune de ces dépendances ne bloque le démarrage. C'est le point du faux Core API et du corpus
d'amorce.
