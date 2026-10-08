import type { NodeView } from './model'

// Un statut = une couleur + un symbole + un mot. Jamais la couleur seule.
export const VIEW: Record<NodeView, { word: string; glyph: string; box: string; badge: string }> = {
  pending: {
    word: 'en attente',
    glyph: '',
    box: 'bg-white border-zinc-200 text-zinc-500',
    badge: 'text-zinc-500',
  },
  running: {
    word: 'en cours',
    glyph: '●',
    box: 'bg-violet-50 border-violet-500 ring-4 ring-violet-500/15 animate-pulse',
    badge: 'bg-violet-100 text-violet-800',
  },
  ok: {
    word: 'fait',
    glyph: '✓',
    box: 'bg-emerald-50 border-emerald-300',
    badge: 'bg-emerald-100 text-emerald-800',
  },
  redirected: {
    word: 'redirigé',
    glyph: '!',
    box: 'bg-amber-50 border-amber-300',
    badge: 'bg-amber-100 text-amber-900',
  },
  rejected: {
    word: 'rejeté',
    glyph: '✕',
    box: 'bg-red-50 border-red-300',
    badge: 'bg-red-100 text-red-800',
  },
  degraded: {
    word: 'dégradé',
    glyph: '!',
    box: 'bg-amber-50 border-amber-400 border-dashed',
    badge: 'bg-amber-100 text-amber-900',
  },
  error: {
    word: 'erreur',
    glyph: '✕',
    box: 'bg-red-50 border-red-400',
    badge: 'bg-red-100 text-red-800',
  },
  skipped: {
    word: 'non appelé',
    glyph: '–',
    box: 'bg-zinc-50 border-zinc-300 border-dashed text-zinc-400',
    badge: 'bg-zinc-100 text-zinc-500',
  },
}

export function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`
  if (ms < 1) return '< 1 ms'
  return `${Math.round(ms)} ms`
}
