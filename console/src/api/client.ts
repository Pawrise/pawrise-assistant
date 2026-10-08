import type {
  DebugEvent,
  ForkRequest,
  GraphName,
  HandoffRequest,
  RunRequest,
  Scenario,
  Topology,
} from './types'

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${path} : HTTP ${r.status}`)
  return (await r.json()) as T
}

export const fetchTopology = (name: GraphName = 'turn') =>
  getJson<Topology>(`/graph?name=${name}`)
export const fetchScenarios = () => getJson<Scenario[]>('/debug/scenarios')
export const fetchFaults = () => getJson<string[]>('/debug/faults')

/** Découpe un flux SSE en messages `data:` complets. Exporté pour les tests. */
export function parseSseChunk(buffer: string): { events: string[]; rest: string } {
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n')
  const rest = blocks.pop() ?? ''
  const events = blocks
    .map((b) =>
      b
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n'),
    )
    .filter(Boolean)
  return { events, rest }
}

/** Lance un tour en mode debug et appelle `onEvent` pour chaque événement reçu. */
export function runDebug(req: RunRequest, onEvent: (e: DebugEvent) => void, signal?: AbortSignal) {
  return stream('/debug/runs', req, onEvent, signal)
}

/** Prépare le dossier pré-consultation en mode debug. */
export function runHandoff(
  req: HandoffRequest,
  onEvent: (e: DebugEvent) => void,
  signal?: AbortSignal,
) {
  return stream('/debug/handoff-runs', req, onEvent, signal)
}

/** Rejoue un tour depuis un nœud : réexécuté, ou avec une sortie forcée. */
export function forkRun(
  runId: string,
  req: ForkRequest,
  onEvent: (e: DebugEvent) => void,
  signal?: AbortSignal,
) {
  return stream(`/debug/runs/${runId}/fork`, req, onEvent, signal)
}

async function stream(
  path: string,
  body: unknown,
  onEvent: (e: DebugEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })
  if (!r.ok || !r.body) {
    const detail = await r.text().catch(() => '')
    throw new Error(`${path} : HTTP ${r.status} ${detail}`)
  }
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const { events, rest } = parseSseChunk(buffer)
    buffer = rest
    for (const data of events) onEvent(JSON.parse(data) as DebugEvent)
  }
}
