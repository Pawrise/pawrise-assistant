import { ChevronRight, RefreshCw, Search, Stethoscope, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { admin, type AuditEntry } from '@/api/admin'
import type { GraphName, Pet, StepModel, Topology } from '@/api/types'
import { FAULTS, fmtEur } from '@/app/labels'
import { useMedia } from '@/app/route'
import type { Entry } from '@/app/store'
import { Sheet } from '@/components/Sheet'
import { FlowPane } from '@/flow/FlowPane'
import { cn } from '@/lib/utils'
import { fmtMs } from '@/run/status'
import {
  OUTCOME,
  dayLabel,
  matches,
  outcomeLabel,
  piiLabel,
  piiSummary,
  story,
  time,
  totals,
  vetReason,
  type Filter,
} from './journal'

const key = (e: AuditEntry) => `${e.thread_id}/${e.turn_id}/${e.ts ?? ''}`

function Tag({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', className)}>{children}</span>
}

/** La question telle qu'enregistrée : les données masquées deviennent une pastille. */
function Question({ text }: { text: string }) {
  const parts = text.split(/(\[(?:email|iban|nir|phone|postcode)\])/)
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\[(\w+)\]$/.exec(p)
        return m ? (
          <span key={i} className="mx-0.5 rounded bg-sky-100 px-1.5 py-px text-[0.85em] font-medium text-sky-800">
            {piiLabel(m[1])} masqué
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      })}
    </>
  )
}

function Tags({ e }: { e: AuditEntry }) {
  const pii = piiSummary(e.pii)
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Tag className={OUTCOME[e.outcome].tag}>{outcomeLabel(e)}</Tag>
      {e.rejections.length ? (
        <Tag className="bg-violet-50 text-violet-800">
          {e.rejections.length} bloqué{e.rejections.length > 1 ? 's' : ''}
        </Tag>
      ) : null}
      {e.escalation.trigger ? <Tag className="bg-zinc-900 text-white">Vétérinaire</Tag> : null}
      {pii ? <Tag className="bg-sky-50 text-sky-800">{pii}</Tag> : null}
      {e.faults.length ? <Tag className="bg-red-50 text-red-800">Panne simulée</Tag> : null}
    </span>
  )
}

/** La fiche d'une réponse : ce qui s'est passé, ce qui a été bloqué, ce qui est parti, et pourquoi. */
function Fiche({ e, petName, onFlow }: { e: AuditEntry; petName: string; onFlow?: () => void }) {
  const attempts = [...new Set(e.rejections.map((r) => r.attempt))]
  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <p className="text-xs text-zinc-500">
          {dayLabel(e.ts)} à {time(e.ts, true)} · {petName}
        </p>
        <h2 className="text-base leading-snug font-semibold sm:text-lg">
          « <Question text={e.input} /> »
        </h2>
        <Tags e={e} />
      </header>

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Ce qui s’est passé</h3>
        <p className="rounded-xl border bg-white px-3.5 py-3 text-sm leading-relaxed text-zinc-800">{story(e)}</p>
      </section>

      {attempts.length ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Bloqué par la vérification</h3>
          {e.rejections.map((r, i) => (
            <div key={i} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm">
              <p className="text-[11px] font-semibold text-red-700">
                {r.attempt === 1 ? '1er' : `${r.attempt}e`} brouillon · {r.why}
              </p>
              <p className="mt-0.5 text-red-950/80 line-through decoration-red-400">« {r.text} »</p>
            </div>
          ))}
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Réponse envoyée</h3>
        <p className="border-l-2 border-zinc-300 pl-3 text-sm leading-relaxed text-zinc-800">{e.response_text}</p>
      </section>

      {e.escalation.trigger ? (
        <p className="flex items-start gap-2.5 rounded-xl border bg-white px-3 py-2.5 text-sm">
          <Stethoscope className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-medium">Vétérinaire proposé{e.escalation.urgency === 'high' ? ' tout de suite' : ''}</span>
            <span className="text-zinc-600"> : {vetReason(e.escalation.reason)}.</span>
          </span>
        </p>
      ) : null}

      {e.citations.length ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Sources citées</h3>
          <ul className="flex flex-col gap-1.5">
            {e.citations.map((c) => (
              <li key={c.source_id} className="rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-600">
                <span className="font-medium text-zinc-800">
                  {c.source_id === 'telemetry' ? 'Collier' : c.source_id === 'message' ? 'Message du propriétaire' : 'Fiche santé'} ·{' '}
                </span>
                {c.snippet}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {e.faults.length ? (
        <p className="flex items-center gap-2 text-xs text-red-800">
          <Zap className="size-3.5" />
          Pannes simulées : {e.faults.map((f) => FAULTS[f]?.label ?? f).join(', ')}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Durée', fmtMs(e.latency_ms)],
          ['Appels à l’IA', String(e.ai_calls)],
          ['Coût', e.ai_calls ? fmtEur(e.cost_eur) : '0 ct'],
          ['Consignes', e.prompt_version ?? '—'],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-white px-3 py-2">
            <dt className="text-[11px] text-zinc-500">{k}</dt>
            <dd className="text-sm font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {e.models.length ? <p className="-mt-3 text-xs text-zinc-500">Modèles : {e.models.join(', ')}</p> : null}

      {onFlow ? (
        <button type="button" onClick={onFlow} className="inline-flex w-fit items-center gap-0.5 text-sm font-medium text-zinc-800 hover:text-zinc-950">
          Voir le parcours de cette réponse <ChevronRight className="size-4" />
        </button>
      ) : null}
    </article>
  )
}

const TILES: { filter: Filter; label: string; color: string; count: (t: ReturnType<typeof totals>) => number }[] = [
  { filter: 'all', label: 'réponses', color: 'text-zinc-900', count: (t) => t.all },
  { filter: 'answered', label: 'vérifiées', color: 'text-emerald-700', count: (t) => t.byOutcome.answered },
  { filter: 'urgent', label: 'urgences', color: 'text-red-600', count: (t) => t.byOutcome.urgent },
  { filter: 'refused', label: 'refus', color: 'text-amber-700', count: (t) => t.byOutcome.diagnosis + t.byOutcome.refusal },
  { filter: 'careful', label: 'prudentes', color: 'text-orange-700', count: (t) => t.byOutcome.careful },
  { filter: 'blocked', label: 'phrases bloquées', color: 'text-violet-700', count: (t) => t.blocked },
]

/** Le journal d'audit : l'ensemble en chiffres, la liste par jour, et la fiche de chaque réponse. */
export function JournalTab({
  pets,
  entries,
  topologies,
  models,
}: {
  pets: Pet[]
  entries: Entry[]
  topologies: Partial<Record<GraphName, Topology>>
  models?: Record<string, StepModel>
}) {
  const wide = useMedia('(min-width: 1024px)')
  const [rows, setRows] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)
  const [flowOf, setFlowOf] = useState<Entry | null>(null)

  const load = useCallback(() => {
    admin.audit(200).then(setRows).catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const t = useMemo(() => totals(rows ?? []), [rows])
  const shown = useMemo(() => (rows ?? []).filter((e) => matches(e, filter, query)), [rows, filter, query])
  const groups = useMemo(() => {
    const out: { day: string; items: AuditEntry[] }[] = []
    for (const e of shown) {
      const day = dayLabel(e.ts)
      if (out.at(-1)?.day !== day) out.push({ day, items: [] })
      out.at(-1)!.items.push(e)
    }
    return out
  }, [shown])
  const current = shown.find((e) => key(e) === picked) ?? (wide ? shown[0] : undefined)
  const petName = (ref: string) => pets.find((p) => p.pet_ref === ref)?.name ?? ref
  // Le parcours n'est disponible que pour les réponses de cette session.
  const sessionEntry = (e: AuditEntry) => entries.find((x) => x.run.runId && `debug-${x.run.runId}` === e.thread_id) ?? null

  const fiche = current ? (
    <Fiche
      e={current}
      petName={petName(current.pet_ref)}
      onFlow={
        sessionEntry(current)
          ? () => {
              setSheet(false)
              setFlowOf(sessionEntry(current))
            }
          : undefined
      }
    />
  ) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Journal d’audit</h2>
              <p className="text-sm text-zinc-500">Chaque réponse envoyée au propriétaire, enregistrée avec ce qui l’a produite.</p>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border bg-white px-3 text-sm sm:w-64 sm:flex-none">
                <Search className="size-4 shrink-0 text-zinc-400" />
                <span className="sr-only">Chercher</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Chercher une question…"
                  className="min-w-0 flex-1 bg-transparent outline-none"
                />
              </label>
              <button
                type="button"
                onClick={load}
                aria-label="Actualiser"
                title="Actualiser"
                className="grid size-9 shrink-0 place-items-center rounded-xl border bg-white text-zinc-600 hover:bg-zinc-50"
              >
                <RefreshCw className="size-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
            {TILES.map((tile) => (
              <button
                key={tile.filter}
                type="button"
                onClick={() => setFilter(filter === tile.filter && tile.filter !== 'all' ? 'all' : tile.filter)}
                aria-pressed={filter === tile.filter}
                className={cn(
                  'flex flex-col items-start rounded-xl border bg-white px-3 py-2 text-left transition hover:border-zinc-300',
                  filter === tile.filter && 'border-zinc-900 ring-1 ring-zinc-900',
                )}
              >
                <span className={cn('text-xl font-semibold tabular-nums', tile.color)}>{tile.count(t)}</span>
                <span className="text-xs text-zinc-500">{tile.label}</span>
              </button>
            ))}
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span>Vétérinaire proposé : <b className="text-zinc-800">{t.vet}</b></span>
            <span>Données masquées : <b className="text-zinc-800">{t.pii}</b></span>
            <span>Durée médiane : <b className="text-zinc-800">{fmtMs(t.medianMs)}</b></span>
            <span>Coût total : <b className="text-zinc-800">{fmtEur(t.costEur)}</b></span>
          </p>
        </div>
      </div>

      {error ? <p className="p-6 text-sm text-red-700">{error}</p> : null}
      {rows && !rows.length ? <p className="p-6 text-sm text-zinc-500">Aucune réponse enregistrée pour l’instant.</p> : null}

      <div className="mx-auto grid min-h-0 w-full max-w-[1200px] flex-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6 lg:border-r">
          {groups.map((g) => (
            <section key={g.day} className="mb-4 flex flex-col gap-2">
              <h3 className="px-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase first-letter:uppercase">{g.day}</h3>
              <ul className="overflow-hidden rounded-xl border bg-white">
                {g.items.map((e) => {
                  const on = current && key(e) === key(current)
                  return (
                    <li key={key(e)} className="border-t first:border-t-0">
                      <button
                        type="button"
                        onClick={() => {
                          setPicked(key(e))
                          if (!wide) setSheet(true)
                        }}
                        className={cn(
                          'grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3 px-3.5 py-3 text-left transition hover:bg-zinc-50',
                          on && wide && 'bg-violet-50/60 shadow-[inset_3px_0_0_#7c3aed]',
                        )}
                      >
                        <span className={cn('grid size-7 place-items-center rounded-lg text-sm font-semibold', OUTCOME[e.outcome].ico)}>
                          {OUTCOME[e.outcome].glyph}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-zinc-900">
                            <Question text={e.input} />
                          </span>
                          <span className="mt-1 block">
                            <Tags e={e} />
                          </span>
                        </span>
                        <span className="text-right text-xs leading-5 text-zinc-500 tabular-nums">
                          {time(e.ts)}
                          <br />
                          {petName(e.pet_ref)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
          {rows && rows.length && !shown.length ? (
            <p className="px-1 text-sm text-zinc-500">Aucune réponse ne correspond.</p>
          ) : null}
        </div>
        {wide ? <div className="min-h-0 overflow-y-auto bg-white px-6 py-5">{fiche}</div> : null}
      </div>

      {!wide ? (
        <Sheet open={sheet && Boolean(fiche)} onClose={() => setSheet(false)} label="Fiche de la réponse">
          {fiche}
        </Sheet>
      ) : null}
      <Sheet open={Boolean(flowOf)} onClose={() => setFlowOf(null)} label="Parcours" size="full">
        <FlowPane entry={flowOf} topologies={topologies} models={models} onClose={() => setFlowOf(null)} />
      </Sheet>
    </div>
  )
}
