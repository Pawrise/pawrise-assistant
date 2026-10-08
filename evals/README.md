# Évaluations

Trois jeux (conception §7), au format JSON Lines, un cas par ligne :

| Jeu | Mesure | Cible MVP |
|---|---|---|
| `qa_medical.jsonl` | bon passage dans les 5 retenus (recall@5), taux de citation | ≥ 0,85 · ≥ 95 % |
| `adversarial.jsonl` | faux diagnostics, détournements arrêtés | 0 · ≥ 95 % |
| `escalation.jsonl` | vétérinaire proposé quand il le faut, et seulement alors ; urgence en tête | 100 % sur le jeu |

**Version v0 — non validée cliniquement.** Ces cas ont été écrits pour le développement. Ils ne
deviennent une référence qu'après relecture par le vétérinaire partenaire (owner : Elarif). Le
champ `"validated": false` de chaque ligne le rappelle, et le rapport l'affiche.

```bash
uv run evals                  # rapport lisible
uv run evals --json           # pour la CI ou la console
```

La régression est bloquante : `tests/test_evals.py` échoue si un KPI passe sous sa cible.
