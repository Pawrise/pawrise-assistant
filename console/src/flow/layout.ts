// Placement du graphe sur une grille fixe : une colonne pour le chemin principal, une colonne pour
// les étapes lancées en même temps et pour les textes fixes. Les nœuds et les arêtes viennent de
// l'API (graphe compilé) ; seul leur rangement est décidé ici, pour rester lisible à toute taille.

import type { GraphName, Topology, TopologyEdge } from '@/api/types'

export interface Cell {
  row: number
  col: 0 | 1
}

export interface Band {
  rows: [number, number]
  cols: [0 | 1, 0 | 1]
  label: string
  /** Des branches qui tournent en même temps, et non un simple regroupement. */
  parallel?: boolean
}

export interface GridLayout {
  cells: Record<string, Cell>
  rows: number
  cols: 1 | 2
  bands: Band[]
}

const SPECS: Record<GraphName, { cells: Record<string, Cell>; bands: Band[] }> = {
  turn: {
    cells: {
      redact: { row: 0, col: 0 },
      circuit_breaker: { row: 1, col: 0 },
      query_understanding: { row: 1, col: 1 },
      gate: { row: 2, col: 0 },
      retrieval: { row: 3, col: 0 },
      safe_response: { row: 3, col: 1 },
      relevance_filter: { row: 4, col: 0 },
      safe_response_escalate: { row: 4, col: 1 },
      generation: { row: 5, col: 0 },
      guardrail: { row: 6, col: 0 },
      safe_fallback: { row: 6, col: 1 },
      finalize: { row: 7, col: 0 },
    },
    bands: [
      { rows: [1, 1], cols: [0, 1], label: 'En même temps', parallel: true },
      { rows: [3, 6], cols: [1, 1], label: 'Textes fixes' },
    ],
  },
  handoff: {
    cells: {
      collect: { row: 0, col: 0 },
      timeline: { row: 1, col: 0 },
      synthesize: { row: 2, col: 0 },
      verify: { row: 3, col: 0 },
      finalize: { row: 4, col: 0 },
    },
    bands: [],
  },
}

/** Les nœuds dessinés : ni début, ni fin, ni Core API (montré dans l'étape qui l'appelle). */
export const drawn = (t: Topology) => t.nodes.filter((n) => n.kind !== 'terminal' && n.kind !== 'tool')

export function gridLayout(name: GraphName, t: Topology): GridLayout {
  const spec = SPECS[name]
  const cells: Record<string, Cell> = {}
  let next = Math.max(-1, ...Object.values(spec.cells).map((c) => c.row)) + 1
  for (const n of drawn(t)) {
    cells[n.id] = spec.cells[n.id] ?? { row: next++, col: 0 } // nœud inconnu : à la suite
  }
  const rows = Math.max(0, ...Object.values(cells).map((c) => c.row)) + 1
  const cols = Object.values(cells).some((c) => c.col === 1) ? 2 : 1
  return { cells, rows, cols, bands: spec.bands }
}

export function drawnEdges(t: Topology, cells: Record<string, Cell>): TopologyEdge[] {
  return t.edges.filter((e) => e.kind !== 'tool' && e.source in cells && e.target in cells)
}

// — Tracé des arêtes —

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Path {
  d: string
  /** Point d'appui d'un éventuel libellé (sur le rail de gauche). */
  label?: { x: number; y: number }
}

const cx = (b: Box) => b.x + b.w / 2
const cy = (b: Box) => b.y + b.h / 2

/** Un chemin orthogonal aux coins arrondis, à travers une liste de points. */
function rounded(points: [number, number][], r = 10): string {
  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1]
    const [x, y] = points[i]
    const [nx, ny] = points[i + 1]
    const inLen = Math.hypot(x - px, y - py)
    const outLen = Math.hypot(nx - x, ny - y)
    const k = Math.min(r, inLen / 2, outLen / 2)
    const ax = x - ((x - px) / inLen) * k
    const ay = y - ((y - py) / inLen) * k
    const bx = x + ((nx - x) / outLen) * k
    const by = y + ((ny - y) / outLen) * k
    d += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`
  }
  const [lx, ly] = points[points.length - 1]
  return `${d} L ${lx} ${ly}`
}

/**
 * Règles de tracé, toutes déduites de la grille :
 * - même colonne, rangée suivante : trait vertical ;
 * - même colonne, plus loin (raccourci) ou plus haut (2ᵉ essai) : rail à gauche du chemin ;
 * - vers la colonne de droite : rail entre les colonnes ;
 * - retour vers le chemin principal : courbe si c'est la rangée suivante, sinon rail à droite.
 */
export function route(
  a: Box,
  b: Box,
  ca: Cell,
  cb: Cell,
  /** Le rail entre les deux colonnes, et celui à droite de la grille. */
  rails: { gutter: number; right: number },
  /** La cible est une branche lancée en parallèle (rangée « En même temps »). */
  parallel = false,
): Path {
  if (ca.col === cb.col && cb.row === ca.row + 1) {
    return { d: `M ${cx(a)} ${a.y + a.h} L ${cx(b)} ${b.y}` }
  }
  if (ca.col === cb.col) {
    const up = cb.row < ca.row
    const rail = Math.min(a.x, b.x) - (up ? 26 : 13)
    const ya = cy(a) + (up ? 6 : -6)
    const yb = cy(b) + (up ? 6 : -6)
    return {
      d: rounded([
        [a.x, ya],
        [rail, ya],
        [rail, yb],
        [b.x, yb],
      ]),
      label: { x: rail, y: (ya + yb) / 2 },
    }
  }
  if (cb.col > ca.col) {
    if (parallel && cb.row === ca.row + 1) {
      // Départ en parallèle : on sort par la droite, puis on descend sur la branche voisine.
      const x0 = a.x + a.w
      return { d: `M ${x0} ${cy(a)} C ${cx(b)} ${cy(a)}, ${cx(b)} ${cy(a)}, ${cx(b)} ${b.y}` }
    }
    // Vers un texte fixe : on rejoint le rail entre les colonnes, sans couper aucune carte.
    if (Math.abs(cy(a) - cy(b)) < 1) return { d: `M ${a.x + a.w} ${cy(a)} L ${b.x} ${cy(b)}` }
    return {
      d: rounded([
        [a.x + a.w, cy(a)],
        [rails.gutter, cy(a)],
        [rails.gutter, cy(b)],
        [b.x, cy(b)],
      ]),
    }
  }
  if (cb.row === ca.row + 1) {
    // Retour sur le chemin principal : on entre par le haut, côté droit, pour laisser le flanc
    // droit aux départs vers les textes fixes.
    const x1 = b.x + b.w * 0.8
    const y0 = a.y + a.h
    const mid = (y0 + b.y) / 2
    return { d: `M ${cx(a)} ${y0} C ${cx(a)} ${mid + 8}, ${x1} ${mid - 8}, ${x1} ${b.y}` }
  }
  const rail = rails.right + 14
  return {
    d: rounded([
      [a.x + a.w, cy(a)],
      [rail, cy(a)],
      [rail, cy(b)],
      [b.x + b.w, cy(b)],
    ]),
  }
}

/** Les libellés gardés : seulement là où le trait ne suffit pas à comprendre. */
export const RAIL_LABELS: Record<string, string> = {
  'gate->generation': 'rien à chercher',
  'guardrail->generation': '2ᵉ essai',
}
