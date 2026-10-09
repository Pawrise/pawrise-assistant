import { CircleHelp, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphName, Topology, TopologyNode } from '@/api/types'
import type { Entry } from '@/app/store'
import { Sheet } from '@/components/Sheet'
import { emptyRun, shapeOf, slots as toSlots, snapshot, totalOf } from '@/run/model'
import { FlowGraph } from './FlowGraph'
import { Legend } from './Legend'
import { RunSummary } from './RunSummary'
import { Scrubber } from './Scrubber'
import { StepPanel } from './StepPanel'

/**
 * Le parcours d'un échange, en direct ou rejoué : résumé, graphe, barre de lecture. Le détail
 * d'une étape s'ouvre par-dessus. Utilisé à côté de la discussion, ou en plein écran.
 */
export function FlowPane({
  entry,
  topologies,
  onRerun,
  onClose,
}: {
  entry: Entry | null
  topologies: Partial<Record<GraphName, Topology>>
  onRerun?: (entry: Entry, node: string, attempt: number) => void
  onClose?: () => void
}) {
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

  // Un autre échange : en direct, on le suit depuis le début ; terminé, on montre l'état final.
  const shownId = entry?.id ?? null
  useEffect(() => {
    setSelected(null)
    const start = live ? 0 : Number.MAX_SAFE_INTEGER
    cursorRef.current = start
    setCursor(start)
    setPlaying(live)
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-50">
      <header className="flex items-start gap-3 border-b bg-white px-4 py-3 lg:px-5">
        <div className="min-w-0 flex-1">
          {entry ? (
            <RunSummary entry={entry} compact />
          ) : (
            <div>
              <p className="text-sm font-semibold">Le parcours d’une réponse</p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setLegend(true)}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <CircleHelp className="size-3.5" />
          <span className="hidden sm:inline">Comment lire</span>
        </button>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le parcours"
            className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </header>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
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
        <div className="border-t bg-white px-4 py-3 lg:px-5">
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

      <Sheet open={Boolean(selected && meta[selected])} onClose={() => setSelected(null)} label="Détail de l’étape">
        {selected && meta[selected] ? (
          <StepPanel
            meta={meta[selected]}
            snap={snap.nodes[selected]}
            attempts={shownAttempts.filter((a) => a.node === selected)}
            onClose={() => setSelected(null)}
            onRerun={
              entry && onRerun && entry.graph === 'turn' && !live && run.runId
                ? (node, attempt) => {
                    setSelected(null)
                    onRerun(entry, node, attempt)
                  }
                : undefined
            }
          />
        ) : null}
      </Sheet>
      <Sheet open={legend} onClose={() => setLegend(false)} label="Comment lire le parcours">
        <Legend nodes={topology?.nodes ?? []} />
      </Sheet>
    </div>
  )
}
