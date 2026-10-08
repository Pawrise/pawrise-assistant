import { describe, expect, it } from 'vitest'
import type { DebugEvent } from '@/api/types'
import { emptyRun, reduce, shapeOf, slots, snapshot, totalOf } from './model'

const EDGES = [
  { source: '__start__', target: 'redact', kind: 'normal' },
  { source: 'redact', target: 'circuit_breaker', kind: 'normal' },
  { source: 'redact', target: 'query_understanding', kind: 'normal' },
  { source: 'circuit_breaker', target: 'gate', kind: 'normal' },
  { source: 'query_understanding', target: 'gate', kind: 'normal' },
  { source: 'gate', target: 'retrieval', kind: 'conditional' },
  { source: 'gate', target: 'safe_response', kind: 'conditional' },
]
const NODES = ['redact', 'circuit_breaker', 'query_understanding', 'gate', 'retrieval', 'safe_response']

const ev = (type: 'node_started' | 'node_finished', node: string, ts: number): DebugEvent =>
  type === 'node_started'
    ? { type, node, attempt: 1, ts_ms: ts }
    : { type, node, attempt: 1, ts_ms: ts, duration_ms: 1, status: 'ok', summary: '', data: {}, recovered_to: null }

// Tri et reformulation démarrent tous deux avant que l'un ne finisse.
const RUN: DebugEvent[] = [
  { type: 'run_started', run_id: 'r', ts_ms: 0, input: {}, fork_of: null, from_node: null, from_attempt: null, reused: [] },
  ev('node_started', 'redact', 0), ev('node_finished', 'redact', 1),
  ev('node_started', 'circuit_breaker', 2), ev('node_started', 'query_understanding', 2),
  ev('node_finished', 'circuit_breaker', 900), ev('node_finished', 'query_understanding', 1400),
  ev('node_started', 'gate', 1401), ev('node_finished', 'gate', 1402),
  ev('node_started', 'retrieval', 1403), ev('node_finished', 'retrieval', 1405),
]

describe('branches parallèles', () => {
  const run = RUN.reduce(reduce, emptyRun)
  const s = slots(run, true)

  it('place les deux branches au même départ, sur deux lignes', () => {
    const cb = s.find((x) => x.attempt.node === 'circuit_breaker')!
    const qu = s.find((x) => x.attempt.node === 'query_understanding')!
    expect(qu.start).toBe(cb.start)
    expect([cb.lane, qu.lane]).toEqual([0, 1])
  })

  it('trace les arêtes réelles, jonction comprise, et rien de plus', () => {
    const snap = snapshot(run, s, totalOf(s), NODES, shapeOf(EDGES))
    for (const id of ['redact->circuit_breaker', 'redact->query_understanding',
      'circuit_breaker->gate', 'query_understanding->gate', 'gate->retrieval']) {
      expect(snap.taken.has(id), id).toBe(true)
    }
    expect(snap.taken.has('circuit_breaker->query_understanding')).toBe(false)
    expect(snap.taken.has('gate->safe_response')).toBe(false)
  })
})
