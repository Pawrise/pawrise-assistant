import { ChevronLeft, ChevronRight, Minus, Pause, Play, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import type { TopologyNode } from '@/api/types'
import { cn } from '@/lib/utils'
import type { Slot } from '@/run/model'
import { fmtMs } from '@/run/status'

const SEG: Record<string, string> = {
  ok: 'bg-emerald-500 text-white',
  redirected: 'bg-amber-400 text-amber-950',
  degraded: 'bg-amber-400 text-amber-950',
  rejected: 'bg-red-500 text-white',
  error: 'bg-red-500 text-white',
}

/** Un pas de graduation lisible pour une échelle donnée (au moins ~70 px entre deux traits). */
function tickStep(pxPerMs: number): number {
  for (const s of [100, 250, 500, 1000, 2000, 5000, 10000]) if (s * pxPerMs >= 70) return s
  return 20000
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
  dark,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
  dark?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'grid shrink-0 place-items-center rounded-full transition disabled:opacity-30',
        dark ? 'size-9 bg-zinc-900 text-white shadow-sm hover:bg-zinc-700' : 'size-8 border bg-white text-zinc-700 hover:bg-zinc-50',
      )}
    >
      {children}
    </button>
  )
}

/**
 * La chronologie du tour, à l'heure réelle du serveur. Chaque étape est un bloc nommé, placé quand
 * elle a commencé et fini ; deux étapes en même temps sont sur deux lignes. La piste défile et se
 * zoome ; on clique ou on glisse pour revoir le graphe à n'importe quel instant, et les flèches
 * sautent d'une étape à l'autre.
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
  const span = Math.max(total, 1)
  const atEnd = cursor >= total && !live
  const label = (s: Slot) => meta[s.attempt.node]?.label ?? s.attempt.node

  // Échelle : « ajustée » remplit la largeur ; le zoom l'agrandit, la piste défile alors.
  const viewport = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [zoom, setZoom] = useState(1)
  useLayoutEffect(() => {
    const el = viewport.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const pxPerMs = ((width - 8) / span) * zoom
  const contentWidth = Math.max(width, span * pxPerMs + 8)
  const x = (t: number) => 4 + t * pxPerMs

  // Le curseur reste visible quand la piste est plus large que l'écran.
  useEffect(() => {
    const el = viewport.current
    if (!el || zoom === 1) return
    const cx = x(Math.min(cursor, span))
    if (cx < el.scrollLeft + 24 || cx > el.scrollLeft + el.clientWidth - 24) {
      el.scrollTo({ left: Math.max(0, cx - el.clientWidth * 0.3), behavior: playing ? 'auto' : 'smooth' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- suit le curseur et l'échelle
  }, [cursor, pxPerMs])

  // Glisser sur la piste pour se déplacer dans le temps.
  const dragging = useRef(false)
  const seekAt = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(span, (e.clientX - rect.left - 4) / pxPerMs)))
  }

  // Les débuts d'étape, pour sauter de l'une à l'autre.
  const starts = [...new Set(timed.map((s) => s.start))].sort((a, b) => a - b)
  const prev = starts.findLast((t) => t < cursor - 1)
  const next = starts.find((t) => t > cursor + 1)
  const now = timed.filter((s) => s.start <= cursor && cursor < s.end)
  const running = timed.filter((s) => s.attempt.status === null)
  const caption = live
    ? running.length
      ? `En direct · ${running.map(label).join(' et ')}`
      : 'En direct'
    : atEnd
      ? `Réponse envoyée en ${fmtMs(total)}`
      : now.length
        ? `${now.map(label).join(' et ')} · à ${fmtMs(cursor)}`
        : `À ${fmtMs(cursor)}`
  const step = tickStep(pxPerMs)
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <IconButton label="Étape précédente" onClick={() => onSeek(prev ?? 0)} disabled={live || prev === undefined}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <IconButton
          dark
          label={playing ? 'Pause' : atEnd ? 'Revoir le tour' : 'Lire'}
          onClick={playing ? onPause : onPlay}
          disabled={!timed.length}
        >
          {playing ? <Pause className="size-4" /> : atEnd ? <RotateCcw className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </IconButton>
        <IconButton label="Étape suivante" onClick={() => next !== undefined && onSeek(next)} disabled={live || next === undefined}>
          <ChevronRight className="size-4" />
        </IconButton>
        <p className={cn('ml-1 min-w-0 flex-1 truncate text-sm', live ? 'font-medium text-violet-700' : 'text-zinc-800')}>{caption}</p>
        <div className="hidden items-center gap-1 sm:flex">
          <IconButton label="Dézoomer" onClick={() => setZoom(Math.max(1, zoom / 1.6))} disabled={zoom <= 1}>
            <Minus className="size-3.5" />
          </IconButton>
          <IconButton label="Zoomer" onClick={() => setZoom(Math.min(40, zoom * 1.6))}>
            <Plus className="size-3.5" />
          </IconButton>
          {zoom > 1 ? (
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="h-8 rounded-full border bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Ajuster
            </button>
          ) : null}
        </div>
      </div>

      <div ref={viewport} className="overflow-x-auto overscroll-x-contain rounded-xl border bg-zinc-50 [scrollbar-width:thin]">
        <div
          className="relative cursor-pointer touch-pan-x select-none"
          style={{ width: contentWidth }}
          onPointerDown={(e) => {
            dragging.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            seekAt(e)
          }}
          onPointerMove={(e) => dragging.current && seekAt(e)}
          onPointerUp={() => (dragging.current = false)}
        >
          {/* Règle graduée */}
          <div className="relative h-5 border-b border-zinc-200">
            {ticks.map((t) => (
              <span key={t} className="absolute top-0 h-full border-l border-zinc-200 pl-1 text-[10px] text-zinc-400 tabular-nums" style={{ left: x(t) }}>
                {t === 0 ? '0 s' : fmtMs(t)}
              </span>
            ))}
          </div>
          {/* Une ligne par étapes simultanées */}
          <div className="flex flex-col gap-1 px-0 py-1.5">
            {Array.from({ length: lanes }, (_, lane) => (
              <div key={lane} className="relative h-6">
                {timed
                  .filter((s) => s.lane === lane)
                  .map((s) => {
                    const w = Math.max(4, (s.end - s.start) * pxPerMs)
                    return (
                      <span
                        key={`${s.attempt.node}-${s.attempt.attempt}`}
                        title={`${label(s)} · ${fmtMs(s.end - s.start)}`}
                        className={cn(
                          'absolute top-0 flex h-full items-center overflow-hidden rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap transition-opacity',
                          s.attempt.status ? SEG[s.attempt.status] : 'animate-pulse bg-violet-500 text-white',
                          s.start > cursor && 'opacity-30',
                        )}
                        style={{ left: x(s.start), width: w }}
                      >
                        {w > 56 ? label(s) : ''}
                      </span>
                    )
                  })}
              </div>
            ))}
          </div>
          {/* Curseur */}
          <span
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-zinc-900"
            style={{ left: x(Math.min(cursor, span)) }}
          >
            <span className="absolute -top-0.5 left-1/2 size-2 -translate-x-1/2 rounded-full bg-zinc-900" />
          </span>
        </div>
      </div>
    </div>
  )
}
