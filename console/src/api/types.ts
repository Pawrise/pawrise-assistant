// Miroir des schémas Python (pawrise_assistant.api.events, graph.topology, domain.models).
// Toute évolution côté Python doit se refléter ici : le test `contract.test.ts` vérifie les
// exemples d'événements réels enregistrés depuis l'API.

export type NodeKind = 'terminal' | 'step' | 'exit' | 'output' | 'tool' | 'router'
/** Qui fait le travail : l'IA, une règle écrite, la recherche, un texte fixe, des données. */
export type Actor = 'ai' | 'mixed' | 'rule' | 'search' | 'text' | 'data'
export type EdgeKind = 'normal' | 'conditional' | 'error' | 'tool'

export interface TopologyNode {
  id: string
  label: string
  kind: NodeKind
  role: string
  on_error: string | null
  step: number | null
  actor: Actor | null
}

export interface TopologyEdge {
  source: string
  target: string
  kind: EdgeKind
  label: string | null
}

export interface Topology {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}

export type NodeStatus = 'ok' | 'redirected' | 'rejected' | 'degraded' | 'error'

export interface Escalation {
  trigger: boolean
  urgency: 'low' | 'medium' | 'high' | null
  reason: string | null
}

export interface AssistantResponse {
  schema_version: '1'
  response_text: string
  citations: { source_id: string; snippet: string; url: string | null }[]
  escalation: Escalation
  suggested_actions: { label: string; action_id: string }[]
  metadata: {
    thread_id: string
    turn_id: string
    path: string[]
    latency_ms: number
    prompt_version: string
    template_id: string | null
  }
}

export interface AlertContext {
  alert_id: string
  kind: string
  level: string
  summary: string
  persisted_days: number
  delta_pct: number | null
}

export interface Scenario {
  id: string
  label: string
  flow: string
  pet_ref: string
  user_message: string
  alert_context: AlertContext | null
  faults: string[]
  /** Le résultat attendu, en clair. */
  expect: string
  expect_template: string | null
  expect_vet: boolean
}

export interface Pet {
  pet_ref: string
  name: string
  breed: string
  age_years: number
}

export interface Info {
  ai: boolean
  models: string[]
  retriever: string
  pets: Pet[]
  embedder?: string | null
  reranker?: string
  knowledge_editable?: boolean
  pets_editable?: boolean
}

export interface RunRequest {
  user_message: string
  pet_ref: string
  alert_context: AlertContext | null
  faults: string[]
  history?: { role: 'owner' | 'assistant'; content: string }[]
}

export interface ReusedStep {
  node: string
  attempt: number
  status: NodeStatus
  summary: string
  data: Record<string, unknown>
}

export interface ForkRequest {
  node: string
  attempt: number
  overrides: Record<string, unknown> | null
  faults: string[]
}

export type DebugEvent =
  | {
      type: 'run_started'
      run_id: string
      ts_ms: number
      input: Partial<RunRequest> & { overrides?: Record<string, unknown> | null }
      fork_of: string | null
      from_node: string | null
      from_attempt: number | null
      reused: ReusedStep[]
    }
  | {
      type: 'node_started'
      node: string
      attempt: number
      ts_ms: number
      /** Phrase d'attente montrée au propriétaire à cette étape. */
      user_status?: string | null
    }
  | {
      type: 'node_finished'
      node: string
      attempt: number
      ts_ms: number
      duration_ms: number
      status: NodeStatus
      summary: string
      data: Record<string, unknown>
      recovered_to: string | null
    }
  | {
      type: 'run_finished'
      ts_ms: number
      response: AssistantResponse | null
      summary: HandoffSummary | null
    }
  | { type: 'run_error'; ts_ms: number; message: string }

export interface Sourced {
  text: string
  source: string
}

export interface HandoffSummary {
  schema_version: '1'
  pet: { name: string; breed: string; age_years: number; weight_kg: number } | null
  reason: string
  urgency: 'low' | 'medium' | 'high'
  timeline: (Sourced & { days_ago: number })[]
  owner_reported: Sourced[]
  observations: Sourced[]
  disclaimer: string
}

export interface HandoffRequest {
  thread_id: string
  pet_ref: string
  reason: string | null
  thread_extracts: { role: 'owner' | 'assistant'; content: string }[]
}

export type GraphName = 'turn' | 'handoff'
