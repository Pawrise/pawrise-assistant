"""Interfaces des dépendances externes, pour qu'aucune ne soit câblée en dur.

`LLMProvider` (ADR-002) permet la bascule OpenAI / Azure OpenAI EU / Mistral sans toucher
au pipeline. `RelevanceFilter` (ADR-003) et `VectorStore` (conception §5.2) jouent le même
rôle pour le reranking et le stockage vectoriel.
"""
