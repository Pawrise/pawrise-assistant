"""Ingestion du corpus vétérinaire et retrieval hybride (ADR-008, conception §5).

BM25 (Postgres FTS) et dense (pgvector) fusionnés par Reciprocal Rank Fusion, puis reranking.
"""
