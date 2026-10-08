import type { ReactNode } from 'react'
import type { TopologyNode } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { Attempt, NodeSnapshot } from '@/run/model'
import { VIEW, fmtMs } from '@/run/status'

type Data = Record<string, unknown>

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 py-1.5 text-[13px]">
      <dt className="text-zinc-500">{k}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs">{children}</span>
}

function Tick({ ok }: { ok: boolean }) {
  return (
    <span className={cn('font-bold', ok ? 'text-emerald-700' : 'text-red-700')}>
      {ok ? '✓' : '✕'}
    </span>
  )
}

/** Un rendu lisible par type de nœud ; le JSON brut reste accessible en dessous. */
function Details({ node, data }: { node: string; data: Data }) {
  if (data.error) {
    return (
      <dl>
        <Row k="Erreur">
          <Mono>{String(data.error)}</Mono>
        </Row>
        <Row k="Politique">{String(data.policy)}</Row>
        <Row k="Suite">
          <Mono>{String(data.next)}</Mono>
        </Row>
      </dl>
    )
  }
  switch (node) {
    case 'circuit_breaker':
      return (
        <dl>
          <Row k="Intention">
            <Mono>{String(data.intent)}</Mono>
          </Row>
          <Row k="Confiance">{Number(data.confidence).toFixed(2)}</Row>
          {data.matched ? <Row k="Repéré">« {String(data.matched)} »</Row> : null}
          <Row k="PII masquées">
            {Object.keys((data.pii_redacted as Data) ?? {}).length
              ? JSON.stringify(data.pii_redacted)
              : 'aucune'}
          </Row>
        </dl>
      )
    case 'query_understanding': {
      const tools = (data.tools as { tool: string; ok: boolean; ms?: number; error?: string }[]) ?? []
      return (
        <dl>
          <Row k="Reformulé">{String(data.canonical_query)}</Row>
          <Row k="Recherche">{data.needs_retrieval ? 'oui' : 'non, rien à chercher'}</Row>
          <Row k="Outils">
            <ul className="flex flex-col gap-0.5">
              {tools.map((t) => (
                <li key={t.tool} className="flex gap-2">
                  <Tick ok={t.ok} />
                  <Mono>{t.tool}</Mono>
                  <span className="text-zinc-500">{t.ok ? `${t.ms} ms` : t.error}</span>
                </li>
              ))}
            </ul>
          </Row>
          {data.pet_context ? <Row k="Contexte">{String(data.pet_context)}</Row> : null}
        </dl>
      )
    }
    case 'retrieval': {
      const rows = (data.candidates as Data[]) ?? []
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-zinc-500">{String(data.retriever)} · seuls les rangs comptent</p>
          <table className="w-full text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 text-left font-medium">RRF</th>
                <th className="text-left font-medium">passage</th>
                <th className="font-medium">BM25</th>
                <th className="font-medium">sens</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)} className="border-t border-zinc-100">
                  <td className="py-1">#{String(r.rrf_rank)}</td>
                  <td className="max-w-[160px] truncate font-mono">{String(r.id)}</td>
                  <td className="text-center">{r.bm25_rank ? `#${r.bm25_rank}` : '—'}</td>
                  <td className="text-center">{r.dense_rank ? `#${r.dense_rank}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'relevance_filter': {
      const kept = (data.kept as Data[]) ?? []
      return (
        <dl>
          <p className="pb-1 text-xs text-zinc-500">{String(data.reranker)}</p>
          {kept.map((k) => (
            <Row key={String(k.id)} k={`score ${Number(k.rerank).toFixed(2)}`}>
              <Mono>{String(k.id)}</Mono>
            </Row>
          ))}
          <Row k="Écartés">{((data.dropped as string[]) ?? []).length} passages</Row>
        </dl>
      )
    }
    case 'generation': {
      const claims = (data.claims as { text: string; source_ids: string[] }[]) ?? []
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-zinc-500">
            {String(data.generator)} · consigne {String(data.prompt_version)}
            {data.hardened ? ' · durcie' : ''}
          </p>
          {claims.map((c, i) => (
            <div key={i} className="rounded-md border px-2.5 py-1.5 text-[13px]">
              {c.text}
              <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
                {c.source_ids.length ? c.source_ids.join(', ') : 'aucune source'}
              </div>
            </div>
          ))}
          {!claims.length ? <p className="text-[13px]">{String(data.draft)}</p> : null}
        </div>
      )
    }
    case 'guardrail': {
      const checks = (data.checks as {
        text: string
        grounded: boolean
        diagnostic: boolean
        source_ids: string[]
      }[]) ?? []
      const esc = data.escalation as { trigger: boolean; urgency: string; reason: string }
      return (
        <div className="flex flex-col gap-2">
          {checks.map((c, i) => (
            <div
              key={i}
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-[13px]',
                c.diagnostic ? 'border-red-200 bg-red-50' : !c.grounded && 'border-amber-200 bg-amber-50',
              )}
            >
              {c.text}
              <div className="mt-0.5 flex gap-3 text-[11px] text-zinc-600">
                <span>
                  <Tick ok={c.grounded} /> {c.grounded ? c.source_ids.join(', ') : 'sans source'}
                </span>
                {c.diagnostic ? <span className="font-medium text-red-700">langage diagnostique</span> : null}
              </div>
            </div>
          ))}
          <dl>
            <Row k="Vétérinaire">
              {esc?.trigger ? `oui · ${esc.urgency} · ${esc.reason}` : 'non nécessaire'}
            </Row>
          </dl>
        </div>
      )
    }
    default:
      return (
        <dl>
          {Object.entries(data).map(([k, v]) => (
            <Row key={k} k={k}>
              <Mono>{Array.isArray(v) ? v.join(' → ') : String(v)}</Mono>
            </Row>
          ))}
        </dl>
      )
  }
}

export function Inspector({
  meta,
  snap,
  attempts,
}: {
  meta: TopologyNode | undefined
  snap: NodeSnapshot | undefined
  attempts: Attempt[]
}) {
  if (!meta) {
    return <p className="p-5 text-sm text-zinc-500">Cliquez sur un nœud du graphe.</p>
  }
  const v = VIEW[snap?.view ?? 'pending']
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              {meta.step ? `${meta.step} · ` : ''}
              {meta.label}
            </h2>
            <p className="font-mono text-xs text-zinc-500">{meta.id}</p>
          </div>
          <Badge variant="outline" className={cn('border-0', v.badge)}>
            {v.glyph} {v.word}
          </Badge>
        </div>
        <p className="text-sm text-zinc-700">{meta.role}</p>
        {meta.on_error ? (
          <p className="text-xs text-zinc-500">
            En cas de panne : <span className="font-medium text-zinc-700">{meta.on_error}</span>
          </p>
        ) : null}
        {attempts.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-zinc-600">
            {snap?.view === 'skipped'
              ? "Ce nœud n'a pas été appelé : le graphe a pris un autre chemin."
              : 'Pas encore atteint.'}
          </p>
        ) : (
          attempts.map((a) => (
            <section key={a.attempt} className="overflow-hidden rounded-lg border">
              <header className="flex items-center justify-between bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                <span>
                  Passage {a.attempt}
                  {a.status ? ` · ${VIEW[a.status].word}` : ' · en cours'}
                </span>
                <span>{a.durationMs !== null ? fmtMs(a.durationMs) : '…'}</span>
              </header>
              <div className="flex flex-col gap-2 px-3 py-2">
                <p className="text-sm font-medium">{a.summary || '…'}</p>
                {a.status ? <Details node={a.node} data={a.data} /> : null}
                <details className="text-xs">
                  <summary className="cursor-pointer text-zinc-500">Données brutes</summary>
                  <pre className="mt-1 max-h-64 overflow-auto rounded bg-zinc-50 p-2 font-mono text-[11px] whitespace-pre-wrap">
                    {JSON.stringify(a.data, null, 2)}
                  </pre>
                </details>
              </div>
            </section>
          ))
        )}
      </div>
    </ScrollArea>
  )
}
