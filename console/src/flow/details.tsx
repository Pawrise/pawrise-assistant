// Ce que chaque étape a lu, écrit et décidé, rendu lisiblement. Le JSON brut reste accessible.

import type { ReactNode } from 'react'
import { fmtEur } from '@/app/labels'
import { cn } from '@/lib/utils'

type Data = Record<string, unknown>

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-3 py-1.5 text-[13px]">
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

/** Les clés techniques des étapes simples, dites en clair. */
const LABELS: Record<string, string> = {
  template_id: 'Texte envoyé',
  path: 'Chemin',
  next: 'Suite',
  pii_redacted: 'Masqué',
}

/** Un rendu lisible par type de nœud ; le JSON brut reste accessible en dessous. */
export function Details({ node, data }: { node: string; data: Data }) {
  if (data.forced) {
    return (
      <dl>
        {Object.entries(data.forced as Data).map(([k, v]) => (
          <Row key={k} k={`${k} forcé`}>
            <Mono>{JSON.stringify(v)}</Mono>
          </Row>
        ))}
      </dl>
    )
  }
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
    case 'collect': {
      const tools = (data.tools as { tool: string; ok: boolean; error?: string }[]) ?? []
      return (
        <ul className="flex flex-col gap-0.5 text-[13px]">
          {tools.map((t) => (
            <li key={t.tool} className="flex gap-2">
              <Tick ok={t.ok} />
              <Mono>{t.tool}</Mono>
              {t.error ? <span className="text-zinc-500">{t.error}</span> : null}
            </li>
          ))}
        </ul>
      )
    }
    case 'timeline': {
      const events = (data.events as { days_ago: number; text: string; source: string }[]) ?? []
      return (
        <ol className="flex flex-col gap-1 text-[13px]">
          {events.map((e, i) => (
            <li key={i}>
              <span className="font-medium">{e.days_ago ? `J-${e.days_ago}` : "Aujourd'hui"}</span>{' '}
              {e.text} <Mono>{e.source}</Mono>
            </li>
          ))}
        </ol>
      )
    }
    case 'verify': {
      const problems = (data.problems as string[]) ?? []
      return problems.length ? (
        <ul className="flex flex-col gap-1 text-[13px] text-red-800">
          {problems.map((p) => (
            <li key={p}>✕ {p}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-emerald-800">✓ Tout est sourcé, aucun langage diagnostique.</p>
      )
    }
    default:
      return (
        <dl>
          {Object.entries(data).map(([k, v]) => (
            <Row key={k} k={LABELS[k] ?? k}>
              <Mono>{Array.isArray(v) ? v.join(' → ') : String(v)}</Mono>
            </Row>
          ))}
        </dl>
      )
  }
}

export type LlmUsageData = { models: string[]; tokens_in: number; tokens_out: number; cost_eur: number }

export function LlmUsage({ usage }: { usage: LlmUsageData }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs text-violet-900">
      <span className="font-medium">{usage.models.join(', ')}</span>
      <span>
        {usage.tokens_in} → {usage.tokens_out} tokens
      </span>
      <span>{fmtEur(usage.cost_eur)}</span>
    </p>
  )
}
