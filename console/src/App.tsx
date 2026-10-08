import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react'
import { fetchFaults, fetchScenarios, fetchTopology, forkRun, runDebug, runHandoff } from '@/api/client'
import type { GraphName, HandoffRequest, Scenario, Topology, TopologyNode } from '@/api/types'
import { AnswerPanel } from '@/components/AnswerPanel'
import { HandoffPanel } from '@/components/HandoffPanel'
import { Inspector, type ReplayActions } from '@/components/Inspector'
import { Timeline } from '@/components/Timeline'
import { Button } from '@/components/ui/button'
import { GraphCanvas } from '@/graph/GraphCanvas'
import { layout, type Positions } from '@/graph/layout'
import { cn } from '@/lib/utils'
import { emptyRun, reduce, shapeOf, slots as toSlots, snapshot, totalOf } from '@/run/model'
import { fmtMs } from '@/run/status'

const FAULT_LABELS: Record<string, string> = {
  classifier_down: 'classifieur en panne',
  core_api_timeout: 'Core API lent',
  retriever_down: 'recherche en panne',
  reranker_down: 'reranker en panne',
  llm_down: 'LLM en panne',
  draft_diagnostic: 'brouillon diagnostique',
  draft_ungrounded: 'brouillon sans source',
}

const GRAPHS: { id: GraphName; label: string; focus: string }[] = [
  { id: 'turn', label: 'Tour de chat', focus: 'guardrail' },
  { id: 'handoff', label: 'Dossier vétérinaire', focus: 'verify' },
]

export default function App() {
  const [graphName, setGraphName] = useState<GraphName>('turn')
  const [graphs, setGraphs] = useState<Partial<Record<GraphName, { topology: Topology; positions: Positions }>>>({})
  const topology = graphs[graphName]?.topology ?? null
  const positions = graphs[graphName]?.positions ?? {}
  const lastTurn = useRef<{ message: string; answer: string } | null>(null)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [allFaults, setAllFaults] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [message, setMessage] = useState('')
  const [faults, setFaults] = useState<string[]>([])

  const [run, dispatch] = useReducer(reduce, emptyRun)
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [stepByStep, setStepByStep] = useState(true)
  const [selected, setSelected] = useState<string | null>('guardrail')
  const abort = useRef<AbortController | null>(null)
  const cursorRef = useRef(0)
  useEffect(() => {
    cursorRef.current = cursor
  }, [cursor])

  const pick = useCallback((s: Scenario) => {
    setScenario(s)
    setMessage(s.user_message)
    setFaults(s.faults)
  }, [])

  useEffect(() => {
    Promise.all([fetchScenarios(), fetchFaults()])
      .then(([s, f]) => {
        setScenarios(s)
        setAllFaults(f)
        if (s.length) pick(s[0])
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [pick])

  // Chaque graphe est chargé et disposé une seule fois, à la première ouverture.
  useEffect(() => {
    if (graphs[graphName]) return
    fetchTopology(graphName)
      .then(async (t) => {
        const p = await layout(t)
        setGraphs((g) => ({ ...g, [graphName]: { topology: t, positions: p } }))
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [graphName, graphs])

  // On garde le dernier échange pour l'inclure dans le dossier vétérinaire.
  useEffect(() => {
    if (run.response && run.message) {
      lastTurn.current = { message: run.message, answer: run.response.response_text }
    }
  }, [run.response, run.message])

  const switchGraph = (name: GraphName) => {
    abort.current?.abort()
    dispatch({ type: 'reset' })
    setGraphName(name)
    setSelected(GRAPHS.find((g) => g.id === name)?.focus ?? null)
    setCursor(0)
  }

  const slots = useMemo(() => toSlots(run, stepByStep), [run, stepByStep])
  const total = totalOf(slots)
  const nodeIds = useMemo(() => topology?.nodes.map((n) => n.id) ?? [], [topology])
  const shape = useMemo(() => (topology ? shapeOf(topology.edges) : undefined), [topology])
  const snap = useMemo(
    () => snapshot(run, slots, cursor, nodeIds, shape),
    [run, slots, cursor, nodeIds, shape],
  )
  const meta = useMemo(
    () =>
      Object.fromEntries((topology?.nodes ?? []).map((n) => [n.id, n])) as Record<string, TopologyNode>,
    [topology],
  )

  // Lecture : le curseur avance en temps réel, sans dépasser ce qui est déjà arrivé du serveur.
  const finished = run.phase === 'done' || run.phase === 'error'
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const next = Math.min(cursorRef.current + (now - last), total)
      last = now
      cursorRef.current = next
      setCursor(next)
      if (next >= total && finished) setPlaying(false)
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, total, finished])

  /** Lance un flux (tour ou fork) en repartant du début de la chronologie. */
  const play = useCallback(async (start: (signal: AbortSignal) => Promise<void>) => {
    abort.current?.abort()
    abort.current = new AbortController()
    setCursor(0)
    setPlaying(true)
    try {
      await start(abort.current.signal)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        dispatch({ type: 'run_error', ts_ms: 0, message: (err as Error).message })
      }
    }
  }, [])

  const launch = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault()
      if (!message.trim()) return
      if (graphName === 'handoff') {
        const prev = lastTurn.current
        const extracts: HandoffRequest['thread_extracts'] = [{ role: 'owner', content: message }]
        if (prev && prev.message === message) {
          extracts.push({ role: 'assistant', content: prev.answer })
        }
        const req = {
          thread_id: 'console',
          pet_ref: scenario?.pet_ref ?? 'pet_demo_rex',
          reason: null,
          thread_extracts: extracts,
        }
        void play((signal) => runHandoff(req, dispatch, signal))
        return
      }
      const sameScenario = scenario?.user_message === message
      const req = {
        user_message: message,
        pet_ref: scenario?.pet_ref ?? 'pet_demo_rex',
        alert_context: sameScenario ? (scenario?.alert_context ?? null) : null,
        faults,
      }
      void play((signal) => runDebug(req, dispatch, signal))
    },
    [message, scenario, faults, play, graphName],
  )

  const replay = useMemo<ReplayActions | undefined>(() => {
    const runId = run.runId
    if (!runId) return undefined
    return {
      rerun: (node, attempt) =>
        void play((signal) =>
          forkRun(runId, { node, attempt, overrides: null, faults }, dispatch, signal),
        ),
      force: (node, overrides) =>
        void play((signal) =>
          forkRun(runId, { node, attempt: 1, overrides, faults }, dispatch, signal),
        ),
    }
  }, [run.runId, faults, play])

  if (loadError) {
    return (
      <div className="grid h-screen place-items-center p-8 text-center text-sm text-zinc-600">
        <div>
          <p className="font-medium text-zinc-900">L'API de l'assistant ne répond pas.</p>
          <p>
            Lancez-la avec <code className="font-mono">uv run dev</code>, puis rechargez.
          </p>
          <p className="mt-2 font-mono text-xs text-zinc-400">{loadError}</p>
        </div>
      </div>
    )
  }

  const visibleStarts = new Set(slots.filter((s) => s.start <= cursor).map((s) => s.attempt))
  const selectedAttempts = run.attempts.filter((a) => a.node === selected && visibleStarts.has(a))

  return (
    <div className="flex h-screen flex-col bg-zinc-50 text-zinc-950">
      <header className="flex flex-wrap items-center gap-3 border-b bg-white px-5 py-3">
        <span className="font-semibold">Pawrise Assistant</span>
        <div role="tablist" aria-label="Graphe" className="flex rounded-lg bg-zinc-100 p-0.5">
          {GRAPHS.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={graphName === g.id}
              onClick={() => switchGraph(g.id)}
              className={cn(
                'h-7 rounded-md px-3 text-[13px]',
                graphName === g.id ? 'bg-white font-medium shadow-xs' : 'text-zinc-600',
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        {run.forkOf ? (
          <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs text-violet-900">
            Rejoué depuis {meta[run.forkOf.node]?.label ?? run.forkOf.node}
            {run.forkOf.attempt > 1 ? ` (passage ${run.forkOf.attempt})` : ''}
          </span>
        ) : null}
        <div className="flex-1" />
        <nav aria-label="Scénarios" className="flex flex-wrap gap-1.5">
          {scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pick(s)}
              title={`Flux ${s.flow}`}
              className={cn(
                'h-8 rounded-full border px-3 text-[13px]',
                scenario?.id === s.id ? 'border-zinc-900 bg-zinc-900 text-white' : 'bg-white text-zinc-700',
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="flex flex-col gap-2 border-b bg-white px-5 py-2.5">
        <form onSubmit={launch} className="flex items-center gap-3">
          <label className="sr-only" htmlFor="msg">
            Message du propriétaire
          </label>
          <input
            id="msg"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-xl bg-zinc-100 px-3 text-sm outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="Posez une question sur le chien…"
          />
          <Button type="submit" className="h-10 px-5">
            Lancer
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={!slots.length}
            onClick={() => {
              setCursor(0)
              setPlaying(true)
            }}
          >
            Rejouer
          </Button>
        </form>
        <div className={cn('flex flex-wrap items-center gap-1.5 text-xs', graphName !== 'turn' && 'hidden')}>
          <span className="text-zinc-500">Pannes :</span>
          {allFaults.map((f) => {
            const on = faults.includes(f)
            return (
              <button
                key={f}
                type="button"
                aria-pressed={on}
                onClick={() => setFaults(on ? faults.filter((x) => x !== f) : [...faults, f])}
                className={cn(
                  'rounded-full border px-2 py-0.5',
                  on ? 'border-red-300 bg-red-50 text-red-800' : 'text-zinc-600',
                )}
              >
                {FAULT_LABELS[f] ?? f}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            {topology && Object.keys(positions).length ? (
              <GraphCanvas
                topology={topology}
                positions={positions}
                snap={snap}
                selected={selected}
                onSelect={setSelected}
              />
            ) : (
              <p className="p-6 text-sm text-zinc-500">Chargement du graphe…</p>
            )}
            <div className="pointer-events-none absolute top-3 left-3 rounded-lg bg-white/90 px-3 py-1.5 text-xs text-zinc-600 shadow-xs">
              {run.phase === 'idle'
                ? 'Prêt'
                : run.phase === 'running'
                  ? 'En direct…'
                  : run.phase === 'error'
                    ? `Erreur : ${run.error}`
                    : run.summary
                      ? 'Dossier prêt'
                      : `Tour terminé · ${fmtMs(run.response?.metadata.latency_ms ?? 0)} côté serveur`}
            </div>
          </div>
          <Timeline
            slots={slots}
            total={total}
            cursor={cursor}
            meta={meta}
            stepByStep={stepByStep}
            onSeek={(t) => {
              setPlaying(false)
              setCursor(t)
            }}
            onSelect={(node, t) => {
              setPlaying(false)
              setSelected(node)
              setCursor(t)
            }}
            onToggleMode={() => {
              setStepByStep(!stepByStep)
              setCursor(Number.MAX_SAFE_INTEGER)
            }}
          />
        </main>

        <aside className="flex w-[400px] shrink-0 flex-col border-l bg-white">
          <div className="min-h-0 flex-1">
            <Inspector
              meta={selected ? meta[selected] : undefined}
              snap={selected ? snap.nodes[selected] : undefined}
              attempts={selectedAttempts}
              replay={graphName === 'turn' ? replay : undefined}
              canReplay={run.phase === 'done' || run.phase === 'error'}
            />
          </div>
          <div className="max-h-[45%] overflow-auto border-t p-5">
            <p className="mb-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
              {graphName === 'turn' ? 'Réponse envoyée' : 'Dossier transmis'}
            </p>
            {graphName === 'handoff' && run.summary && snap.ended ? (
              <HandoffPanel summary={run.summary} />
            ) : (
              <AnswerPanel
                response={run.response}
                visible={snap.ended}
                error={run.error}
                waiting={snap.waiting}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
