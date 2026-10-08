// Routes /debug des vues Connaissances et Qualité (contrat : docs/conception.md §8).

import { parseSseChunk } from './client'
import type { AssistantResponse } from './types'

export type Origin = 'seed' | 'edited' | 'added'

export interface ChunkView {
  chunk_id: string
  section: string
  text: string
  enabled: boolean
  origin: Origin
}

export interface DocView {
  doc_id: string
  title: string
  origin: 'seed' | 'added'
  chunks: ChunkView[]
}

export interface Knowledge {
  retriever: string
  reranker: string
  embedder: string
  documents: DocView[]
}

export interface SearchResult {
  query: string
  retrieval: Record<string, unknown>
  relevance: Record<string, unknown>
}

export interface Day {
  days_ago: number
  activity_min: number
  sleep_h: number
  resting_hr: number
  night_hr_peak: number
}

export interface PetAlert {
  alert_id: string
  kind: string
  level: string
  days_ago: number
  summary: string
}

export interface PetControls {
  activity_drop_pct: number
  sleep_rise_pct: number
  alert: boolean
}

export interface PetView {
  pet_ref: string
  name: string
  breed: string
  age_years: number
  weight_kg: number
  declared_conditions: string[]
  series: Day[]
  alerts: PetAlert[]
  summary: {
    period_days: number
    activity_delta_pct: number
    sleep_delta_pct: number
    resting_hr_bpm: number
    night_hr_peak_bpm: number
  }
  controls: PetControls
  modified: boolean
}

export interface Rule {
  id: string
  title: string
  text: string
  technical?: string | null
}

export interface Rules {
  rules: Rule[]
  templates: { template_id: string; when?: string; text: string; escalation: AssistantResponse['escalation'] }[]
  prompts: { name: string; version: string; text: string }[]
  prompt_version: string
}

export interface Kpi {
  name: string
  value: number
  target: number
  higher_is_better: boolean
  passed: boolean
  failures: string[]
}

export interface EvalCase {
  type: 'eval_case'
  set: 'adversarial' | 'escalation' | 'qa_medical'
  id: string
  message: string
  intent: string | null
  template_id: string | null
  escalate: boolean
  urgency: string | null
  latency_ms: number
  response_text: string
  citations: string[]
}

export type EvalEvent =
  | { type: 'eval_started'; total: number; validated: boolean }
  | EvalCase
  | { type: 'eval_finished'; report: { passed: boolean; validated: boolean; cases: number; kpis: Kpi[] } }
  | { type: 'eval_error'; message: string }

export interface AuditEntry {
  ts: string
  thread_id: string
  turn_id: string
  pet_ref: string
  input: string
  faults: string[]
  path: string[]
  template_id: string | null
  escalation: AssistantResponse['escalation']
  latency_ms: number
  response_text: string
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) {
    const detail = await r.json().then((j: { detail?: unknown }) => j.detail).catch(() => r.statusText)
    throw new Error(typeof detail === 'string' ? detail : `HTTP ${r.status}`)
  }
  return (r.status === 204 ? undefined : await r.json()) as T
}

const chunkPath = (id: string) => `/debug/knowledge/chunks/${encodeURIComponent(id)}`

export const admin = {
  knowledge: () => call<Knowledge>('GET', '/debug/knowledge'),
  editChunk: (id: string, patch: Partial<Pick<ChunkView, 'text' | 'section' | 'enabled'>>) =>
    call<ChunkView>('PATCH', chunkPath(id), patch),
  deleteChunk: (id: string) => call<void>('DELETE', chunkPath(id)),
  addDocument: (title: string, sections: { section: string; text: string }[]) =>
    call<DocView>('POST', '/debug/knowledge/documents', { title, sections }),
  resetKnowledge: () => call<{ documents: DocView[] }>('POST', '/debug/knowledge/reset'),
  search: (query: string) => call<SearchResult>('POST', '/debug/knowledge/search', { query }),
  pets: () => call<PetView[]>('GET', '/debug/pets'),
  editPet: (ref: string, patch: Partial<PetControls>) => call<PetView>('PATCH', `/debug/pets/${ref}`, patch),
  resetPets: () => call<PetView[]>('POST', '/debug/pets/reset'),
  rules: () => call<Rules>('GET', '/debug/rules'),
  audit: (limit = 50) => call<AuditEntry[]>('GET', `/debug/audit?limit=${limit}`),
}

/** Lance les 48 cas ; chaque événement arrive dès qu'un cas est fini. */
export async function runEvals(onEvent: (e: EvalEvent) => void, signal?: AbortSignal): Promise<void> {
  const r = await fetch('/debug/evals', { method: 'POST', headers: { Accept: 'text/event-stream' }, signal })
  if (!r.ok || !r.body) throw new Error(`/debug/evals : HTTP ${r.status}`)
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const { events, rest } = parseSseChunk(buffer)
    buffer = rest
    for (const data of events) onEvent(JSON.parse(data) as EvalEvent)
  }
}
