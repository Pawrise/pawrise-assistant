import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { admin, type AuditEntry } from '@/api/admin'
import type { Pet } from '@/api/types'
import { FAULTS, TONE, verdict } from '@/app/labels'
import { cn } from '@/lib/utils'
import { fmtMs } from '@/run/status'

/** Les entrées écrites avant l'ajout de l'horodatage n'en ont pas. */
const time = (ts: string | undefined) =>
  ts ? new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'

/** Chaque réponse partie, telle qu'enregistrée par la sortie unique du parcours. */
export function JournalTab({ pets, labels }: { pets: Pet[]; labels: Record<string, string> }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(() => {
    admin.audit(100).then(setRows).catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])
  const petName = (ref: string) => pets.find((p) => p.pet_ref === ref)?.name ?? ref

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight sm:text-xl">Journal d’audit</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Toutes les réponses passent par une seule sortie, qui les enregistre avec leur parcours. Rien ne part sans trace.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCw className="size-4" /> Actualiser
          </button>
        </header>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {rows && !rows.length ? <p className="text-sm text-zinc-500">Aucune réponse enregistrée pour l’instant.</p> : null}
        {rows?.length ? (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
            {rows.map((r) => {
              const id = `${r.thread_id}/${r.turn_id}/${r.ts}`
              const v = verdict({ escalation: r.escalation, metadata: { template_id: r.template_id } })
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => setOpen(open === id ? null : id)}
                    className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-zinc-50 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <span className="w-20 shrink-0 font-mono text-xs text-zinc-500">{time(r.ts)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{r.input}</span>
                      <span className="text-xs text-zinc-500">
                        {petName(r.pet_ref)} · {r.path.length} étapes
                        {r.faults.length ? ` · panne : ${r.faults.map((f) => FAULTS[f]?.label ?? f).join(', ')}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium ring-1', TONE[v.tone])}>{v.label}</span>
                      {r.escalation.trigger ? <span className="text-xs text-zinc-600">vétérinaire</span> : null}
                      <span className="w-12 text-right text-xs text-zinc-400 tabular-nums">{fmtMs(r.latency_ms)}</span>
                    </span>
                  </button>
                  {open === id ? (
                    <div className="flex flex-col gap-2 border-t bg-zinc-50 px-4 py-3 text-[13px]">
                      <p className="flex flex-wrap gap-1">
                        {r.path.map((n, i) => (
                          <span key={`${n}-${i}`} className="rounded bg-white px-1.5 py-0.5 text-xs text-zinc-700 ring-1 ring-zinc-200">
                            {labels[n] ?? n}
                          </span>
                        ))}
                      </p>
                      <p className="leading-relaxed text-zinc-700">{r.response_text}</p>
                      {r.escalation.reason ? <p className="text-xs text-zinc-500">Escalade : {r.escalation.reason}</p> : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
