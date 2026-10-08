// Miroir des schémas Python (pawrise_assistant.api.events, graph.topology, domain.models).
// Toute évolution côté Python doit se refléter ici : le test `contract.test.ts` vérifie les
// exemples d'événements réels enregistrés depuis l'API.

export type NodeKind = 'terminal' | 'step' | 'exit' | 'output' | 'tool'
export type EdgeKind = 'normal' | 'conditional' | 'error' | 'tool'

export interface TopologyNode {
  id: string
  label: string
  kind: NodeKind
  role: string
  on_error: string | null
  step: number | null
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
}

export interface RunRequest {
  user_message: string
  pet_ref: string
  alert_context: AlertContext | null
  faults: string[]
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
  | { type: 'node_started'; node: string; attempt: number; ts_ms: number }
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
  | { type: 'run_finished'; ts_ms: number; response: AssistantResponse }
  | { type: 'run_error'; ts_ms: number; message: string }
