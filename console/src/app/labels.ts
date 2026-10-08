// Tout le vocabulaire affiché : des mots de produit, pas des noms de code.

import {
  CalendarClock,
  Database,
  EyeOff,
  FileText,
  Hand,
  LifeBuoy,
  ListChecks,
  ListFilter,
  PenLine,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Split,
  Stethoscope,
  type LucideIcon,
} from 'lucide-react'
import type { Actor, AssistantResponse } from '@/api/types'

export const NODE_ICON: Record<string, LucideIcon> = {
  redact: EyeOff,
  circuit_breaker: ListFilter,
  query_understanding: Sparkles,
  gate: Split,
  retrieval: Search,
  relevance_filter: ListChecks,
  generation: PenLine,
  guardrail: ShieldCheck,
  safe_response: Hand,
  safe_response_escalate: Stethoscope,
  safe_fallback: LifeBuoy,
  finalize: Send,
  collect: Database,
  timeline: CalendarClock,
  synthesize: FileText,
  verify: ShieldCheck,
}

export const ACTOR: Record<Actor, { label: string; chip: string; tile: string }> = {
  ai: { label: 'IA', chip: 'bg-violet-100 text-violet-800', tile: 'bg-violet-100 text-violet-700' },
  rule: { label: 'Règle', chip: 'bg-zinc-100 text-zinc-700', tile: 'bg-zinc-100 text-zinc-700' },
  search: { label: 'Recherche', chip: 'bg-sky-100 text-sky-800', tile: 'bg-sky-100 text-sky-700' },
  text: { label: 'Texte fixe', chip: 'bg-amber-100 text-amber-900', tile: 'bg-amber-100 text-amber-800' },
  data: { label: 'Données', chip: 'bg-teal-100 text-teal-800', tile: 'bg-teal-100 text-teal-700' },
}

export const FAULTS: Record<string, { label: string; effect: string }> = {
  classifier_down: { label: 'Le tri ne répond plus', effect: 'Réponse prudente, rien n’est rédigé.' },
  core_api_timeout: { label: 'Données du chien indisponibles', effect: 'Réponse sans les chiffres du collier.' },
  retriever_down: { label: 'Recherche en panne', effect: 'Réponse sans fiche santé.' },
  reranker_down: { label: 'Classement en panne', effect: 'On garde l’ordre de la recherche.' },
  llm_down: { label: 'L’IA ne répond plus', effect: 'Réponse prudente.' },
  draft_diagnostic: { label: 'Brouillon qui diagnostique', effect: 'Rejeté à la vérification.' },
  draft_ungrounded: { label: 'Brouillon sans source', effect: 'Rejeté à la vérification.' },
}

export const ON_ERROR: Record<string, string> = {
  'fail-closed': 'le message reçoit une réponse prudente',
  'fail-open': 'on continue sans elle',
}

export type Tone = 'ok' | 'fixed' | 'careful' | 'urgent'

/** Comment la réponse a été produite, en un mot. */
export function verdict(r: {
  escalation: AssistantResponse['escalation']
  metadata: { template_id: string | null }
}): { label: string; tone: Tone } {
  const t = r.metadata.template_id
  if (r.escalation.urgency === 'high') return { label: 'Urgence', tone: 'urgent' }
  if (t === 'SR-FALLBACK-02') return { label: 'Réponse prudente', tone: 'careful' }
  if (t) return { label: 'Texte fixe', tone: 'fixed' }
  return { label: 'Vérifiée', tone: 'ok' }
}

export const TONE: Record<Tone, string> = {
  ok: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  fixed: 'bg-amber-50 text-amber-900 ring-amber-600/20',
  careful: 'bg-orange-50 text-orange-900 ring-orange-600/20',
  urgent: 'bg-red-50 text-red-800 ring-red-600/20',
}

export function fmtEur(eur: number): string {
  const cents = eur * 100
  if (cents < 0.01) return '< 0,01 ct'
  return `${cents.toFixed(2).replace('.', ',')} ct`
}
