// Modèle d'un tour, construit à partir des événements du flux de debug.
// Tout est pur : la console calcule l'état du graphe à n'importe quel instant de la chronologie,
// ce qui permet de rejouer le tour en déplaçant le curseur.

import type { AssistantResponse, DebugEvent, HandoffSummary, NodeStatus } from '@/api/types'

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
  /** Le message du propriétaire, pour un tour de chat. */
  message: string | null
  forkOf: { runId: string; node: string; attempt: number } | null
  attempts: Attempt[]
  response: AssistantResponse | null
  summary: HandoffSummary | null
  error: string | null
}

export const emptyRun: RunState = {
  phase: 'idle',
  runId: null,
  message: null,
  forkOf: null,
  attempts: [],
  response: null,
  summary: null,
  error: null,
}

export type RunAction = DebugEvent | { type: 'reset' }

export function reduce(state: RunState, e: RunAction): RunState {
  switch (e.type) {
    case 'reset':
      return emptyRun
    case 'run_started':
      return {
        ...emptyRun,
        phase: 'running',
        runId: e.run_id,
        message: e.input.user_message ?? null,
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
      return { ...state, phase: 'done', response: e.response, summary: e.summary }
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
  /** 0, ou 1 pour la seconde de deux branches qui tournent en même temps. */
  lane: number
}

/**
 * Les passages sont placés bout à bout, sauf deux branches lancées en même temps côté serveur :
 * elles partagent le même départ, sur deux lignes. En pas à pas, chaque passage dure au moins
 * MIN_SLOT_MS à l'écran ; sinon, sa vraie durée (1 ms minimum pour rester visible).
 */
export function slots(run: RunState, stepByStep: boolean): Slot[] {
  let cursor = 0
  const out: Slot[] = []
  for (const a of run.attempts) {
    const real = a.durationMs ?? MIN_SLOT_MS
    const dur = stepByStep ? Math.max(real, MIN_SLOT_MS) : Math.max(real, 1)
    const prev = out.at(-1)
    const parallel =
      prev !== undefined &&
      prev.lane === 0 &&
      !a.reused &&
      !prev.attempt.reused &&
      prev.attempt.endTs !== null &&
      a.startTs < prev.attempt.endTs
    const start = parallel ? prev.start : cursor
    const slot = { attempt: a, start, end: start + dur, lane: parallel ? 1 : 0 }
    cursor = Math.max(cursor, slot.end)
    out.push(slot)
  }
  return out
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

/** Les nœuds qui appellent le Core API, dans chacun des deux graphes. */
const TOOL_CALLERS = new Set(['query_understanding', 'collect'])

export const edgeId = (source: string, target: string) => `${source}->${target}`

/** Ce que la console sait du graphe pour déduire les arêtes empruntées. */
export interface GraphShape {
  /** Prédécesseurs de chaque nœud dans la topologie. */
  preds: Record<string, string[]>
  /** Nœuds de jonction : ils attendent tous leurs prédécesseurs. */
  joins: Set<string>
}

export function shapeOf(edges: { source: string; target: string; kind: string }[]): GraphShape {
  const preds: Record<string, string[]> = {}
  const incoming: Record<string, number> = {}
  for (const e of edges) {
    if (e.kind === 'tool') continue
    ;(preds[e.target] ??= []).push(e.source)
    if (e.kind === 'normal') incoming[e.target] = (incoming[e.target] ?? 0) + 1
  }
  const joins = new Set(Object.keys(incoming).filter((n) => incoming[n] > 1 && n !== 'finalize'))
  return { preds, joins }
}

export function snapshot(
  run: RunState,
  s: Slot[],
  cursor: number,
  nodeIds: string[],
  shape?: GraphShape,
): Snapshot {
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
  if (ended && (run.response || run.summary)) nodes['__end__'] = { view: 'ok', count: 1, ms: 0 }

  // Le Core API n'est pas un nœud du graphe : son état vient des outils appelés par le nœud 2.
  const qu = seen.filter((x) => TOOL_CALLERS.has(x.attempt.node)).at(-1)
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
    const target = seen[i].attempt.node
    const running = cursor < seen[i].end
    if (!shape) {
      const id = edgeId(seen[i - 1].attempt.node, target)
      taken.add(id)
      if (running) active = id
      continue
    }
    // On remonte le temps jusqu'au passage précédent de ce même nœud : une jonction prend
    // toutes ses branches, un nœud ordinaire le prédécesseur le plus récent.
    const preds = new Set(shape.preds[target] ?? [])
    const sources: string[] = []
    for (let j = i - 1; j >= 0; j--) {
      const n = seen[j].attempt.node
      if (n === target) break
      if (preds.has(n) && !sources.includes(n)) {
        sources.push(n)
        if (!shape.joins.has(target)) break
      }
    }
    for (const src of sources) {
      taken.add(edgeId(src, target))
      if (running) active = edgeId(src, target)
    }
  }
  if (qu && tools.length) taken.add(edgeId(qu.attempt.node, 'core_api'))
  if (ended && (run.response || run.summary)) taken.add(edgeId('finalize', '__end__'))
  return { nodes, taken, active, ended }
}
