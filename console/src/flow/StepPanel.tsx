import { ChevronDown, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import type { StepModel, TopologyNode } from '@/api/types'
import { ACTOR, NODE_ICON, fmtEur } from '@/app/labels'
import { cn } from '@/lib/utils'
import type { Attempt, NodeSnapshot } from '@/run/model'
import { fmtMs } from '@/run/status'
import { Details, type LlmUsageData } from './details'
import { GUIDE } from './guide'

/** L'explication d'une étape : ce qu'elle fait, ses cas, pourquoi, et en cas de panne. */
function Guide({ id, fallback }: { id: string; fallback: string }) {
  const g = GUIDE[id]
  if (!g) return <p className="text-sm leading-snug text-zinc-600">{fallback}</p>
  return (
    <div className="flex flex-col gap-2.5 text-sm leading-snug">
      <p className="text-zinc-800">{g.does}</p>
      {g.cases?.length ? (
        <ul className="flex flex-col gap-1">
          {g.cases.map((c) => (
            <li key={c.when} className="flex gap-2 text-[13px]">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-zinc-400" />
              <span>
                <span className="text-zinc-800">{c.when}</span>
                {c.then ? <span className="text-zinc-500"> → {c.then}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-[13px] text-zinc-500">
        <span className="font-medium text-zinc-700">Pourquoi : </span>
        {g.why}
      </p>
      {g.fail ? (
        <p
          className={cn(
            'w-fit rounded-md px-2 py-1 text-xs',
            g.fail.kind === 'closed' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900',
          )}
        >
          En panne : {g.fail.text}
        </p>
      ) : null}
    </div>
  )
}

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
  model,
}: {
  meta: TopologyNode
  snap: NodeSnapshot | undefined
  attempts: Attempt[]
  onClose?: () => void
  onRerun?: (node: string, attempt: number) => void
  model?: StepModel
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

      {model ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs text-violet-900">
          <span className="font-medium">Modèle</span>
          <span className="font-mono">{model.model}</span>
          {model.note ? <span className="text-violet-700/80">· {model.note}</span> : null}
        </p>
      ) : null}

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
        <Guide id={meta.id} fallback={meta.role} />
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
          <Guide id={meta.id} fallback={meta.role} />
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
