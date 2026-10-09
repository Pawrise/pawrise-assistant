import { Check, Circle, X, Zap } from 'lucide-react'
import { forwardRef } from 'react'
import type { TopologyNode } from '@/api/types'
import { ACTOR, NODE_ICON, type FaultMark } from '@/app/labels'
import { cn } from '@/lib/utils'
import type { NodeSnapshot, NodeView } from '@/run/model'
import { fmtMs } from '@/run/status'

const FRAME: Record<NodeView, string> = {
  pending: 'border-zinc-200 bg-white',
  running: 'border-violet-500 bg-violet-50 ring-4 ring-violet-500/15',
  ok: 'border-emerald-300 bg-white',
  redirected: 'border-amber-300 bg-amber-50/60',
  rejected: 'border-red-300 bg-red-50/60',
  degraded: 'border-amber-400 border-dashed bg-amber-50/60',
  error: 'border-red-400 bg-red-50/60',
  skipped: 'border-dashed border-zinc-200 bg-zinc-50/80 opacity-50',
}

function State({ snap }: { snap: NodeSnapshot }) {
  const { view, ms, count } = snap
  if (view === 'running') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-violet-700">
        <Circle className="size-2 animate-ping fill-violet-500 text-violet-500" aria-hidden />
        <span className="sr-only">en cours</span>
      </span>
    )
  }
  if (view === 'pending' || view === 'skipped') return null
  const bad = view === 'rejected' || view === 'error'
  const Icon = bad ? X : Check
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 text-[11px] font-medium tabular-nums',
        bad ? 'text-red-700' : view === 'ok' ? 'text-emerald-700' : 'text-amber-800',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {count > 1 ? `×${count} · ` : ''}
      {fmtMs(ms)}
    </span>
  )
}

/** Une étape du parcours : ce qu'elle fait, qui la fait (IA, règle…), et son état. */
export const NodeCard = forwardRef<
  HTMLButtonElement,
  {
    meta: TopologyNode
    snap: NodeSnapshot
    selected: boolean
    onSelect: () => void
    extra?: string | null
    /** Une panne simulée vise cette étape : dans l'échange affiché, ou au prochain message. */
    fault?: FaultMark
  }
>(function NodeCard({ meta, snap, selected, onSelect, extra, fault }, ref) {
  const Icon = NODE_ICON[meta.id]
  const actor = meta.actor ? ACTOR[meta.actor] : null
  const router = meta.kind === 'router'

  if (router) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          'mx-auto flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium shadow-xs transition',
          'outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
          snap.view === 'pending' || snap.view === 'skipped'
            ? 'border-zinc-200 bg-white text-zinc-700'
            : snap.view === 'running'
              ? 'border-violet-500 bg-violet-50 text-violet-900'
              : 'border-zinc-900 bg-zinc-900 text-white',
          selected && 'ring-2 ring-zinc-900 ring-offset-2',
        )}
      >
        {Icon ? <Icon className="size-4" aria-hidden /> : null}
        {meta.label}
      </button>
    )
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'group flex w-full min-w-0 flex-col gap-1 rounded-xl border p-2.5 text-left shadow-xs transition sm:p-3',
        'outline-none hover:shadow-sm focus-visible:ring-2 focus-visible:ring-violet-500',
        FRAME[snap.view],
        selected && 'ring-2 ring-zinc-900 ring-offset-2',
      )}
    >
      <span className="flex min-w-0 items-start gap-2.5">
        {Icon ? (
          <span
            className={cn(
              'hidden size-8 shrink-0 place-items-center rounded-lg sm:grid',
              actor?.tile ?? 'bg-zinc-100 text-zinc-700',
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-start justify-between gap-2">
            <span className="text-[13px] leading-tight font-medium text-zinc-900 sm:text-sm">
              {meta.label}
            </span>
            <State snap={snap} />
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {actor ? (
              <span className={cn('rounded px-1.5 py-px text-[10px] font-medium', actor.chip)}>
                {actor.label}
              </span>
            ) : null}
            {extra ? <span className="text-[11px] text-zinc-500">{extra}</span> : null}
            {fault === 'applied' ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-red-600 px-1.5 py-px text-[10px] font-medium text-white">
                <Zap className="size-2.5" /> Panne simulée
              </span>
            ) : fault === 'armed' ? (
              <span className="inline-flex items-center gap-0.5 rounded border border-dashed border-red-400 px-1.5 text-[10px] font-medium text-red-700">
                <Zap className="size-2.5" /> Au prochain message
              </span>
            ) : null}
          </span>
        </span>
      </span>
      <span className="hidden text-xs leading-snug text-zinc-500 md:block md:pl-[42px]">{meta.role}</span>
    </button>
  )
})
