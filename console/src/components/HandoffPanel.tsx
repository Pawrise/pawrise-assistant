import type { HandoffSummary } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const URGENCY: Record<HandoffSummary['urgency'], { label: string; cls: string }> = {
  low: { label: 'Urgence faible', cls: 'bg-zinc-100 text-zinc-700' },
  medium: { label: 'Urgence moyenne', cls: 'bg-amber-100 text-amber-900' },
  high: { label: 'Urgence élevée', cls: 'bg-red-100 text-red-800' },
}

function Source({ s }: { s: string }) {
  return <span className="font-mono text-[11px] text-zinc-500">{s}</span>
}

/** Le dossier tel que le vétérinaire le recevra (avant mise en page PDF par File & Export). */
export function HandoffPanel({ summary }: { summary: HandoffSummary }) {
  const u = URGENCY[summary.urgency]
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn('border-0', u.cls)}>
          {u.label}
        </Badge>
        {summary.pet ? (
          <span className="text-zinc-600">
            {summary.pet.name}, {summary.pet.breed}, {summary.pet.age_years} ans
          </span>
        ) : (
          <span className="text-zinc-500">profil indisponible</span>
        )}
      </div>
      <p>
        <span className="text-zinc-500">Motif : </span>
        {summary.reason}
      </p>
      {summary.timeline.length ? (
        <ol className="flex flex-col gap-1 border-l pl-3">
          {summary.timeline.map((e, i) => (
            <li key={i}>
              <span className="font-medium">{e.days_ago === 0 ? "Aujourd'hui" : `J-${e.days_ago}`}</span>{' '}
              {e.text} <Source s={e.source} />
            </li>
          ))}
        </ol>
      ) : null}
      {summary.owner_reported.map((o, i) => (
        <p key={i} className="text-zinc-700">
          « {o.text} » <Source s={o.source} />
        </p>
      ))}
      <p className="text-xs text-zinc-500">{summary.disclaimer}</p>
    </div>
  )
}
