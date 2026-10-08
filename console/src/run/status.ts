// Formats d'affichage partagés.

export function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`
  if (ms < 1) return '< 1 ms'
  return `${Math.round(ms)} ms`
}
