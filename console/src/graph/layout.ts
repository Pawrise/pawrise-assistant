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
}

export type Positions = Record<string, { x: number; y: number }>

const MAIN = new Set([
  'circuit_breaker', 'query_understanding', 'retrieval', 'relevance_filter', 'generation',
  'guardrail', 'finalize',
])

export async function layout(topology: Topology): Promise<Positions> {
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
