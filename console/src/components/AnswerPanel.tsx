import type { AssistantResponse } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

function verdict(r: AssistantResponse): { label: string; cls: string } {
  const t = r.metadata.template_id
  if (t === 'SR-FALLBACK-02') return { label: '! Réponse de repli', cls: 'bg-red-100 text-red-800' }
  if (t) return { label: '! Réponse encadrée', cls: 'bg-amber-100 text-amber-900' }
  return { label: '✓ Vérifiée', cls: 'bg-emerald-100 text-emerald-800' }
}

export function AnswerPanel({
  response,
  visible,
  error,
  waiting,
}: {
  response: AssistantResponse | null
  visible: boolean
  error: string | null
  /** La phrase d'attente que lit le propriétaire, reçue en SSE (`/v1/turns/stream`). */
  waiting: string | null
}) {
  if (error) {
    return <p className="text-sm text-red-700">Le tour a échoué : {error}</p>
  }
  if (waiting && !visible) {
    return (
      <p key={waiting} className="shimmer animate-in fade-in text-[14px] duration-300">
        {waiting}
      </p>
    )
  }
  if (!response || !visible) {
    return (
      <p className="text-sm text-zinc-500">
        Rien n'est montré au propriétaire avant la fin de la vérification.
      </p>
    )
  }
  const v = verdict(response)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn('border-0', v.cls)}>
          {v.label}
        </Badge>
        {response.metadata.template_id ? (
          <span className="font-mono text-xs text-zinc-500">{response.metadata.template_id}</span>
        ) : null}
      </div>
      <p className="text-[14px] leading-relaxed text-zinc-900">{response.response_text}</p>
      {response.citations.length ? (
        <ul className="flex flex-col gap-0.5">
          {response.citations.map((c) => (
            <li key={c.source_id} className="text-xs text-zinc-500">
              <span className="font-mono">{c.source_id}</span> · {c.snippet}
            </li>
          ))}
        </ul>
      ) : null}
      {response.escalation.trigger ? (
        <div className="mt-1 flex flex-col gap-1">
          <span className="w-fit rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white">
            Contacter un vétérinaire
          </span>
          <span className="text-xs text-zinc-500">
            {response.escalation.urgency} · {response.escalation.reason}
          </span>
        </div>
      ) : null}
    </div>
  )
}
