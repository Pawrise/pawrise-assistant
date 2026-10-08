import { CircleHelp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphName, Scenario, Topology, TopologyNode } from '@/api/types'
import { go, useMedia } from '@/app/route'
import type { Entry } from '@/app/store'
import { Sheet } from '@/components/Sheet'
import { cn } from '@/lib/utils'
import { emptyRun, shapeOf, slots as toSlots, snapshot, totalOf } from '@/run/model'
import { FlowGraph } from './FlowGraph'
import { Legend } from './Legend'
import { RunSummary } from './RunSummary'
import { Scrubber } from './Scrubber'
import { StepPanel } from './StepPanel'

function dot(entry: Entry) {
  const { phase, response } = entry.run
  if (phase === 'running') return 'bg-violet-500 animate-pulse'
  if (phase === 'error') return 'bg-red-500'
  if (response?.escalation.urgency === 'high') return 'bg-red-500'
  if (response?.metadata.template_id) return 'bg-amber-400'
  return 'bg-emerald-500'
}

function Picker({ entries, current }: { entries: Entry[]; current: Entry | null }) {
  if (entries.length < 2) return null
  return (
    <nav aria-label="Échanges" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
      <ul className="flex w-max gap-1.5">
        {[...entries].reverse().map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => go('flow', e.id)}
              aria-current={current?.id === e.id}
              className={cn(
                'flex h-8 max-w-[220px] items-center gap-2 rounded-full border px-3 text-xs transition',
                current?.id === e.id ? 'border-zinc-900 bg-zinc-900 text-white' : 'bg-white text-zinc-700 hover:bg-zinc-50',
              )}
            >
              <span className={cn('size-1.5 shrink-0 rounded-full', dot(e))} />
              <span className="truncate">{e.graph === 'handoff' ? 'Dossier vétérinaire' : e.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function FlowView({
  entries,
  id,
  topologies,
  scenarios,
  onScenario,
  onRerun,
}: {
  entries: Entry[]
  id: string | null
  topologies: Partial<Record<GraphName, Topology>>
  scenarios: Scenario[]
  onScenario: (s: Scenario) => void
  onRerun: (entry: Entry, node: string, attempt: number) => void
}) {
  const wide = useMedia('(min-width: 1024px)')
  const entry = entries.find((e) => e.id === id) ?? entries.at(-1) ?? null
  const graph: GraphName = entry?.graph ?? 'turn'
  const topology = topologies[graph]
  const run = entry?.run ?? emptyRun

  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [legend, setLegend] = useState(false)
  const cursorRef = useRef(0)

  const slots = useMemo(() => toSlots(run, true), [run])
  const total = totalOf(slots)
  const live = run.phase === 'running'
  const nodeIds = useMemo(() => topology?.nodes.map((n) => n.id) ?? [], [topology])
  const shape = useMemo(() => (topology ? shapeOf(topology.edges) : undefined), [topology])
  const snap = useMemo(() => snapshot(run, slots, cursor, nodeIds, shape), [run, slots, cursor, nodeIds, shape])
  const meta = useMemo(
    () => Object.fromEntries((topology?.nodes ?? []).map((n) => [n.id, n])) as Record<string, TopologyNode>,
    [topology],
  )

  // Un nouvel échange : en direct, on le suit depuis le début ; terminé, on montre l'état final.
  const shownId = entry?.id ?? null
  useEffect(() => {
    setSelected(null)
    if (live) {
      cursorRef.current = 0
      setCursor(0)
      setPlaying(true)
    } else {
      cursorRef.current = Number.MAX_SAFE_INTEGER
      setCursor(Number.MAX_SAFE_INTEGER)
      setPlaying(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seulement au changement d'échange
  }, [shownId])

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const next = Math.min(cursorRef.current + (now - last), total)
      last = now
      cursorRef.current = next
      setCursor(next)
      if (next >= total && !live) setPlaying(false)
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, total, live])

  const seek = useCallback((t: number) => {
    setPlaying(false)
    cursorRef.current = t
    setCursor(t)
  }, [])
  const play = useCallback(() => {
    if (cursorRef.current >= total) {
      cursorRef.current = 0
      setCursor(0)
    }
    setPlaying(true)
  }, [total])

  const visible = new Set(slots.filter((s) => s.start <= cursor).map((s) => s.attempt))
  const shownAttempts = run.attempts.filter((a) => visible.has(a))
  const panel =
    selected && meta[selected] ? (
      <StepPanel
        meta={meta[selected]}
        snap={snap.nodes[selected]}
        attempts={shownAttempts.filter((a) => a.node === selected)}
        onClose={() => setSelected(null)}
        onRerun={
          entry && entry.graph === 'turn' && !live && run.runId
            ? (node, attempt) => onRerun(entry, node, attempt)
            : undefined
        }
      />
    ) : null

  return (
    <div className="flex h-full min-h-0 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_400px]">
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-3 border-b bg-white px-4 pt-3 pb-3 lg:hidden">
          <Picker entries={entries} current={entry} />
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {entry ? (
                <RunSummary entry={entry} compact />
              ) : (
                <p className="text-sm text-zinc-600">Touchez une étape pour savoir ce qu’elle fait.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setLegend(true)}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-white px-3 text-xs font-medium text-zinc-700"
            >
              <CircleHelp className="size-3.5" /> Comment lire
            </button>
          </div>
        </div>
        <div className="hidden px-6 pt-4 lg:block">
          <Picker entries={entries} current={entry} />
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto">
          {!entry ? (
            <div className="mx-auto mt-4 flex max-w-[640px] flex-col gap-3 px-4 sm:mt-6">
              <div className="rounded-2xl border bg-white p-4 shadow-xs sm:p-5">
                <h1 className="text-base font-semibold sm:text-lg">Le parcours d’une réponse</h1>
                <p className="mt-1 text-sm text-zinc-600">
                  Chaque message passe par ces étapes. Lancez un exemple pour les voir s’allumer en direct.
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {scenarios.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onScenario(s)}
                      className="h-8 rounded-full border bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          {topology ? (
            <FlowGraph
              name={graph}
              topology={topology}
              snap={snap}
              attempts={shownAttempts}
              selected={selected}
              onSelect={(n) => setSelected(n === selected ? null : n)}
            />
          ) : (
            <p className="p-6 text-sm text-zinc-500">Chargement du parcours…</p>
          )}
        </div>

        {entry ? (
          <div className="border-t bg-white/95 px-4 py-3 backdrop-blur lg:px-6">
            <Scrubber
              slots={slots}
              total={total}
              cursor={Math.min(cursor, total)}
              playing={playing}
              live={live}
              meta={meta}
              onSeek={seek}
              onPlay={play}
              onPause={() => setPlaying(false)}
            />
          </div>
        ) : null}
      </section>

      <aside className="hidden min-h-0 overflow-y-auto border-l bg-zinc-50 p-5 lg:block">
        {panel ?? (
          <div className="flex flex-col gap-6">
            {entry ? <RunSummary entry={entry} /> : (
              <p className="text-sm text-zinc-600">Touchez une étape pour savoir ce qu’elle fait.</p>
            )}
            <div className="border-t pt-5">
              <Legend />
            </div>
          </div>
        )}
      </aside>

      {!wide ? (
        <>
          <Sheet open={Boolean(panel)} onClose={() => setSelected(null)} label="Détail de l’étape">
            {panel}
          </Sheet>
          <Sheet open={legend} onClose={() => setLegend(false)} label="Comment lire le parcours">
            <Legend />
          </Sheet>
        </>
      ) : null}
    </div>
  )
}
