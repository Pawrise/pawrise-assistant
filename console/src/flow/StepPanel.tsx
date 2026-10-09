import { ChevronDown, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import type { TopologyNode } from '@/api/types'
import { ACTOR, NODE_ICON, ON_ERROR, fmtEur } from '@/app/labels'
import { cn } from '@/lib/utils'
import type { Attempt, NodeSnapshot } from '@/run/model'
import { fmtMs } from '@/run/status'
import { Details, type LlmUsageData } from './details'

function stateLine(snap: NodeSnapshot | undefined): { text: string; cls: string } {
  switch (snap?.view) {
    case 'running':
      return { text: 'en cours', cls: 'text-violet-700' }
    case 'skipped':
      return { text: 'pas appelée', cls: 'text-zinc-500' }
    case 'pending':
    case undefined:
      return { text: 'pas encore atteinte', cls: 'text-zinc-500' }
    case 'rejected':
      return { text: 'réponse rejetée', cls: 'text-red-700' }
    case 'error':
      return { text: 'en panne', cls: 'text-red-700' }
    case 'redirected':
      return { text: 'a changé la suite', cls: 'text-amber-800' }
    case 'degraded':
      return { text: 'faite, données manquantes', cls: 'text-amber-800' }
    default:
      return { text: `faite en ${fmtMs(snap?.ms ?? 0)}`, cls: 'text-emerald-700' }
  }
}

/**
 * Le contenu de la bulle d'une étape : l'essentiel d'abord (ce qu'elle a fait, ce que ça a
 * coûté), le détail complet seulement si on le demande.
 */
export function StepPanel({
  meta,
  snap,
  attempts,
  onClose,
  onRerun,
}: {
  meta: TopologyNode
  snap: NodeSnapshot | undefined
  attempts: Attempt[]
  onClose?: () => void
  onRerun?: (node: string, attempt: number) => void
}) {
  const [open, setOpen] = useState(false)
  const Icon = NODE_ICON[meta.id]
  const actor = meta.actor ? ACTOR[meta.actor] : null
  const line = stateLine(snap)
  const done = attempts.filter((a) => a.status)
  const llm = done
    .map((a) => a.data.llm as LlmUsageData | undefined)
    .filter((u): u is LlmUsageData => Boolean(u))
  const cost = llm.reduce((n, u) => n + u.cost_eur, 0)
  const models = [...new Set(llm.flatMap((u) => u.models))]
  const canRerun = onRerun && (meta.kind === 'step' || meta.kind === 'router')

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-start gap-2.5">
        {Icon ? (
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', actor?.tile)}>
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm leading-tight font-semibold">{meta.label}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs">
            {actor ? <span className="text-zinc-500">{actor.label} ·</span> : null}
            <span className={line.cls}>{line.text}</span>
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="-m-1 grid size-7 shrink-0 place-items-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </header>

      {done.length ? (
        <ul className="flex flex-col gap-1.5">
          {done.map((a) => (
            <li key={`${a.node}-${a.attempt}`} className="text-sm leading-snug text-zinc-800">
              {done.length > 1 ? <span className="text-zinc-500">{a.attempt}ᵉ passage · </span> : null}
              {a.summary}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-snug text-zinc-600">{meta.role}</p>
      )}

      {models.length ? (
        <p className="text-xs text-zinc-500">
          {models.join(', ')} · {fmtEur(cost)}
        </p>
      ) : null}

      {done.length ? (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex w-fit items-center gap-1 text-xs font-medium text-zinc-700 hover:text-zinc-950"
        >
          <ChevronDown className={cn('size-3.5 transition', open && 'rotate-180')} />
          {open ? 'Masquer le détail' : 'Voir le détail'}
        </button>
      ) : null}

      {open ? (
        <div className="animate-in fade-in flex flex-col gap-3 border-t pt-3 duration-200">
          <p className="text-xs leading-relaxed text-zinc-500">
            {meta.role}
            {meta.on_error ? ` En panne : ${ON_ERROR[meta.on_error] ?? meta.on_error}.` : ''}
          </p>
          {done.map((a) => (
            <section key={`${a.node}-${a.attempt}`} className="flex flex-col gap-2">
              {done.length > 1 ? <p className="text-xs font-medium text-zinc-500">{a.attempt}ᵉ passage</p> : null}
              <Details node={a.node} data={a.data} />
              {canRerun ? (
                <button
                  type="button"
                  onClick={() => onRerun(a.node, a.attempt)}
                  className="inline-flex h-8 w-fit items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  <RotateCcw className="size-3.5" />
                  Relancer depuis ici
                </button>
              ) : null}
            </section>
          ))}
          <details className="group text-xs">
            <summary className="flex list-none items-center gap-1 text-zinc-500 hover:text-zinc-800">
              <ChevronDown className="size-3.5 transition group-open:rotate-180" />
              Données techniques
            </summary>
            <pre className="mt-1.5 max-h-56 overflow-auto rounded-lg bg-zinc-50 p-2 font-mono text-[11px] whitespace-pre-wrap">
              {JSON.stringify(
                done.map((a) => a.data),
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      ) : null}
    </div>
  )
}
