import { describe, expect, it } from 'vitest'
import type { Topology } from '@/api/types'
import { gridLayout, route, type Box } from './layout'

const node = (id: string, kind: Topology['nodes'][number]['kind'] = 'step') => ({
  id, label: id, kind, role: '', on_error: null, step: null, actor: null,
})

const TURN: Topology = {
  nodes: [
    node('__start__', 'terminal'), node('redact'), node('circuit_breaker'), node('query_understanding'),
    node('gate', 'router'), node('retrieval'), node('generation'), node('safe_response', 'exit'),
    node('finalize', 'output'), node('core_api', 'tool'), node('nouveau'),
  ],
  edges: [],
}

describe('grille du parcours', () => {
  const g = gridLayout('turn', TURN)

  it('met les deux branches parallèles sur la même rangée', () => {
    expect(g.cells.circuit_breaker.row).toBe(g.cells.query_understanding.row)
    expect(g.cells.circuit_breaker.col).not.toBe(g.cells.query_understanding.col)
  })

  it('ne dessine ni début, ni fin, ni Core API, et range un nœud inconnu à la suite', () => {
    expect(Object.keys(g.cells)).not.toContain('__start__')
    expect(Object.keys(g.cells)).not.toContain('core_api')
    expect(g.cells.nouveau.row).toBeGreaterThan(g.cells.finalize.row)
  })
})

describe('tracé des arêtes', () => {
  const rails = { gutter: 300, right: 600 }
  const gate: Box = { x: 100, y: 100, w: 120, h: 30 }
  const exit: Box = { x: 340, y: 160, w: 200, h: 60 }

  it('rejoint un texte fixe par le rail entre les colonnes', () => {
    const p = route(gate, exit, { row: 2, col: 0 }, { row: 3, col: 1 }, rails)
    expect(p.d).toContain('300')
  })

  it('descend sur une branche parallèle par le haut', () => {
    const p = route(gate, exit, { row: 0, col: 0 }, { row: 1, col: 1 }, rails, true)
    expect(p.d.endsWith(`${exit.x + exit.w / 2} ${exit.y}`)).toBe(true)
  })

  it('fait passer le 2ᵉ essai par un rail à gauche, avec son libellé', () => {
    const verify: Box = { x: 100, y: 400, w: 200, h: 60 }
    const draft: Box = { x: 100, y: 300, w: 200, h: 60 }
    const p = route(verify, draft, { row: 6, col: 0 }, { row: 5, col: 0 }, rails)
    expect(p.label?.x).toBeLessThan(100)
  })
})
