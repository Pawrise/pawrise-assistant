"""Les six nœuds du pipeline (conception §3.2).

Circuit Breaker · Query Understanding · Retrieval · Relevance Filter · Génération · Guardrail.

Règle d'échec : les nœuds 1 et 6 échouent fermé, les nœuds 2 à 4 échouent ouvert.
Dégrader la pertinence est acceptable, dégrader la sécurité ne l'est pas.
"""
