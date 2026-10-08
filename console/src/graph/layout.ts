// Disposition du graphe par ELK (algorithme « layered », de haut en bas).
// Calculée une seule fois à partir de GET /graph, puis figée : le graphe ne bouge pas pendant
// l'animation d'un tour.

import type { Topology, TopologyNode } from '@/api/types'

export const SIZE: Record<TopologyNode['kind'], { w: number; h: number }> = {
  terminal: { w: 96, h: 32 },
  step: { w: 248, h: 56 },
  exit: { w: 220, h: 52 },
  output: { w: 248, h: 52 },
  tool: { w: 176, h: 48 },
  router: { w: 168, h: 40 },
}

export type Positions = Record<string, { x: number; y: number }>

const MAIN = new Set([
  'redact',
  'gate',
  'circuit_breaker', 'query_understanding', 'retrieval', 'relevance_filter', 'generation',
  'guardrail', 'finalize',
])

/**
 * Ordre de parcours depuis START. ELK casse les cycles selon l'ordre des nœuds : en suivant le
 * flux, seule la vraie boucle (vérification → 2ᵉ rédaction) est traitée comme un retour en
 * arrière, quel que soit l'ordre de déclaration côté serveur.
 */
function flowOrder(topology: Topology): Topology {
  const next: Record<string, string[]> = {}
  for (const e of topology.edges) (next[e.source] ??= []).push(e.target)

  // 1. Les vraies boucles : une arête vers un nœud encore « ouvert » dans un parcours en profondeur.
  const back = new Set<string>()
  const state: Record<string, 'open' | 'done'> = {}
  const visit = (id: string) => {
    state[id] = 'open'
    for (const t of next[id] ?? []) {
      if (state[t] === 'open') back.add(`${id}->${t}`)
      else if (!state[t]) visit(t)
    }
    state[id] = 'done'
  }
  visit('__start__')

  // 2. Tri topologique sur le reste : un nœud vient après tous ceux qui y mènent.
  const indeg: Record<string, number> = {}
  for (const e of topology.edges) {
    if (!back.has(`${e.source}->${e.target}`)) indeg[e.target] = (indeg[e.target] ?? 0) + 1
  }
  const order: string[] = []
  const ready = ['__start__']
  while (ready.length) {
    const id = ready.shift()!
    order.push(id)
    for (const t of next[id] ?? []) {
      if (back.has(`${id}->${t}`)) continue
      indeg[t] -= 1
      if (indeg[t] === 0) ready.push(t)
    }
  }
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length)
  return {
    nodes: [...topology.nodes].sort((a, b) => rank(a.id) - rank(b.id)),
    edges: [...topology.edges].sort((a, b) => rank(a.source) - rank(b.source)),
  }
}

export async function layout(raw: Topology): Promise<Positions> {
  const topology = flowOrder(raw)
  // ELK pèse ~1,4 Mo : chargé à la demande, une fois.
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const elk = new ELK()
  const result = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '34',
      'elk.spacing.nodeNode': '64',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
    },
    children: topology.nodes.map((n) => ({
      id: n.id,
      width: SIZE[n.kind].w,
      height: SIZE[n.kind].h,
    })),
    edges: topology.edges
      .filter((e) => e.kind !== 'error')
      .map((e, i) => ({
        id: `e${i}`,
        sources: [e.source],
        targets: [e.target],
        layoutOptions: (MAIN.has(e.source) && MAIN.has(e.target)
          ? { 'elk.layered.priority.straightness': '10' }
          : {}) as Record<string, string>,
      })),
  })
  const out: Positions = {}
  for (const c of result.children ?? []) out[c.id] = { x: c.x ?? 0, y: c.y ?? 0 }
  return out
}
