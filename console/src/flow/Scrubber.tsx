import { Pause, Play, RotateCcw } from 'lucide-react'
import type { TopologyNode } from '@/api/types'
import { cn } from '@/lib/utils'
import type { Slot } from '@/run/model'
import { fmtMs } from '@/run/status'

const SEG: Record<string, string> = {
  ok: 'bg-emerald-400',
  redirected: 'bg-amber-400',
  degraded: 'bg-amber-400',
  rejected: 'bg-red-400',
  error: 'bg-red-500',
}

/**
 * Lecture du tour : une barre, un bouton. Chaque segment est une étape, à sa durée réelle ;
 * on peut glisser pour revoir le graphe à n'importe quel instant.
 */
export function Scrubber({
  slots,
  total,
  cursor,
  playing,
  live,
  meta,
  onSeek,
  onPlay,
  onPause,
}: {
  slots: Slot[]
  total: number
  cursor: number
  playing: boolean
  live: boolean
  meta: Record<string, TopologyNode>
  onSeek: (t: number) => void
  onPlay: () => void
  onPause: () => void
}) {
  const main = slots.filter((s) => s.lane === 0)
  const atEnd = cursor >= total && !live
  const slowest = [...slots]
    .filter((s) => (s.attempt.durationMs ?? 0) > 0)
    .sort((a, b) => (b.attempt.durationMs ?? 0) - (a.attempt.durationMs ?? 0))
    .slice(0, 3)
  const realTotal = slots.reduce((acc, s) => Math.max(acc, s.attempt.endTs ?? 0), 0)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={playing ? onPause : onPlay}
          disabled={!slots.length}
          aria-label={playing ? 'Pause' : atEnd ? 'Revoir' : 'Lire'}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-zinc-900 text-white shadow-sm transition hover:bg-zinc-700 disabled:opacity-30"
        >
          {playing ? (
            <Pause className="size-4" />
          ) : atEnd ? (
            <RotateCcw className="size-4" />
          ) : (
            <Play className="size-4 translate-x-px" />
          )}
        </button>
        <div className="relative h-9 min-w-0 flex-1">
          <div className="absolute inset-x-0 top-1/2 flex h-2 -translate-y-1/2 gap-px overflow-hidden rounded-full bg-zinc-200">
            {main.map((s) => {
              const seen = s.start <= cursor
              const width = total ? ((s.end - s.start) / total) * 100 : 0
              return (
                <span
                  key={`${s.attempt.node}-${s.attempt.attempt}`}
                  title={meta[s.attempt.node]?.label ?? s.attempt.node}
                  className={cn(
                    'h-full transition-opacity',
                    s.attempt.status ? SEG[s.attempt.status] : 'bg-violet-400',
                    !seen && 'opacity-25',
                  )}
                  style={{ width: `${width}%` }}
                />
              )
            })}
          </div>
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-zinc-900 shadow"
            style={{ left: `${total ? Math.min(100, (cursor / total) * 100) : 0}%` }}
          />
          <input
            type="range"
            min={0}
            max={Math.max(total, 1)}
            value={Math.min(cursor, total)}
            onChange={(e) => onSeek(Number(e.target.value))}
            aria-label="Instant du tour"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
        <span className="w-16 shrink-0 text-right text-xs text-zinc-500 tabular-nums">
          {live ? 'en direct' : fmtMs(realTotal)}
        </span>
      </div>
      {slowest.length && !live ? (
        <p className="truncate text-xs text-zinc-500">
          <span className="font-medium text-zinc-700">Le plus long : </span>
          {slowest
            .map((s) => `${meta[s.attempt.node]?.label ?? s.attempt.node} ${fmtMs(s.attempt.durationMs ?? 0)}`)
            .join(' · ')}
        </p>
      ) : null}
    </div>
  )
}
