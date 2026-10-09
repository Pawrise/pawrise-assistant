import { usage, type Entry } from '@/app/store'
import { fmtEur, TONE, verdict } from '@/app/labels'
import { HandoffPanel } from '@/components/HandoffPanel'
import { cn } from '@/lib/utils'
import { fmtMs } from '@/run/status'

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] text-zinc-500">{k}</dt>
      <dd className="text-sm font-medium tabular-nums">{v}</dd>
    </div>
  )
}

/** L'échange en bref : la question, le verdict, et ce que ça a coûté. */
export function RunSummary({ entry, compact }: { entry: Entry; compact?: boolean }) {
  const { run } = entry
  const r = run.response
  const v = r ? verdict(r) : null
  const { cost, calls } = usage(entry)
  const steps = new Set(run.attempts.map((a) => a.node)).size

  return (
    <div className="flex flex-col gap-3">
      <p className={cn('text-zinc-900', compact ? 'line-clamp-2 text-sm' : 'text-[15px] leading-snug font-medium')}>
        {entry.graph === 'handoff' ? 'Dossier pour le vétérinaire' : `« ${entry.message} »`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {run.phase === 'running' ? (
          <span className="shimmer text-sm">En cours…</span>
        ) : run.phase === 'error' ? (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800 ring-1 ring-red-600/20">
            Échec : {run.error}
          </span>
        ) : v && v.tone !== 'ok' ? (
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium ring-1', TONE[v.tone])}>{v.label}</span>
        ) : null}
        {r?.escalation.trigger ? <span className="text-xs text-zinc-600">Vétérinaire proposé</span> : null}
        {entry.faults.length ? (
          <span className="text-xs text-red-700">{entry.faults.length} panne(s) simulée(s)</span>
        ) : null}
      </div>
      <dl className="grid grid-cols-3 gap-2 rounded-xl border bg-white px-3 py-2.5">
        <Stat k="Durée" v={r ? fmtMs(r.metadata.latency_ms) : '—'} />
        <Stat k="Appels IA" v={calls ? String(calls) : '0'} />
        <Stat k="Coût" v={calls ? fmtEur(cost) : '0 ct'} />
      </dl>
      {!compact && r && run.phase === 'done' ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Réponse envoyée</p>
          <p className="text-sm leading-relaxed text-zinc-800">{r.response_text}</p>
        </div>
      ) : null}
      {!compact && run.summary && run.phase === 'done' ? <HandoffPanel summary={run.summary} /> : null}
      {!compact ? (
        <p className="text-xs text-zinc-500">
          {steps} étapes utilisées. Touchez une étape du parcours pour voir ce qu’elle a fait.
        </p>
      ) : null}
    </div>
  )
}
