import { Check, ChevronRight, Play, X } from 'lucide-react'
import { useState } from 'react'
import type { Scenario } from '@/api/types'
import { FAULTS } from '@/app/labels'
import { href } from '@/app/route'
import { conforms, liveStatus, type Entry } from '@/app/store'
import { cn } from '@/lib/utils'
import { fmtMs } from '@/run/status'

function Result({ entry, scenario }: { entry: Entry | undefined; scenario: Scenario | null }) {
  if (!entry) return null
  const { run } = entry
  if (run.phase === 'running' || run.phase === 'idle') {
    return <p className="shimmer text-sm">{liveStatus(run)}</p>
  }
  const ok = scenario ? conforms(run, scenario) : run.phase === 'done'
  const r = run.response
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
            ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800',
          )}
        >
          {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
          {scenario ? (ok ? 'Conforme' : 'Différent') : ok ? 'Terminé' : 'Échec'}
        </span>
        {r ? <span className="text-xs text-zinc-500 tabular-nums">{fmtMs(r.metadata.latency_ms)}</span> : null}
        <a
          href={href('flow', entry.id)}
          className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium text-zinc-700 hover:text-zinc-950"
        >
          Parcours <ChevronRight className="size-3.5" />
        </a>
      </div>
      {r ? <p className="line-clamp-3 text-[13px] leading-snug text-zinc-600">{r.response_text}</p> : null}
      {run.phase === 'error' ? <p className="text-xs text-red-700">{run.error}</p> : null}
    </div>
  )
}

export function TestView({
  scenarios,
  faults,
  entries,
  onRun,
  onRunAll,
  onFree,
}: {
  scenarios: Scenario[]
  faults: string[]
  entries: Entry[]
  onRun: (s: Scenario) => void
  onRunAll: () => void
  onFree: (message: string, faults: string[]) => void
}) {
  const [message, setMessage] = useState('Il boite de la patte arrière depuis hier, c’est grave ?')
  const [chosen, setChosen] = useState<string[]>([])
  const latest = (id: string) => entries.findLast((e) => e.scenarioId === id && e.origin === 'test')
  const free = entries.findLast((e) => e.scenarioId === null && e.origin === 'test' && !e.parent)
  const done = scenarios.map((s) => latest(s.id)).filter((e) => e && e.run.phase !== 'running')
  const passed = scenarios.filter((s) => {
    const e = latest(s.id)
    return e && conforms(e.run, s)
  }).length
  const running = entries.some((e) => e.origin === 'test' && e.run.phase === 'running')

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-8 px-4 py-5 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Tester</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Chaque scénario dit ce qui est attendu. On lance, on compare.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {done.length ? (
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
            return (
              <article key={s.id} className="flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-xs">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold">{s.label}</h2>
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
                  <div className="mt-auto border-t pt-3">
                    <Result entry={e} scenario={s} />
                  </div>
                ) : null}
              </article>
            )
          })}
        </section>

        <section className="grid gap-4 rounded-2xl border bg-white p-4 shadow-xs sm:p-5 lg:grid-cols-[1fr_1fr]">
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="font-semibold">Message libre, avec pannes</h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                Simulez une panne pour voir comment l’assistant se protège.
              </p>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="resize-none rounded-xl border bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:bg-white"
            />
            <button
              type="button"
              onClick={() => onFree(message, chosen)}
              disabled={!message.trim()}
              className="inline-flex h-10 w-fit items-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              <Play className="size-4" /> Lancer
            </button>
            <Result entry={free} scenario={null} />
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Pannes simulées</legend>
            {faults.map((f) => {
              const on = chosen.includes(f)
              return (
                <label
                  key={f}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2 transition',
                    on ? 'bg-red-50' : 'hover:bg-zinc-50',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setChosen(on ? chosen.filter((x) => x !== f) : [...chosen, f])}
                    className="mt-0.5 size-4 accent-red-600"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-zinc-900">{FAULTS[f]?.label ?? f}</span>
                    <span className="text-xs text-zinc-500">Attendu : {FAULTS[f]?.effect ?? '—'}</span>
                  </span>
                </label>
              )
            })}
          </fieldset>
        </section>
      </div>
    </div>
  )
}
