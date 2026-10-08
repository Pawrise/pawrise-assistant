import { Check, ChevronRight, Play, X } from 'lucide-react'
import { useState } from 'react'
import type { GraphName, Scenario, Topology } from '@/api/types'
import { FAULTS } from '@/app/labels'
import { conforms, liveStatus, type Entry } from '@/app/store'
import { Sheet } from '@/components/Sheet'
import { FlowPane } from '@/flow/FlowPane'
import { cn } from '@/lib/utils'
import { fmtMs } from '@/run/status'

/** Les scénarios de référence : chacun dit ce qu'il attend, on lance, on compare. */
export function ScenariosTab({
  scenarios,
  entries,
  topologies,
  onRun,
  onRunAll,
  onRerun,
}: {
  scenarios: Scenario[]
  entries: Entry[]
  topologies: Partial<Record<GraphName, Topology>>
  onRun: (s: Scenario) => void
  onRunAll: () => void
  onRerun: (entry: Entry, node: string, attempt: number) => void
}) {
  const [shown, setShown] = useState<string | null>(null)
  const latest = (id: string) => entries.findLast((e) => e.scenarioId === id && e.origin === 'test')
  const passed = scenarios.filter((s) => {
    const e = latest(s.id)
    return e && conforms(e.run, s)
  }).length
  const tried = scenarios.filter((s) => latest(s.id)).length
  const running = entries.some((e) => e.origin === 'test' && e.run.phase === 'running')
  const entry = entries.find((e) => e.id === shown) ?? null

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-5 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight sm:text-xl">Scénarios de référence</h2>
            <p className="mt-1 text-sm text-zinc-500">Un par flux du produit. Chacun dit ce qui est attendu.</p>
          </div>
          <div className="flex items-center gap-3">
            {tried ? (
              <span className="text-sm text-zinc-600 tabular-nums">
                <span className={cn('font-semibold', passed === scenarios.length ? 'text-emerald-700' : 'text-zinc-900')}>
                  {passed}/{scenarios.length}
                </span>{' '}
                conformes
              </span>
            ) : null}
            <button
              type="button"
              onClick={onRunAll}
              disabled={running}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              <Play className="size-4" /> Tout lancer
            </button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {scenarios.map((s) => {
            const e = latest(s.id)
            const ok = e ? conforms(e.run, s) : null
            return (
              <article key={s.id} className="flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-xs">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">{s.label}</h3>
                  <button
                    type="button"
                    onClick={() => onRun(s)}
                    disabled={e?.run.phase === 'running'}
                    aria-label={`Lancer ${s.label}`}
                    className="grid size-8 shrink-0 place-items-center rounded-full border text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  >
                    <Play className="size-3.5 translate-x-px" />
                  </button>
                </div>
                <p className="text-sm text-zinc-800">« {s.user_message} »</p>
                <p className="text-[13px] text-zinc-500">
                  <span className="font-medium text-zinc-700">Attendu : </span>
                  {s.expect}
                </p>
                {s.faults.length ? (
                  <div className="flex flex-wrap gap-1">
                    {s.faults.map((f) => (
                      <span key={f} className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-800">
                        {FAULTS[f]?.label ?? f}
                      </span>
                    ))}
                  </div>
                ) : null}
                {e ? (
                  <div className="mt-auto flex flex-col gap-2 border-t pt-3">
                    {e.run.phase === 'running' ? (
                      <p className="shimmer text-sm">{liveStatus(e.run)}</p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                            ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800',
                          )}
                        >
                          {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                          {ok ? 'Conforme' : 'Différent'}
                        </span>
                        {e.run.response ? (
                          <span className="text-xs text-zinc-500 tabular-nums">{fmtMs(e.run.response.metadata.latency_ms)}</span>
                        ) : null}
                      </div>
                    )}
                    {e.run.response ? (
                      <p className="line-clamp-3 text-[13px] leading-snug text-zinc-600">{e.run.response.response_text}</p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setShown(e.id)}
                      className="inline-flex w-fit items-center gap-0.5 text-xs font-medium text-zinc-700 hover:text-zinc-950"
                    >
                      Voir le parcours <ChevronRight className="size-3.5" />
                    </button>
                  </div>
                ) : null}
              </article>
            )
          })}
        </section>
      </div>
      <Sheet open={Boolean(entry)} onClose={() => setShown(null)} label="Parcours" size="full">
        <FlowPane entry={entry} topologies={topologies} onRerun={onRerun} onClose={() => setShown(null)} />
      </Sheet>
    </div>
  )
}
