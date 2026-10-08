// Modèle d'un tour, construit à partir des événements du flux de debug.
// Tout est pur : la console calcule l'état du graphe à n'importe quel instant de la chronologie,
// ce qui permet de rejouer le tour en déplaçant le curseur.

import type { AssistantResponse, DebugEvent, NodeStatus } from '@/api/types'

export interface Attempt {
  node: string
  attempt: number
  startTs: number
  endTs: number | null
  durationMs: number | null
  status: NodeStatus | null
  summary: string
  data: Record<string, unknown>
  recoveredTo: string | null
  /** Passage repris tel quel du tour d'origine (fork), pas réexécuté. */
  reused: boolean
}

export interface RunState {
  phase: 'idle' | 'running' | 'done' | 'error'
  runId: string | null
  forkOf: { runId: string; node: string; attempt: number } | null
  attempts: Attempt[]
  response: AssistantResponse | null
  error: string | null
}

export const emptyRun: RunState = {
  phase: 'idle',
  runId: null,
  forkOf: null,
  attempts: [],
  response: null,
  error: null,
}

export function reduce(state: RunState, e: DebugEvent): RunState {
  switch (e.type) {
    case 'run_started':
      return {
        ...emptyRun,
        phase: 'running',
        runId: e.run_id,
        forkOf:
          e.fork_of && e.from_node
            ? { runId: e.fork_of, node: e.from_node, attempt: e.from_attempt ?? 1 }
            : null,
        attempts: (e.reused ?? []).map((r) => ({
          node: r.node,
          attempt: r.attempt,
          startTs: 0,
          endTs: 0,
          durationMs: 0,
          status: r.status,
          summary: r.summary,
          data: r.data,
          recoveredTo: null,
          reused: true,
        })),
      }
    case 'node_started':
      return {
        ...state,
        attempts: [
          ...state.attempts,
          {
            node: e.node,
            attempt: e.attempt,
            startTs: e.ts_ms,
            endTs: null,
            durationMs: null,
            status: null,
            summary: '',
            data: {},
            recoveredTo: null,
            reused: false,
          },
        ],
      }
    case 'node_finished': {
      const i = state.attempts.findLastIndex((a) => a.node === e.node && a.attempt === e.attempt)
      if (i < 0) return state
      const attempts = state.attempts.slice()
      attempts[i] = {
        ...attempts[i],
        endTs: e.ts_ms,
        durationMs: e.duration_ms,
        status: e.status,
        summary: e.summary,
        data: e.data,
        recoveredTo: e.recovered_to,
      }
      return { ...state, attempts }
    }
    case 'run_finished':
      return { ...state, phase: 'done', response: e.response }
    case 'run_error':
      return { ...state, phase: 'error', error: e.message }
  }
}

// — Chronologie d'affichage —

/** Durée minimale d'un passage à l'écran : les nœuds de dev durent quelques millisecondes. */
export const MIN_SLOT_MS = 150

export interface Slot {
  attempt: Attempt
  start: number
  end: number
}

/**
 * Les nœuds s'exécutent l'un après l'autre : on les place bout à bout. En pas à pas, chaque passage
 * dure au moins MIN_SLOT_MS à l'écran ; sinon, sa vraie durée (1 ms minimum pour rester visible).
 */
export function slots(run: RunState, stepByStep: boolean): Slot[] {
  let cursor = 0
  return run.attempts.map((a) => {
    const real = a.durationMs ?? MIN_SLOT_MS
    const dur = stepByStep ? Math.max(real, MIN_SLOT_MS) : Math.max(real, 1)
    const start = cursor
    cursor += dur
    return { attempt: a, start, end: cursor }
  })
}

export function totalOf(s: Slot[]): number {
  return s.length ? Math.max(...s.map((x) => x.end)) : 0
}

// — État du graphe à un instant —

export type NodeView =
  | 'pending'
  | 'running'
  | 'skipped'
  | 'ok'
  | 'redirected'
  | 'rejected'
  | 'degraded'
  | 'error'

export interface NodeSnapshot {
  view: NodeView
  count: number
  ms: number
}

export interface Snapshot {
  nodes: Record<string, NodeSnapshot>
  taken: Set<string>
  active: string | null
  ended: boolean
}

export const edgeId = (source: string, target: string) => `${source}->${target}`

export function snapshot(run: RunState, s: Slot[], cursor: number, nodeIds: string[]): Snapshot {
  const total = totalOf(s)
  const ended = run.phase !== 'running' && run.phase !== 'idle' && cursor >= total
  const seen = s.filter((x) => x.start <= cursor)
  const nodes: Record<string, NodeSnapshot> = {}

  for (const id of nodeIds) {
    const mine = seen.filter((x) => x.attempt.node === id)
    if (!mine.length) {
      nodes[id] = { view: ended ? 'skipped' : 'pending', count: 0, ms: 0 }
      continue
    }
    const last = mine[mine.length - 1]
    const running = cursor < last.end || last.attempt.status === null
    nodes[id] = {
      view: running ? 'running' : (last.attempt.status as NodeView),
      count: mine.length,
      ms: mine.reduce((acc, x) => acc + (x.attempt.durationMs ?? 0), 0),
    }
  }

  if (seen.length) nodes['__start__'] = { view: 'ok', count: 1, ms: 0 }
  if (ended && run.response) nodes['__end__'] = { view: 'ok', count: 1, ms: 0 }

  // Le Core API n'est pas un nœud du graphe : son état vient des outils appelés par le nœud 2.
  const qu = seen.filter((x) => x.attempt.node === 'query_understanding').at(-1)
  const tools = (qu?.attempt.data.tools as { ok: boolean }[] | undefined) ?? []
  if (qu && (cursor < qu.end || qu.attempt.status === null)) {
    nodes['core_api'] = { view: 'running', count: 0, ms: 0 }
  } else if (qu && tools.length) {
    nodes['core_api'] = {
      view: tools.every((t) => t.ok) ? 'ok' : 'degraded',
      count: tools.length,
      ms: 0,
    }
  } else if (ended || (qu && !tools.length)) {
    nodes['core_api'] = { view: 'skipped', count: 0, ms: 0 }
  }

  const taken = new Set<string>()
  let active: string | null = null
  if (seen.length) taken.add(edgeId('__start__', seen[0].attempt.node))
  for (let i = 1; i < seen.length; i++) {
    const id = edgeId(seen[i - 1].attempt.node, seen[i].attempt.node)
    taken.add(id)
    if (cursor < seen[i].end) active = id
  }
  if (qu && tools.length) taken.add(edgeId('query_understanding', 'core_api'))
  if (ended && run.response) taken.add(edgeId('finalize', '__end__'))
  return { nodes, taken, active, ended }
}
