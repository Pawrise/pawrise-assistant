// Les échanges de la session : chaque message envoyé (discussion ou banc de test) garde son flux
// d'événements complet, pour être revu à tout moment dans la vue Parcours.

import type { DebugEvent, GraphName } from '@/api/types'
import { emptyRun, reduce, type RunState } from '@/run/model'

export type Origin = 'chat' | 'test'

export interface Entry {
  id: string
  graph: GraphName
  origin: Origin
  message: string
  petRef: string
  scenarioId: string | null
  faults: string[]
  /** Relance d'un autre échange depuis une étape. */
  parent: { id: string; node: string } | null
  createdAt: number
  run: RunState
}

export type NewEntry = Omit<Entry, 'id' | 'createdAt' | 'run'>

export type StoreAction =
  | { type: 'add'; id: string; entry: NewEntry }
  | { type: 'event'; id: string; event: DebugEvent }
  | { type: 'failed'; id: string; message: string }
  | { type: 'clear'; origin: Origin }

export function storeReduce(entries: Entry[], a: StoreAction): Entry[] {
  switch (a.type) {
    case 'add':
      return [...entries, { ...a.entry, id: a.id, createdAt: Date.now(), run: emptyRun }]
    case 'event':
      return entries.map((e) => (e.id === a.id ? { ...e, run: reduce(e.run, a.event) } : e))
    case 'clear':
      return entries.filter((e) => e.origin !== a.origin)
    case 'failed':
      return entries.map((e) =>
        e.id === a.id ? { ...e, run: reduce(e.run, { type: 'run_error', ts_ms: 0, message: a.message }) } : e,
      )
  }
}

let counter = 0
export const newId = () => `e${Date.now().toString(36)}${(counter++).toString(36)}`

/** La phrase d'attente du moment, telle que le propriétaire la lit (flux SSE de prod). */
export function liveStatus(run: RunState): string {
  return run.attempts.findLast((a) => a.userStatus)?.userStatus ?? 'Je lis votre message…'
}

/** Une réponse est conforme au scénario si elle prend la bonne sortie et propose (ou non) un vétérinaire. */
export function conforms(
  run: RunState,
  expect: { expect_template: string | null; expect_vet: boolean },
): boolean | null {
  if (run.phase !== 'done' || !run.response) return run.phase === 'error' ? false : null
  const r = run.response
  return r.metadata.template_id === expect.expect_template && r.escalation.trigger === expect.expect_vet
}

/** Ce que l'IA a coûté sur cet échange. */
export function usage(entry: Entry): { cost: number; calls: number } {
  let cost = 0
  let calls = 0
  for (const a of entry.run.attempts) {
    const llm = a.data.llm as { cost_eur: number; models: string[] } | undefined
    if (llm) {
      cost += llm.cost_eur
      calls += 1
    }
  }
  return { cost, calls }
}
