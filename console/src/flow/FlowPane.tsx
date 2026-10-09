import { CircleHelp, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphName, StepModel, Topology, TopologyNode } from '@/api/types'
import { FAULTS, faultMarks } from '@/app/labels'
import type { Entry } from '@/app/store'
import { Popover } from '@/components/Popover'
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
  armed = [],
  models = {},
}: {
  entry: Entry | null
  topologies: Partial<Record<GraphName, Topology>>
  onRerun?: (entry: Entry, node: string, attempt: number) => void
  onClose?: () => void
  /** Pannes cochées pour le prochain message : leurs étapes sont marquées tout de suite. */
  armed?: string[]
  /** Le modèle d'IA de chaque étape. */
  models?: Record<string, StepModel>
}) {
  const graph: GraphName = entry?.graph ?? 'turn'
  const topology = topologies[graph]
  const run = entry?.run ?? emptyRun

  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [legend, setLegend] = useState(false)
  const cursorRef = useRef(0)
  // Un message envoyé mais pas encore démarré côté serveur se suit déjà en direct.
  const live = run.phase === 'running' || (run.phase === 'idle' && entry !== null)

  // En direct, l'horloge du tour fait avancer les étapes en cours, même sans nouvel événement.
  const slots = useMemo(() => toSlots(run, live ? cursor : 0), [run, live, cursor])
  const total = totalOf(slots)
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
    // Chaque échange affiché se joue depuis le début : en direct s'il tourne encore, en relecture
    // sinon. C'est le mode par défaut, que le message soit nouveau ou une ancienne réponse.
    cursorRef.current = 0
    setCursor(0)
    setPlaying(Boolean(shownId))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seulement au changement d'échange
  }, [shownId])

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      // En direct, le temps avance librement ; en relecture, il s'arrête à la fin du tour.
      const next = live ? cursorRef.current + (now - last) : Math.min(cursorRef.current + (now - last), total)
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
        <Popover
          open={legend}
          onClose={() => setLegend(false)}
          label="Comment lire le parcours"
          trigger={
            <button
              type="button"
              onClick={() => setLegend(!legend)}
              aria-expanded={legend}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <CircleHelp className="size-3.5" />
              <span className="hidden sm:inline">Comment lire</span>
            </button>
          }
        >
          <Legend />
        </Popover>
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

      {armed.length ? (
        <p className="flex items-center gap-2 border-b bg-red-50 px-4 py-2 text-xs text-red-800 lg:px-5">
          <Zap className="size-3.5 shrink-0" />
          <span>
            <span className="font-medium">Au prochain message : </span>
            {armed.map((f) => FAULTS[f]?.label ?? f).join(' · ')}. Les étapes visées sont marquées.
          </span>
        </p>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {topology ? (
          <FlowGraph
            name={graph}
            topology={topology}
            snap={snap}
            attempts={shownAttempts}
            selected={selected}
            onSelect={(n) => setSelected(n === selected ? null : n)}
            onClose={() => setSelected(null)}
            marks={faultMarks(entry?.faults ?? [], armed)}
            models={models}
            detail={
              selected && meta[selected] ? (
                <StepPanel
                  key={selected}
                  meta={meta[selected]}
                  snap={snap.nodes[selected]}
                  attempts={shownAttempts.filter((a) => a.node === selected)}
                  onClose={() => setSelected(null)}
                  model={models[selected]}
                  onRerun={
                    entry && onRerun && entry.graph === 'turn' && !live && run.runId
                      ? (node, attempt) => {
                          setSelected(null)
                          onRerun(entry, node, attempt)
                        }
                      : undefined
                  }
                />
              ) : null
            }
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

    </div>
  )
}
