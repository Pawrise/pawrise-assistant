import { describe, expect, it } from 'vitest'
import type { AuditEntry } from '@/api/admin'
import { matches, piiSummary, story, totals, vetReason } from './journal'

const base: AuditEntry = {
  ts: '2026-10-09T11:00:00+00:00',
  thread_id: 'debug-r',
  turn_id: 't1',
  pet_ref: 'pet_demo_rex',
  input: 'Rex dort beaucoup',
  faults: [],
  path: [],
  template_id: null,
  escalation: { trigger: false, urgency: null, reason: null },
  latency_ms: 6000,
  response_text: '…',
  outcome: 'answered',
  intent: 'clean',
  small_talk: false,
  rejections: [],
  pii: {},
  citations: [
    { source_id: 'sommeil-chien-adulte#1', snippet: '' },
    { source_id: 'telemetry', snippet: '' },
  ],
  ai_calls: 5,
  models: ['gpt-5.4-mini'],
  cost_eur: 0.0008,
  prompt_version: 'p-1',
}

describe('journal d’audit raconté', () => {
  it('dit sur quoi s’appuie une réponse vérifiée', () => {
    expect(story(base)).toBe('Réponse rédigée à partir de 1 passage de fiches et des données du collier, puis vérifiée.')
  })

  it('raconte les deux brouillons bloqués d’une réponse prudente', () => {
    const e: AuditEntry = {
      ...base,
      outcome: 'careful',
      faults: ['draft_diagnostic'],
      rejections: [
        { attempt: 1, why: 'ressemblait à un diagnostic', text: 'a' },
        { attempt: 2, why: 'aucune source ne le dit', text: 'b' },
      ],
    }
    expect(story(e)).toContain('bloqué les deux')
    expect(story(e)).toContain('Pannes simulées')
  })

  it('cite le signal d’urgence repéré', () => {
    const e: AuditEntry = {
      ...base,
      outcome: 'urgent',
      latency_ms: 1300,
      escalation: { trigger: true, urgency: 'high', reason: 'R-ESC-01 signal d’urgence (« mange du chocolat »)' },
    }
    expect(story(e)).toContain('« mange du chocolat »')
  })

  it('dit les données masquées et la raison du vétérinaire en clair', () => {
    expect(piiSummary({ phone: 1 })).toBe('1 téléphone masqué')
    expect(vetReason('R-ESC-03 baisse d’activité ≥ 30 % pendant ≥ 5 jours')).toContain('plus de 30 %')
  })

  it('compte et filtre', () => {
    const blocked = { ...base, rejections: [{ attempt: 1, why: 'x', text: 'y' }] }
    const t = totals([base, blocked, { ...base, outcome: 'urgent' as const }])
    expect([t.all, t.byOutcome.answered, t.blocked]).toEqual([3, 2, 1])
    expect(matches(blocked, 'blocked', '')).toBe(true)
    expect(matches(base, 'blocked', '')).toBe(false)
    expect(matches(base, 'all', 'dort')).toBe(true)
  })
})
