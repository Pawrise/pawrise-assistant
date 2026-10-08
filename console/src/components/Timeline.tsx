import type { TopologyNode } from '@/api/types'
import { cn } from '@/lib/utils'
import type { Slot } from '@/run/model'
import { VIEW, fmtMs } from '@/run/status'

const BAR: Record<string, string> = {
  ok: 'bg-emerald-200 text-emerald-950',
  redirected: 'bg-amber-200 text-amber-950',
  degraded: 'bg-amber-200 text-amber-950',
  rejected: 'bg-red-200 text-red-950',
  error: 'bg-red-300 text-red-950',
}

/**
 * Une seule ligne : les nœuds s'exécutent l'un après l'autre, donc l'ordre se lit de gauche à
 * droite, et un nœud repassé (×2) apparaît deux fois.
 */
export function Timeline({
  slots,
  total,
  cursor,
  meta,
  stepByStep,
  onSeek,
  onSelect,
  onToggleMode,
}: {
  slots: Slot[]
  total: number
  cursor: number
  meta: Record<string, TopologyNode>
  stepByStep: boolean
  onSeek: (t: number) => void
  onSelect: (node: string, t: number) => void
  onToggleMode: () => void
}) {
  const pct = (t: number) => (total ? (t / total) * 100 : 0)
  const lanesOf = new Set(slots.filter((s) => s.lane === 1).map((s) => s.start))
  const hasLanes = lanesOf.size > 0
  const realTotal = slots.reduce((a, s) => a + (s.attempt.durationMs ?? 0), 0)

  return (
    <section aria-label="Chronologie" className="flex flex-col gap-2 border-t bg-white px-5 py-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="font-semibold">Chronologie</span>
        <span className="text-zinc-500">
          {slots.length ? `${slots.length} passages · ${fmtMs(realTotal)} de calcul` : 'aucun tour'}
        </span>
        <div className="flex-1" />
        <div className="hidden gap-3 text-xs text-zinc-500 md:flex">
          {(['ok', 'redirected', 'rejected', 'error'] as const).map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={cn('inline-block size-2.5 rounded-sm', BAR[k])} />
              {VIEW[k].word}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={onToggleMode}
          className="rounded-md border px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
          title="En pas à pas, chaque passage dure au moins 150 ms à l'écran ; les vraies durées restent affichées"
        >
          {stepByStep ? 'Pas à pas' : 'Durées réelles'}
        </button>
      </div>
      <div className="relative h-8 rounded-md bg-zinc-100">
        {/* Deux branches parallèles : chacune sur sa demi-hauteur. */}
        {slots.map((s) => {
          const running = cursor >= s.start && cursor < s.end
          const seen = cursor >= s.start
          const label = meta[s.attempt.node]?.label ?? s.attempt.node
          return (
            <button
              key={`${s.attempt.node}-${s.attempt.attempt}`}
              type="button"
              onClick={() => onSelect(s.attempt.node, s.end)}
              title={`${label} · passage ${s.attempt.attempt} · ${fmtMs(s.attempt.durationMs ?? 0)}`}
              className={cn(
                'absolute truncate border-r border-white px-1.5 text-left text-[11px] first:rounded-l-md last:rounded-r-md',
                hasLanes ? 'h-4 leading-4' : 'top-0 h-8 leading-8',
                hasLanes && (s.lane === 1 ? 'top-4' : 'top-0'),
                hasLanes && !lanesOf.has(s.start) && 'h-8 leading-8',
                running
                  ? 'bg-violet-300 text-violet-950'
                  : seen
                    ? (BAR[s.attempt.status ?? 'ok'] ?? 'bg-zinc-200')
                    : 'text-zinc-400',
                s.attempt.reused && 'opacity-50',
              )}
              style={{ left: `${pct(s.start)}%`, width: `${pct(s.end - s.start)}%` }}
            >
              {label}
              {s.attempt.attempt > 1 ? ` ×${s.attempt.attempt}` : ''}
            </button>
          )
        })}
        {slots.length ? (
          <span
            aria-hidden
            className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 bg-violet-600"
            style={{ left: `${pct(Math.min(cursor, total))}%` }}
          />
        ) : null}
      </div>
      <label className="sr-only" htmlFor="scrub">
        Position dans le tour
      </label>
      <input
        id="scrub"
        type="range"
        min={0}
        max={Math.max(total, 1)}
        step={1}
        value={Math.min(cursor, total)}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="w-full accent-violet-600"
        disabled={!slots.length}
      />
    </section>
  )
}
