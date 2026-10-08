import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GraphName, Topology, TopologyNode } from '@/api/types'
import { cn } from '@/lib/utils'
import type { Attempt, Snapshot } from '@/run/model'
import { NodeCard } from './NodeCard'
import { drawnEdges, gridLayout, RAIL_LABELS, route, type Box, type Path } from './layout'

/** Une précision courte sous le titre, tirée de ce que l'étape a produit. */
function extraOf(node: string, a: Attempt | undefined): string | null {
  if (!a?.status) return null
  const d = a.data
  if (node === 'query_understanding' || node === 'collect') {
    const tools = (d.tools as { ok: boolean }[] | undefined) ?? []
    if (!tools.length) return null
    const ok = tools.filter((t) => t.ok).length
    return `${ok}/${tools.length} données du chien`
  }
  if (node === 'retrieval') return `${((d.candidates as unknown[]) ?? []).length} passages`
  if (node === 'relevance_filter') return `${((d.kept as unknown[]) ?? []).length} gardés`
  return null
}

type Measured = {
  boxes: Record<string, Box>
  rails: { gutter: number; right: number }
  width: number
  height: number
}

export function FlowGraph({
  name,
  topology,
  snap,
  attempts,
  selected,
  onSelect,
}: {
  name: GraphName
  topology: Topology
  snap: Snapshot
  attempts: Attempt[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  const grid = useMemo(() => gridLayout(name, topology), [name, topology])
  const edges = useMemo(() => drawnEdges(topology, grid.cells), [topology, grid])
  const meta = useMemo(
    () => Object.fromEntries(topology.nodes.map((n) => [n.id, n])) as Record<string, TopologyNode>,
    [topology],
  )
  const box = useRef<HTMLDivElement>(null)
  const refs = useRef<Record<string, HTMLElement | null>>({})
  const [m, setM] = useState<Measured | null>(null)

  // Les arêtes suivent la position réelle des cartes : elles restent justes à toute largeur.
  useLayoutEffect(() => {
    const root = box.current
    if (!root) return
    const measure = () => {
      const o = root.getBoundingClientRect()
      const boxes: Record<string, Box> = {}
      let right = 0
      let mainRight = 0
      let sideLeft = Infinity
      for (const [id, el] of Object.entries(refs.current)) {
        if (!el) continue
        const r = el.getBoundingClientRect()
        const b = { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height }
        boxes[id] = b
        right = Math.max(right, b.x + b.w)
        if (grid.cells[id]?.col === 1) sideLeft = Math.min(sideLeft, b.x)
        else if (meta[id]?.kind !== 'router') mainRight = Math.max(mainRight, b.x + b.w)
      }
      const gutter = Number.isFinite(sideLeft) ? (mainRight + sideLeft) / 2 : mainRight + 16
      setM({ boxes, rails: { gutter, right }, width: o.width, height: o.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    for (const el of Object.values(refs.current)) if (el) ro.observe(el)
    return () => ro.disconnect()
  }, [grid, meta])

  const paths = useMemo(() => {
    if (!m) return []
    const out: { id: string; path: Path; taken: boolean; active: boolean; error: boolean }[] = []
    for (const e of edges) {
      const a = m.boxes[e.source]
      const b = m.boxes[e.target]
      if (!a || !b) continue
      const id = `${e.source}->${e.target}`
      const taken = snap.taken.has(id)
      if (e.kind === 'error' && !taken) continue // une arête d'erreur n'apparaît que si elle sert
      out.push({
        id,
        path: route(
          a,
          b,
          grid.cells[e.source],
          grid.cells[e.target],
          m.rails,
          grid.bands.some((band) => band.parallel && band.rows[0] === grid.cells[e.target].row),
        ),
        taken,
        active: snap.active === id,
        error: e.kind === 'error',
      })
    }
    // Les arêtes empruntées se dessinent par-dessus les autres.
    return out.sort((x, y) => Number(x.taken) - Number(y.taken))
  }, [m, edges, grid, snap.taken, snap.active])

  const lastAttempt = (id: string) => attempts.findLast((a) => a.node === id)
  const two = grid.cols === 2

  return (
    <div
      ref={box}
      className={cn(
        'relative mx-auto grid w-full gap-y-6 py-6 sm:gap-y-7',
        two
          ? 'max-w-[820px] grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-x-5 pr-5 pl-9 sm:gap-x-10 md:pr-8 md:pl-28'
          : 'max-w-[440px] grid-cols-1 px-6',
      )}
      style={{ gridTemplateRows: `repeat(${grid.rows}, auto)` }}
    >
      {grid.bands.map((b) => (
        <div
          key={b.label}
          aria-hidden
          className="pointer-events-none relative -m-2.5 rounded-2xl border border-zinc-200/80 bg-zinc-100/70 sm:-m-3.5"
          style={{
            gridRow: `${b.rows[0] + 1} / ${b.rows[1] + 2}`,
            gridColumn: `${b.cols[0] + 1} / ${b.cols[1] + 2}`,
          }}
        >
          <span
            className={cn(
              'absolute -mt-2 bg-zinc-50 px-1.5 text-[10px] font-semibold tracking-wide whitespace-nowrap text-zinc-500 uppercase',
              // Au milieu, entre les deux flèches qui descendent sur chaque branche.
              b.parallel ? 'left-1/2 -translate-x-1/2' : 'left-3',
            )}
          >
            {b.label}
          </span>
        </div>
      ))}

      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-visible"
        width={m?.width ?? 0}
        height={m?.height ?? 0}
      >
        <defs>
          {(['idle', 'taken', 'active', 'error'] as const).map((k) => (
            <marker
              key={k}
              id={`arrow-${k}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 1 L 9 5 L 0 9 z"
                className={
                  k === 'taken'
                    ? 'fill-zinc-800'
                    : k === 'active'
                      ? 'fill-violet-600'
                      : k === 'error'
                        ? 'fill-red-600'
                        : 'fill-zinc-300'
                }
              />
            </marker>
          ))}
        </defs>
        {paths.map(({ id, path, taken, active, error }) => {
          const k = active ? 'active' : error ? 'error' : taken ? 'taken' : 'idle'
          return (
            <path
              key={id}
              d={path.d}
              fill="none"
              markerEnd={`url(#arrow-${k})`}
              strokeLinecap="round"
              className={cn(
                'transition-[stroke,opacity] duration-300',
                k === 'active' && 'flow-dash stroke-violet-600 [stroke-width:2]',
                k === 'error' && 'stroke-red-600 [stroke-dasharray:4_3] [stroke-width:1.75]',
                k === 'taken' && 'stroke-zinc-800 [stroke-width:1.75]',
                k === 'idle' && cn('stroke-zinc-300 [stroke-width:1.25]', snap.ended && 'opacity-50'),
              )}
            />
          )
        })}
      </svg>

      {paths
        .filter((p) => p.path.label && RAIL_LABELS[p.id])
        .map(({ id, path, taken }) => (
          <span
            key={id}
            className={cn(
              'pointer-events-none absolute hidden -translate-x-full -translate-y-1/2 pr-2 text-right text-[11px] leading-tight md:block',
              taken ? 'font-medium text-zinc-800' : 'text-zinc-400',
            )}
            style={{ left: path.label!.x, top: path.label!.y }}
          >
            {RAIL_LABELS[id]}
          </span>
        ))}

      {Object.entries(grid.cells).map(([id, cell]) => (
        <div
          key={id}
          className="relative z-10 flex min-w-0 items-center"
          style={{ gridRow: cell.row + 1, gridColumn: cell.col + 1 }}
        >
          <NodeCard
            ref={(el) => {
              refs.current[id] = el
            }}
            meta={meta[id]}
            snap={snap.nodes[id] ?? { view: 'pending', count: 0, ms: 0 }}
            selected={selected === id}
            onSelect={() => onSelect(id)}
            extra={extraOf(id, lastAttempt(id))}
          />
        </div>
      ))}
    </div>
  )
}
