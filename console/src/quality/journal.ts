// Le journal d'audit raconté : l'issue de chaque réponse, une phrase qui dit ce qui s'est passé,
// et les chiffres de l'ensemble. Tout est pur, pour être testé.

import type { AuditEntry } from '@/api/admin'
import { fmtMs } from '@/run/status'

export type Outcome = AuditEntry['outcome']

export const OUTCOME: Record<Outcome, { label: string; tag: string; ico: string; glyph: string }> = {
  answered: { label: 'Réponse vérifiée', tag: 'bg-emerald-50 text-emerald-800', ico: 'bg-emerald-100 text-emerald-700', glyph: '✓' },
  urgent: { label: 'Urgence', tag: 'bg-red-50 text-red-800', ico: 'bg-red-100 text-red-700', glyph: '!' },
  diagnosis: { label: 'Refus · diagnostic', tag: 'bg-amber-50 text-amber-900', ico: 'bg-amber-100 text-amber-800', glyph: '✕' },
  refusal: { label: 'Refus · détournement', tag: 'bg-zinc-100 text-zinc-700', ico: 'bg-zinc-100 text-zinc-600', glyph: '⊘' },
  careful: { label: 'Réponse prudente', tag: 'bg-orange-50 text-orange-900', ico: 'bg-orange-100 text-orange-700', glyph: '?' },
}

/** Le libellé d'un refus dépend de ce qui a été refusé. */
export function outcomeLabel(e: AuditEntry): string {
  if (e.outcome !== 'refusal') return OUTCOME[e.outcome].label
  if (e.intent === 'abuse') return 'Refus · insulte'
  if (e.intent === 'out_of_scope') return 'Refus · hors sujet'
  return 'Refus · détournement'
}

const PII: Record<string, string> = {
  email: 'e-mail',
  phone: 'téléphone',
  iban: 'IBAN',
  nir: 'n° de sécurité sociale',
  postcode: 'code postal',
}

export function piiLabel(kind: string): string {
  return PII[kind] ?? kind
}

/** « 1 téléphone masqué », « 2 données masquées ». */
export function piiSummary(pii: Record<string, number>): string | null {
  const total = Object.values(pii).reduce((a, b) => a + b, 0)
  if (!total) return null
  const kinds = Object.keys(pii).filter((k) => pii[k])
  return kinds.length === 1 ? `${pii[kinds[0]]} ${piiLabel(kinds[0])} masqué` : `${total} données masquées`
}

/** La raison d'une escalade, dite simplement. */
export function vetReason(reason: string | null): string {
  if (!reason) return 'par prudence'
  const quoted = /« ([^»]+) »/.exec(reason)?.[1]
  if (reason.startsWith('R-ESC-01')) return quoted ? `signal d’urgence (« ${quoted} »)` : 'signal d’urgence'
  if (reason.includes('alerte active')) return 'une alerte du collier est active'
  if (reason.startsWith('R-ESC-03')) return 'l’activité baisse de plus de 30 % depuis plus de 5 jours'
  if (reason.includes('diagnostic')) return 'un diagnostic ou un médicament était demandé'
  if (reason.includes('non validée')) return 'la réponse n’a pas pu être validée'
  return reason
}

/** Combien de passages de fiche, et si le collier a été cité. */
function grounding(e: AuditEntry): { passages: number; collar: boolean } {
  const ids = e.citations.map((c) => c.source_id)
  return { passages: ids.filter((i) => i !== 'telemetry' && i !== 'message').length, collar: ids.includes('telemetry') }
}

/** Ce qui s'est passé, en une ou deux phrases, sans jargon. */
export function story(e: AuditEntry): string {
  const parts: string[] = []
  const pii = piiSummary(e.pii)
  if (pii) parts.push(`${pii.charAt(0).toUpperCase() + pii.slice(1)} avant tout appel à l’IA.`)
  const blocked = e.rejections.length
  const drafts = new Set(e.rejections.map((r) => r.attempt)).size

  switch (e.outcome) {
    case 'urgent': {
      const q = /« ([^»]+) »/.exec(e.escalation.reason ?? '')?.[1]
      parts.push(`Un signal d’urgence a été repéré${q ? ` (« ${q} »)` : ''} : consigne d’urgence envoyée en ${fmtMs(e.latency_ms)}, sans que l’IA ne rédige rien.`)
      break
    }
    case 'diagnosis':
      parts.push('Le propriétaire demandait un diagnostic ou un médicament : refus et vétérinaire proposé. L’IA qui rédige n’a jamais vu la question.')
      break
    case 'refusal':
      parts.push(
        e.intent === 'abuse'
          ? 'Message insultant : l’assistant recadre poliment.'
          : e.intent === 'out_of_scope'
            ? 'Question hors sujet : l’assistant rappelle ce qu’il peut faire.'
            : 'Une tentative de détournement a été repérée : refus poli, l’assistant ne change pas de rôle.',
      )
      break
    case 'careful':
      parts.push(
        drafts >= 2
          ? 'L’IA a rédigé deux brouillons ; la vérification a bloqué les deux. Réponse prudente envoyée, avec un vétérinaire.'
          : 'Une étape est tombée en panne : réponse prudente envoyée, avec un vétérinaire.',
      )
      break
    case 'answered': {
      if (e.small_talk) {
        parts.push('Simple échange de politesse : réponse courte, sans recherche.')
        break
      }
      const g = grounding(e)
      const from = [
        g.passages ? `${g.passages} passage${g.passages > 1 ? 's' : ''} de fiches` : null,
        g.collar ? 'des données du collier' : null,
      ].filter(Boolean)
      parts.push(`Réponse rédigée à partir ${from.length ? `de ${from.join(' et ')}` : 'du message'}, puis vérifiée.`)
      if (blocked) {
        parts.push(`La vérification a bloqué ${blocked} phrase${blocked > 1 ? 's' : ''} au premier essai ; le deuxième brouillon a été validé.`)
      }
      if (e.escalation.trigger) parts.push(`Vétérinaire proposé : ${vetReason(e.escalation.reason)}.`)
      break
    }
  }
  if (e.faults.length) parts.push('Pannes simulées pour le test.')
  return parts.join(' ')
}

export interface Totals {
  all: number
  byOutcome: Record<Outcome, number>
  blocked: number
  vet: number
  pii: number
  medianMs: number
  costEur: number
}

export function totals(entries: AuditEntry[]): Totals {
  const byOutcome: Record<Outcome, number> = { answered: 0, urgent: 0, diagnosis: 0, refusal: 0, careful: 0 }
  for (const e of entries) byOutcome[e.outcome] += 1
  const times = entries.map((e) => e.latency_ms).sort((a, b) => a - b)
  const mid = Math.floor(times.length / 2)
  const medianMs = !times.length ? 0 : times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2
  return {
    all: entries.length,
    byOutcome,
    blocked: entries.reduce((n, e) => n + e.rejections.length, 0),
    vet: entries.filter((e) => e.escalation.trigger).length,
    pii: entries.filter((e) => piiSummary(e.pii)).length,
    medianMs,
    costEur: entries.reduce((n, e) => n + e.cost_eur, 0),
  }
}

export type Filter = 'all' | 'answered' | 'urgent' | 'refused' | 'careful' | 'blocked'

export function matches(e: AuditEntry, f: Filter, query: string): boolean {
  const okFilter =
    f === 'all' ||
    (f === 'refused' ? e.outcome === 'diagnosis' || e.outcome === 'refusal' : f === 'blocked' ? e.rejections.length > 0 : e.outcome === f)
  const q = query.trim().toLowerCase()
  return okFilter && (!q || `${e.input} ${e.response_text}`.toLowerCase().includes(q))
}

/** « Aujourd’hui », « Hier », ou la date ; « Plus ancien » sans horodatage. */
export function dayLabel(ts: string | null, now = new Date()): string {
  if (!ts) return 'Plus ancien'
  const d = new Date(ts)
  const day = (x: Date) => x.toISOString().slice(0, 10)
  if (day(d) === day(now)) return 'Aujourd’hui'
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (day(d) === day(y)) return 'Hier'
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

export const time = (ts: string | null, seconds = false) =>
  ts
    ? new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) })
    : '—'
