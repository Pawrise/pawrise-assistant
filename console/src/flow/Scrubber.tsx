import { Pause, Play, RotateCcw } from 'lucide-react'
import type { TopologyNode } from '@/api/types'
import { cn } from '@/lib/utils'
import type { Slot } from '@/run/model'
import { fmtMs } from '@/run/status'

const SEG: Record<string, string> = {
  ok: 'bg-emerald-500',
  redirected: 'bg-amber-400',
  degraded: 'bg-amber-400',
  rejected: 'bg-red-500',
  error: 'bg-red-500',
}

/**
 * La chronologie du tour, à l'heure réelle du serveur : une barre par étape, placée quand elle a
 * vraiment commencé et fini. Deux étapes en même temps sont sur deux lignes. Une phrase dit ce qui
 * se passe à l'instant montré ; on glisse pour revoir le graphe à n'importe quel moment.
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
  const timed = slots.filter((s) => !s.attempt.reused)
  const lanes = Math.max(1, ...timed.map((s) => s.lane + 1))
  const atEnd = cursor >= total && !live
  const span = Math.max(total, 1)
  const label = (s: Slot) => meta[s.attempt.node]?.label ?? s.attempt.node

  // Ce qui travaille à l'instant montré (sans les étapes instantanées, illisibles).
  const now = timed.filter((s) => s.start <= cursor && cursor < s.end && s.end - s.start >= 20)
  const running = timed.filter((s) => s.attempt.status === null)
  const caption = live
    ? running.length
      ? `En direct · ${running.map(label).join(' et ')}`
      : 'En direct'
    : atEnd
      ? `Réponse envoyée en ${fmtMs(total)}`
      : now.length
        ? `À ${fmtMs(cursor)} : ${now.map(label).join(' et ')}`
        : `À ${fmtMs(cursor)}`

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={playing ? onPause : onPlay}
        disabled={!timed.length}
        aria-label={playing ? 'Pause' : atEnd ? 'Revoir le tour' : 'Lire'}
        title={playing ? 'Pause' : atEnd ? 'Revoir le tour' : 'Lire'}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-zinc-900 text-white shadow-sm transition hover:bg-zinc-700 disabled:opacity-30"
      >
        {playing ? <Pause className="size-4" /> : atEnd ? <RotateCcw className="size-4" /> : <Play className="size-4 translate-x-px" />}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className={cn('truncate text-sm', live ? 'font-medium text-violet-700' : 'text-zinc-800')}>{caption}</p>
        <div className="relative">
          <div className="flex flex-col gap-0.5 rounded-md bg-zinc-100 p-0.5">
            {Array.from({ length: lanes }, (_, lane) => (
              <div key={lane} className="relative h-2">
                {timed
                  .filter((s) => s.lane === lane)
                  .map((s) => (
                    <span
                      key={`${s.attempt.node}-${s.attempt.attempt}`}
                      title={`${label(s)} · ${fmtMs(s.end - s.start)}`}
                      className={cn(
                        'absolute top-0 h-full min-w-[3px] rounded-sm transition-opacity',
                        s.attempt.status ? SEG[s.attempt.status] : 'animate-pulse bg-violet-500',
                        s.start > cursor && 'opacity-25',
                      )}
                      style={{ left: `${(s.start / span) * 100}%`, width: `${((s.end - s.start) / span) * 100}%` }}
                    />
                  ))}
              </div>
            ))}
          </div>
          <span
            aria-hidden
            className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded bg-zinc-900"
            style={{ left: `${Math.min(100, (cursor / span) * 100)}%` }}
          />
          <input
            type="range"
            min={0}
            max={span}
            value={Math.min(cursor, span)}
            onChange={(e) => onSeek(Number(e.target.value))}
            aria-label="Instant du tour"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
        <div className="flex justify-between text-[11px] text-zinc-400 tabular-nums">
          <span>0 s</span>
          <span>{live ? `${fmtMs(cursor)}…` : fmtMs(total)}</span>
        </div>
      </div>
    </div>
  )
}
