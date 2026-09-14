"""Journal d'audit append-only (ADR-010).

Écrit par le nœud terminal du graphe, qui est le point de sortie unique : rien ne quitte le
service sans être tracé. JSONL en développement, object storage avec Object Lock en production.
Rétention 5 ans.
"""
