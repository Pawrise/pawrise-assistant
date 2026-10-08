import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { fetchFaults, fetchInfo, fetchScenarios, fetchTopology, forkRun, runDebug, runHandoff } from '@/api/client'
import type { DebugEvent, GraphName, Info, Scenario, Topology } from '@/api/types'
import { go, useRoute } from '@/app/route'
import { newId, storeReduce, type Entry, type NewEntry } from '@/app/store'
import { ChatView } from '@/chat/ChatView'
import { Shell } from '@/components/Shell'
import { FlowView } from '@/flow/FlowView'
import { TestView } from '@/test/TestView'

type Streamer = (onEvent: (e: DebugEvent) => void, signal: AbortSignal) => Promise<void>

export default function App() {
  const route = useRoute()
  const [entries, dispatch] = useReducer(storeReduce, [])
  const [info, setInfo] = useState<Info | null>(null)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [faults, setFaults] = useState<string[]>([])
  const [topologies, setTopologies] = useState<Partial<Record<GraphName, Topology>>>({})
  const [petRef, setPetRef] = useState('pet_demo_rex')
  const [loadError, setLoadError] = useState<string | null>(null)
  const entriesRef = useRef(entries)
  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  useEffect(() => {
    Promise.all([fetchInfo(), fetchScenarios(), fetchFaults(), fetchTopology('turn'), fetchTopology('handoff')])
      .then(([i, s, f, turn, handoff]) => {
        setInfo(i)
        setScenarios(s)
        setFaults(f)
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

  const ask = useCallback(
    (message: string, pet: string, alert: Scenario['alert_context'] = null, scenarioId: string | null = null) => {
      // L'historique reprend les derniers échanges de la discussion, comme dialog le ferait.
      const history = entriesRef.current
        .filter((e) => e.origin === 'chat' && e.graph === 'turn' && e.run.response)
        .slice(-3)
        .flatMap((e) => [
          { role: 'owner' as const, content: e.message },
          { role: 'assistant' as const, content: e.run.response?.response_text ?? '' },
        ])
      void start(
        { graph: 'turn', origin: 'chat', message, petRef: pet, scenarioId, faults: [], parent: null },
        (onEvent, signal) =>
          runDebug({ user_message: message, pet_ref: pet, alert_context: alert, faults: [], history }, onEvent, signal),
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

  const runFree = useCallback(
    (message: string, chosen: string[]) =>
      void start(
        { graph: 'turn', origin: 'test', message, petRef: 'pet_demo_rex', scenarioId: null, faults: chosen, parent: null },
        (onEvent, signal) =>
          runDebug({ user_message: message, pet_ref: 'pet_demo_rex', alert_context: null, faults: chosen }, onEvent, signal),
      ),
    [start],
  )

  const rerun = useCallback((from: Entry, node: string, attempt: number) => {
    const runId = from.run.runId
    if (!runId) return
    const id = newId()
    dispatch({ type: 'add', id, entry: { ...from, origin: 'test', parent: { id: from.id, node } } })
    go('flow', id)
    forkRun(runId, { node, attempt, overrides: null, faults: [] }, (event) => dispatch({ type: 'event', id, event })).catch(
      (err: Error) => dispatch({ type: 'failed', id, message: err.message }),
    )
  }, [])

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
    <Shell view={route.view} flowId={route.id} info={info} live={live}>
      {route.view === 'chat' ? (
        <ChatView
          entries={chat}
          pets={info?.pets ?? []}
          petRef={petRef}
          onPet={setPetRef}
          scenarios={scenarios}
          onSend={(m) => ask(m, petRef)}
          onScenario={(s) => {
            setPetRef(s.pet_ref)
            ask(s.user_message, s.pet_ref, s.alert_context, s.id)
          }}
          onHandoff={handoff}
        />
      ) : route.view === 'flow' ? (
        <FlowView
          entries={entries}
          id={route.id}
          topologies={topologies}
          scenarios={scenarios}
          onScenario={(s) => {
            void runScenario(s)
            go('flow')
          }}
          onRerun={rerun}
        />
      ) : (
        <TestView
          scenarios={scenarios}
          faults={faults}
          entries={entries}
          onRun={(s) => void runScenario(s)}
          onRunAll={() => void runAll()}
          onFree={runFree}
        />
      )}
    </Shell>
  )
}
