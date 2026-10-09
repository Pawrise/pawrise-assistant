import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { fetchFaults, fetchInfo, fetchScenarios, fetchTopology, forkRun, runDebug, runHandoff } from '@/api/client'
import type { DebugEvent, GraphName, Info, Scenario, Topology } from '@/api/types'
import { useRoute } from '@/app/route'
import { newId, storeReduce, type Entry, type NewEntry } from '@/app/store'
import { Shell } from '@/components/Shell'
import { ConversationView } from '@/conversation/ConversationView'
import { KnowledgeView } from '@/knowledge/KnowledgeView'
import { QualityView } from '@/quality/QualityView'
import { useEvals } from '@/quality/useEvals'

type Streamer = (onEvent: (e: DebugEvent) => void, signal: AbortSignal) => Promise<void>

export default function App() {
  const route = useRoute()
  const [entries, dispatch] = useReducer(storeReduce, [])
  const [info, setInfo] = useState<Info | null>(null)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [allFaults, setAllFaults] = useState<string[]>([])
  const [faults, setFaults] = useState<string[]>([])
  const [topologies, setTopologies] = useState<Partial<Record<GraphName, Topology>>>({})
  const [petRef, setPetRef] = useState('pet_demo_rex')
  const [loadError, setLoadError] = useState<string | null>(null)
  const evals = useEvals()
  const entriesRef = useRef(entries)
  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  useEffect(() => {
    Promise.all([fetchInfo(), fetchScenarios(), fetchFaults(), fetchTopology('turn'), fetchTopology('handoff')])
      .then(([i, s, f, turn, handoff]) => {
        setInfo(i)
        setScenarios(s)
        setAllFaults(f)
        setTopologies({ turn, handoff })
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [])

  /** Ajoute un échange et branche son flux d'événements. Résout à la fin du tour. */
  const start = useCallback(async (entry: NewEntry, stream: Streamer): Promise<string> => {
    const id = newId()
    dispatch({ type: 'add', id, entry })
    try {
      await stream((event) => dispatch({ type: 'event', id, event }), new AbortController().signal)
    } catch (err) {
      dispatch({ type: 'failed', id, message: (err as Error).message })
    }
    return id
  }, [])

  /** Un message dans la conversation. Les pannes choisies ne valent que pour lui. */
  const ask = useCallback(
    (message: string, opts: { pet: string; alert?: Scenario['alert_context']; scenarioId?: string; faults?: string[] }) => {
      // L'historique reprend les derniers échanges de la discussion, comme dialog le ferait.
      const history = entriesRef.current
        .filter((e) => e.origin === 'chat' && e.graph === 'turn' && e.run.response)
        .slice(-3)
        .flatMap((e) => [
          { role: 'owner' as const, content: e.message },
          { role: 'assistant' as const, content: e.run.response?.response_text ?? '' },
        ])
      const chosen = opts.faults ?? []
      setFaults([])
      void start(
        { graph: 'turn', origin: 'chat', message, petRef: opts.pet, scenarioId: opts.scenarioId ?? null, faults: chosen, parent: null },
        (onEvent, signal) =>
          runDebug(
            { user_message: message, pet_ref: opts.pet, alert_context: opts.alert ?? null, faults: chosen, history },
            onEvent,
            signal,
          ),
      )
    },
    [start],
  )

  const handoff = useCallback(
    (from: Entry) => {
      const extracts = [
        { role: 'owner' as const, content: from.message },
        ...(from.run.response ? [{ role: 'assistant' as const, content: from.run.response.response_text }] : []),
      ]
      void start(
        { graph: 'handoff', origin: 'chat', message: from.message, petRef: from.petRef, scenarioId: null, faults: [], parent: null },
        (onEvent, signal) =>
          runHandoff({ thread_id: 'console', pet_ref: from.petRef, reason: null, thread_extracts: extracts }, onEvent, signal),
      )
    },
    [start],
  )

  const runScenario = useCallback(
    (s: Scenario) =>
      start(
        { graph: 'turn', origin: 'test', message: s.user_message, petRef: s.pet_ref, scenarioId: s.id, faults: s.faults, parent: null },
        (onEvent, signal) =>
          runDebug({ user_message: s.user_message, pet_ref: s.pet_ref, alert_context: s.alert_context, faults: s.faults }, onEvent, signal),
      ),
    [start],
  )

  const runAll = useCallback(async () => {
    for (const s of scenarios) await runScenario(s)
  }, [scenarios, runScenario])

  /** Relance un échange depuis une étape : il reste là où il était (discussion ou scénarios). */
  const rerun = useCallback((from: Entry, node: string, attempt: number) => {
    const runId = from.run.runId
    if (!runId) return
    const id = newId()
    dispatch({ type: 'add', id, entry: { ...from, faults: [], parent: { id: from.id, node } } })
    forkRun(runId, { node, attempt, overrides: null, faults: [] }, (event) => dispatch({ type: 'event', id, event })).catch(
      (err: Error) => dispatch({ type: 'failed', id, message: err.message }),
    )
  }, [])

  const labels = useMemo(
    () =>
      Object.fromEntries(
        (topologies.turn?.nodes ?? []).concat(topologies.handoff?.nodes ?? []).map((n) => [n.id, n.label]),
      ) as Record<string, string>,
    [topologies],
  )
  /** Combien de fois chaque passage a été cité pendant la session. */
  const cited = useMemo(() => {
    const out: Record<string, number> = {}
    for (const e of entries) for (const c of e.run.response?.citations ?? []) out[c.source_id] = (out[c.source_id] ?? 0) + 1
    return out
  }, [entries])

  if (loadError) {
    return (
      <div className="grid h-dvh place-items-center bg-zinc-50 p-8 text-center text-sm text-zinc-600">
        <div className="max-w-sm">
          <p className="text-base font-semibold text-zinc-900">L’assistant ne répond pas.</p>
          <p className="mt-1">
            Lancez l’API avec <code className="rounded bg-zinc-100 px-1 font-mono">uv run dev</code>, puis rechargez la page.
          </p>
          <p className="mt-3 font-mono text-xs text-zinc-400">{loadError}</p>
        </div>
      </div>
    )
  }

  const chat = entries.filter((e) => e.origin === 'chat')
  const live = entries.some((e) => e.run.phase === 'running')

  return (
    <Shell view={route.view} live={live}>
      {route.view === 'conversation' ? (
        <ConversationView
          entries={chat}
          topologies={topologies}
          pets={info?.pets ?? []}
          petRef={petRef}
          scenarios={scenarios}
          allFaults={allFaults}
          faults={faults}
          onFaults={setFaults}
          onSend={(m) => ask(m, { pet: petRef, faults })}
          onScenario={(s) => {
            setPetRef(s.pet_ref)
            ask(s.user_message, { pet: s.pet_ref, alert: s.alert_context, scenarioId: s.id, faults })
          }}
          onHandoff={handoff}
          onRerun={rerun}
          onReset={() => {
            dispatch({ type: 'clear', origin: 'chat' })
            setFaults([])
          }}
        />
      ) : route.view === 'knowledge' ? (
        <KnowledgeView tab={route.tab} id={route.id} cited={cited} />
      ) : (
        <QualityView
          tab={route.tab}
          info={info}
          pets={info?.pets ?? []}
          labels={labels}
          evals={evals.state}
          onStartEvals={evals.start}
          scenarios={{
            scenarios,
            entries: entries.filter((e) => e.origin === 'test'),
            topologies,
            onRun: (s) => void runScenario(s),
            onRunAll: () => void runAll(),
            onRerun: rerun,
          }}
        />
      )}
    </Shell>
  )
}
