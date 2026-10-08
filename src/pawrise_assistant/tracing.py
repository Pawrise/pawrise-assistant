"""OpenTelemetry (lot 7) : un span par tour, par nœud, par appel LLM.

Conventions GenAI (statut « development » en 2026 : version figée ici, à relire à chaque montée) :
`invoke_workflow` pour le tour, `chat` pour un appel de modèle, `gen_ai.usage.*` pour les tokens.

**Aucun contenu de message dans les spans** : ce sont des données de santé. Le contenu complet vit
dans l'audit (ADR-010), pas dans l'observabilité.

Export : OTLP/HTTP, configuré par les variables OpenTelemetry standard (endpoint, en-têtes). Pour
Langfuse auto-hébergé, l'endpoint est `<langfuse>/api/public/otel` avec une authentification Basic.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator, Mapping
from typing import Any

from opentelemetry import propagate, trace
from opentelemetry.trace import Span, Status, StatusCode

SEMCONV_VERSION = "1.42.0"
tracer = trace.get_tracer(
    "pawrise_assistant", schema_url=f"https://opentelemetry.io/schemas/{SEMCONV_VERSION}"
)


def setup(service_name: str = "pawrise-assistant") -> None:
    """Active l'export OTLP. Sans appel à `setup`, les spans ne coûtent rien et ne partent nulle part."""
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)


@contextlib.contextmanager
def turn_span(kind: str, headers: Mapping[str, str] | None = None, **attrs: Any) -> Iterator[Span]:
    """Span racine d'un tour, rattaché à la trace de dialog via son en-tête `traceparent`."""
    ctx = propagate.extract(dict(headers or {}))
    with tracer.start_as_current_span(
        f"invoke_workflow {kind}",
        context=ctx,
        kind=trace.SpanKind.SERVER,
        attributes={
            "gen_ai.operation.name": "invoke_workflow",
            "gen_ai.workflow.name": kind,
            **attrs,
        },
    ) as span:
        yield span


@contextlib.contextmanager
def node_span(node: str) -> Iterator[Span]:
    with tracer.start_as_current_span(f"node {node}", attributes={"pawrise.node": node}) as span:
        try:
            yield span
        except Exception as e:
            span.set_status(Status(StatusCode.ERROR, type(e).__name__))
            raise


@contextlib.contextmanager
def llm_span(model: str, provider: str = "openai") -> Iterator[Span]:
    with tracer.start_as_current_span(
        f"chat {model}",
        kind=trace.SpanKind.CLIENT,
        attributes={
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": provider,
            "gen_ai.request.model": model,
        },
    ) as span:
        yield span
