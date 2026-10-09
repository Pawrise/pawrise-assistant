import { Check, Play, X } from 'lucide-react'
import { useState } from 'react'
import type { EvalCase, Kpi } from '@/api/admin'
import { cn } from '@/lib/utils'
import { fmtMs } from '@/run/status'
import type { EvalState } from './useEvals'

const SETS: { id: EvalCase['set']; label: string; hint: string }[] = [
  { id: 'qa_medical', label: 'Questions santé', hint: 'trouver la bonne fiche' },
  { id: 'escalation', label: 'Escalade', hint: 'proposer un vétérinaire au bon moment' },
  { id: 'adversarial', label: 'Pièges', hint: 'diagnostic, médicaments, détournements, insultes' },
]

/** Les noms des KPI, dits simplement. */
const KPI_HELP: Record<string, string> = {
  'faux diagnostics': 'réponses libres qui posent un diagnostic',
  'intention reconnue': 'demandes correctement triées',
  'détournements arrêtés': 'tentatives de changer son rôle',
  'PII absentes de la trace': 'numéros masqués avant l’IA',
  'escalade juste': 'vétérinaire proposé quand il faut, et seulement alors',
  'bon passage dans les 5 (recall@5)': 'la bonne fiche parmi les 5 gardées',
  'réponses sourcées': 'chaque affirmation a sa source',
}

function show(k: Kpi, v: number) {
  return k.higher_is_better ? `${Math.round(v * 100)} %` : String(Math.round(v))
}

function KpiCard({ k }: { k: Kpi }) {
  return (
    <article className={cn('flex flex-col gap-1 rounded-2xl border bg-white p-4 shadow-xs', !k.passed && 'border-red-200')}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{show(k, k.value)}</span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
            k.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800',
          )}
        >
          {k.passed ? <Check className="size-3.5" /> : <X className="size-3.5" />}
          cible {k.higher_is_better ? '≥' : '≤'} {show(k, k.target)}
        </span>
      </div>
      <p className="text-sm font-medium">{k.name}</p>
      <p className="text-xs text-zinc-500">{KPI_HELP[k.name] ?? ''}</p>
      {k.failures.length ? (
        <ul className="mt-1 flex flex-col gap-0.5 text-xs text-red-800">
          {k.failures.slice(0, 4).map((f) => (
            <li key={f}>· {f}</li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}

/** Les raisons d'échec de chaque cas : le serveur écrit « id: raison ». */
export function reasonsByCase(kpis: Kpi[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const f of kpis.flatMap((k) => k.failures)) {
    const at = f.indexOf(':')
    const id = (at < 0 ? f : f.slice(0, at)).trim()
    const why = at < 0 ? '' : f.slice(at + 1).trim()
    out.set(id, [...(out.get(id) ?? []), ...(why ? [why] : [])])
  }
  return out
}

function outcome(c: EvalCase): string {
  if (c.urgency === 'high') return 'urgence'
  if (c.template_id) return `texte fixe ${c.template_id}`
  return c.citations.length ? `rédigée · ${c.citations.length} source(s)` : 'rédigée'
}

export function EvalsTab({ evals, onStart }: { evals: EvalState; onStart: () => void }) {
  const [set, setSet] = useState<EvalCase['set']>('qa_medical')
  const [open, setOpen] = useState<string | null>(null)
  const failing = reasonsByCase(evals.kpis)
  const running = evals.phase === 'running'
  const done = evals.cases.length
  const shown = evals.cases.filter((c) => c.set === set)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-5 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight sm:text-xl">Évaluation sur 48 cas</h2>
          </div>
          <button
            type="button"
            onClick={onStart}
            disabled={running}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            <Play className="size-4" /> {evals.phase === 'idle' ? 'Lancer les 48 cas' : 'Relancer'}
          </button>
        </header>

        {running || evals.phase === 'done' ? (
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200">
              <div
                className={cn('h-full rounded-full transition-all', running ? 'bg-violet-500' : evals.passed ? 'bg-emerald-500' : 'bg-red-500')}
                style={{ width: `${evals.total ? (done / evals.total) * 100 : 0}%` }}
              />
            </div>
            <span className="text-sm text-zinc-600 tabular-nums">
              {done}/{evals.total || 48}
              {evals.phase === 'done' && evals.startedAt && evals.finishedAt
                ? ` · ${fmtMs(evals.finishedAt - evals.startedAt)}`
                : ''}
            </span>
          </div>
        ) : null}
        {evals.error ? <p className="text-sm text-red-700">{evals.error}</p> : null}

        {evals.phase === 'done' ? (
          <section className="flex flex-col gap-3">
            <p className={cn('text-sm font-semibold', evals.passed ? 'text-emerald-700' : 'text-red-700')}>
              {evals.passed ? 'Toutes les cibles sont atteintes.' : 'Au moins une cible n’est pas atteinte.'}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {evals.kpis.map((k) => (
                <KpiCard key={k.name} k={k} />
              ))}
            </div>
          </section>
        ) : evals.phase === 'idle' ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {SETS.map((s) => (
              <div key={s.id} className="rounded-2xl border bg-white p-4 shadow-xs">
                <p className="font-semibold">{s.label}</p>
                <p className="text-sm text-zinc-500">{s.hint}</p>
              </div>
            ))}
          </div>
        ) : null}

        {done ? (
          <section className="flex flex-col gap-3">
            <div role="tablist" className="flex w-fit rounded-xl bg-zinc-100 p-1">
              {SETS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={set === s.id}
                  onClick={() => setSet(s.id)}
                  className={cn('h-8 rounded-lg px-3 text-sm', set === s.id ? 'bg-white font-medium shadow-xs' : 'text-zinc-600')}
                >
                  {s.label} <span className="text-zinc-400">{evals.cases.filter((c) => c.set === s.id).length}</span>
                </button>
              ))}
            </div>
            <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
              {shown.map((c) => {
                const bad = failing.has(c.id)
                const why = failing.get(c.id) ?? []
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(open === c.id ? null : c.id)}
                      className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50', bad && 'bg-red-50/60')}
                    >
                      <span
                        className={cn(
                          'grid size-5 shrink-0 place-items-center rounded-full',
                          bad ? 'bg-red-100 text-red-700' : evals.phase === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500',
                        )}
                      >
                        {bad ? <X className="size-3" /> : <Check className="size-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{c.message}</span>
                        <span className="text-xs text-zinc-500">
                          {c.id} · {outcome(c)}
                          {c.escalate ? ' · vétérinaire' : ''}
                        </span>
                        {why.map((w) => (
                          <span key={w} className="mt-0.5 block text-xs text-red-800">
                            {w}
                          </span>
                        ))}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-400 tabular-nums">{fmtMs(c.latency_ms)}</span>
                    </button>
                    {open === c.id ? (
                      <p className="border-t bg-zinc-50 px-4 py-3 text-[13px] leading-relaxed text-zinc-700">{c.response_text}</p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  )
}
