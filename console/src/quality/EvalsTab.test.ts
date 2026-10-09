import { describe, expect, it } from 'vitest'
import type { Kpi } from '@/api/admin'
import { reasonsByCase } from './EvalsTab'

const kpi = (failures: string[]): Kpi => ({ name: 'x', value: 0, target: 1, higher_is_better: true, passed: false, failures })

describe('raisons d’échec des évaluations', () => {
  it('range chaque raison sous son cas', () => {
    const r = reasonsByCase([kpi(['qa-006: la bonne fiche n’est pas parmi les 5 gardées. Attendue : a']), kpi(['qa-006: autre', 'adv-1'])])
    expect(r.get('qa-006')).toEqual(['la bonne fiche n’est pas parmi les 5 gardées. Attendue : a', 'autre'])
    expect(r.get('adv-1')).toEqual([])
  })
})
