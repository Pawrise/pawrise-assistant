import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useMemo, useRef } from 'react'
import type { Topology, TopologyNode } from '@/api/types'
import { cn } from '@/lib/utils'
import { edgeId, type NodeSnapshot, type Snapshot } from '@/run/model'
import { VIEW, fmtMs } from '@/run/status'
import { SIZE, type Positions } from './layout'

type StepData = { meta: TopologyNode; snap: NodeSnapshot; selected: boolean }

const hidden = '!size-1 !min-w-0 !border-0 !bg-transparent'

function Handles() {
  return (
    <>
      <Handle id="top" type="target" position={Position.Top} className={hidden} />
      <Handle id="right-in" type="target" position={Position.Right} className={hidden} style={{ top: '30%' }} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={hidden} />
      <Handle id="right-out" type="source" position={Position.Right} className={hidden} style={{ top: '70%' }} />
    </>
  )
}

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const { meta, snap, selected } = data
  const v = VIEW[snap.view]
  const size = SIZE[meta.kind]
  if (meta.kind === 'router') {
    const lit = snap.view !== 'pending' && snap.view !== 'skipped'
    return (
      <div
        style={{ width: size.w, height: size.h }}
        title={meta.role}
        className={cn(
          'flex cursor-pointer items-center justify-center gap-1.5 rounded-full border text-[12px] font-medium transition-colors',
          snap.view === 'running' ? 'border-violet-500 bg-violet-50 animate-pulse'
            : lit ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-dashed border-zinc-300 bg-white text-zinc-500',
          selected && 'outline-2 outline-offset-2 outline-zinc-900',
        )}
      >
        <Handles />
        <span aria-hidden>◇</span> {meta.label}
      </div>
    )
  }
  if (meta.kind === 'terminal') {
    const lit = snap.view === 'ok'
    return (
      <div
        style={{ width: size.w, height: size.h }}
        className={cn(
          'flex items-center justify-center rounded-full font-mono text-[11px] transition-colors',
          lit ? 'bg-zinc-900 text-white' : 'bg-zinc-200 text-zinc-500',
        )}
      >
        <Handles />
        {meta.id === '__start__' ? 'START' : 'END'}
      </div>
    )
  }
  const detail =
    snap.view === 'pending' || snap.view === 'running' || snap.view === 'skipped'
      ? v.word
      : `${v.glyph} ${snap.ms >= 1 ? fmtMs(snap.ms) : v.word}`
  return (
    <div
      style={{ width: size.w, height: size.h }}
      className={cn(
        'flex cursor-pointer flex-col justify-center gap-0.5 rounded-xl border px-3 text-left shadow-xs transition-colors',
        meta.kind === 'tool' && snap.view === 'pending' && 'border-dashed border-sky-300',
        v.box,
        selected && 'outline-2 outline-offset-2 outline-zinc-900',
      )}
    >
      <Handles />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-semibold text-zinc-900">
          {meta.step ? `${meta.step} · ` : ''}
          {meta.label}
        </span>
        <span className={cn('shrink-0 rounded-full px-1.5 text-[11px] font-medium', v.badge)}>
          {detail}
          {snap.count > 1 && meta.kind !== 'tool' ? ` ×${snap.count}` : ''}
        </span>
      </div>
      <span className="truncate font-mono text-[11px] text-zinc-500">{meta.id}</span>
    </div>
  )
}

const nodeTypes = { step: StepNode }

/** Recadre le graphe quand la place disponible change (chargement, redimensionnement). */
function AutoFit({ watch }: { watch: unknown }) {
  const { fitView } = useReactFlow()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current?.closest('.react-flow')
    if (!el) return
    const ro = new ResizeObserver(() => fitView({ padding: 0.08, duration: 0 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitView, watch])
  return <div ref={box} />
}

function Canvas({
  topology,
  positions,
  snap,
  selected,
  onSelect,
}: {
  topology: Topology
  positions: Positions
  snap: Snapshot
  selected: string | null
  onSelect: (id: string) => void
}) {
  const nodes = useMemo<Node<StepData>[]>(
    () =>
      topology.nodes.map((meta) => {
        const { w, h } = SIZE[meta.kind]
        return {
          id: meta.id,
          type: 'step',
          position: positions[meta.id] ?? { x: 0, y: 0 },
          // Dimensions fixes : sans elles, React Flow re-mesure (et masque) les nœuds à chaque image.
          width: w,
          height: h,
          measured: { width: w, height: h },
          data: {
            meta,
            snap: snap.nodes[meta.id] ?? { view: 'pending', count: 0, ms: 0 },
            selected: selected === meta.id,
          },
          draggable: false,
          connectable: false,
        }
      }),
    [topology, positions, snap, selected],
  )

  const edges = useMemo<Edge[]>(
    () =>
      topology.edges.flatMap((e) => {
        const id = edgeId(e.source, e.target)
        const taken = snap.taken.has(id)
        // Les chemins d'erreur n'apparaissent que s'ils ont servi : sinon ils encombrent.
        if (e.kind === 'error' && !taken) return []
        const active = snap.active === id
        const color = active ? '#7c3aed' : taken ? '#18181b' : snap.ended ? '#e4e4e7' : '#d4d4d8'
        const dashed = !taken && (snap.ended || e.kind === 'tool')
        const src = positions[e.source] ?? { x: 0, y: 0 }
        const tgt = positions[e.target] ?? { x: 0, y: 0 }
        const goesUp = tgt.y < src.y
        // Une sortie latérale (vers la droite) part du flanc du nœud, pas de dessous.
        const sideways = !goesUp && tgt.x > src.x + SIZE.step.w * 0.6
        const edge = {
          id,
          source: e.source,
          target: e.target,
          sourceHandle: goesUp || sideways ? 'right-out' : 'bottom',
          targetHandle: goesUp ? 'right-in' : 'top',
          label: e.label ?? undefined,
          animated: active,
          type: goesUp ? 'smoothstep' : 'default',
          pathOptions: goesUp ? { offset: 36, borderRadius: 12 } : undefined,
          style: {
            stroke: e.kind === 'error' ? '#dc2626' : color,
            strokeWidth: taken || active ? 2 : 1.25,
            strokeDasharray: dashed ? '5 5' : undefined,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
          labelStyle: {
            fontSize: 11,
            fontFamily: 'ui-monospace, monospace',
            fill: taken ? '#18181b' : snap.ended ? '#a1a1aa' : '#71717a',
            fontWeight: taken ? 600 : 400,
          },
          labelBgStyle: { fill: '#fafafa' },
          labelBgPadding: [4, 2] as [number, number],
          zIndex: taken ? 1 : 0,
        } as Edge
        return [edge]
      }),
    [topology, positions, snap],
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => onSelect(n.id)}
      fitView
      fitViewOptions={{ padding: 0.08 }}
      minZoom={0.3}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
    >
      <AutoFit watch={positions} />
      <Background gap={20} color="#e4e4e7" />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  )
}

export function GraphCanvas(props: Parameters<typeof Canvas>[0]) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
