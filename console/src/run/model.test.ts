import { describe, expect, it } from 'vitest'
import { parseSseChunk } from '@/api/client'
import type { DebugEvent } from '@/api/types'
import { emptyRun, reduce, slots, snapshot, totalOf, MIN_SLOT_MS } from './model'

const NODES = [
  'circuit_breaker', 'query_understanding', 'retrieval', 'relevance_filter', 'generation',
  'guardrail', 'safe_response', 'safe_response_escalate', 'safe_fallback', 'finalize',
]

function done(node: string, attempt: number, ts: number, status = 'ok', data = {}): DebugEvent {
  return {
    type: 'node_finished', node, attempt, ts_ms: ts, duration_ms: 2, status: status as never,
    summary: '', data, recovered_to: null,
  }
}
const start = (node: string, attempt: number, ts: number): DebugEvent => ({
  type: 'node_started', node, attempt, ts_ms: ts,
})

// Le parcours F : rejet, 2ᵉ essai, rejet, repli.
const F: DebugEvent[] = [
  { type: 'run_started', run_id: 'r', ts_ms: 0, input: {}, fork_of: null, from_node: null, from_attempt: null, reused: [] },
  start('circuit_breaker', 1, 0), done('circuit_breaker', 1, 2),
  start('query_understanding', 1, 2), done('query_understanding', 1, 4, 'ok', { tools: [{ ok: true }] }),
  start('retrieval', 1, 4), done('retrieval', 1, 6),
  start('relevance_filter', 1, 6), done('relevance_filter', 1, 8),
  start('generation', 1, 8), done('generation', 1, 10),
  start('guardrail', 1, 10), done('guardrail', 1, 12, 'rejected'),
  start('generation', 2, 12), done('generation', 2, 14),
  start('guardrail', 2, 14), done('guardrail', 2, 16, 'rejected'),
  start('safe_fallback', 1, 16), done('safe_fallback', 1, 17),
  start('finalize', 1, 17), done('finalize', 1, 18),
  { type: 'run_finished', ts_ms: 19, response: { metadata: { path: [] } } as never, summary: null },
]

describe('modèle de tour', () => {
  const run = F.reduce(reduce, emptyRun)
  const s = slots(run, true)
  const total = totalOf(s)

  it('rejoue le parcours F jusqu’au bout', () => {
    expect(run.phase).toBe('done')
    expect(s).toHaveLength(10)
    expect(total).toBe(10 * MIN_SLOT_MS)
    const end = snapshot(run, s, total, NODES)
    expect(end.nodes.generation).toEqual({ view: 'ok', count: 2, ms: 4 })
    expect(end.nodes.guardrail.view).toBe('rejected')
    expect(end.nodes.safe_response.view).toBe('skipped')
    expect(end.nodes.core_api.view).toBe('ok')
    expect(end.taken.has('guardrail->generation')).toBe(true)
    expect(end.taken.has('guardrail->safe_fallback')).toBe(true)
    expect(end.taken.has('guardrail->finalize')).toBe(false)
    expect(end.taken.has('finalize->__end__')).toBe(true)
  })

  it('montre le nœud en cours au milieu du tour, sans encore rien marquer comme non appelé', () => {
    const mid = snapshot(run, s, 4.5 * MIN_SLOT_MS, NODES)
    expect(mid.nodes.generation.view).toBe('running')
    expect(mid.nodes.safe_fallback.view).toBe('pending')
    expect(mid.active).toBe('relevance_filter->generation')
    expect(mid.ended).toBe(false)
  })

  it('suit les vraies durées hors du mode pas à pas', () => {
    expect(totalOf(slots(run, false))).toBe(20)
  })
})

describe('fork', () => {
  it('reprend les passages du tour d’origine avant de recevoir les nouveaux', () => {
    const started: DebugEvent = {
      type: 'run_started', run_id: 'f', ts_ms: 0, input: {}, fork_of: 'r', from_node: 'generation',
      from_attempt: 1,
      reused: [
        { node: 'circuit_breaker', attempt: 1, status: 'ok', summary: '', data: {} },
        { node: 'query_understanding', attempt: 1, status: 'ok', summary: '', data: {} },
      ],
    }
    const run = [started, start('generation', 1, 0), done('generation', 1, 2)].reduce(reduce, emptyRun)
    expect(run.forkOf).toEqual({ runId: 'r', node: 'generation', attempt: 1 })
    expect(run.attempts.map((a) => [a.node, a.reused])).toEqual([
      ['circuit_breaker', true], ['query_understanding', true], ['generation', false],
    ])
    const s = slots(run, true)
    const snap = snapshot(run, s, totalOf(s), NODES)
    expect(snap.taken.has('query_understanding->generation')).toBe(true)
  })
})

describe('parseur SSE', () => {
  it('ne rend que les messages complets', () => {
    const { events, rest } = parseSseChunk('event: a\ndata: {"x":1}\n\ndata: {"y"')
    expect(events).toEqual(['{"x":1}'])
    expect(rest).toBe('data: {"y"')
  })
})
