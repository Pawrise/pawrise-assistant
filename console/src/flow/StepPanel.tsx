import { ChevronDown, RotateCcw, X } from 'lucide-react'
import type { TopologyNode } from '@/api/types'
import { ACTOR, NODE_ICON, ON_ERROR } from '@/app/labels'
import { cn } from '@/lib/utils'
import type { Attempt, NodeSnapshot } from '@/run/model'
import { fmtMs } from '@/run/status'
import { Details, LlmUsage, type LlmUsageData } from './details'

function stateLine(snap: NodeSnapshot | undefined): { text: string; cls: string } {
  switch (snap?.view) {
    case 'running':
      return { text: 'En cours…', cls: 'text-violet-700' }
    case 'skipped':
      return { text: 'Pas appelée : le message a pris un autre chemin.', cls: 'text-zinc-500' }
    case 'pending':
    case undefined:
      return { text: 'Pas encore atteinte.', cls: 'text-zinc-500' }
    case 'rejected':
      return { text: 'Réponse rejetée.', cls: 'text-red-700' }
    case 'error':
      return { text: 'Tombée en panne.', cls: 'text-red-700' }
    case 'redirected':
      return { text: 'A changé la suite du parcours.', cls: 'text-amber-800' }
    case 'degraded':
      return { text: 'Faite, avec des données manquantes.', cls: 'text-amber-800' }
    default:
      return { text: `Faite en ${fmtMs(snap?.ms ?? 0)}.`, cls: 'text-emerald-700' }
  }
}

/** Le détail d'une étape : pourquoi elle existe, ce qu'elle a fait, et la relancer. */
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
  const Icon = NODE_ICON[meta.id]
  const actor = meta.actor ? ACTOR[meta.actor] : null
  const line = stateLine(snap)

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start gap-3">
        {Icon ? (
          <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', actor?.tile)}>
            <Icon className="size-5" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-base leading-tight font-semibold">{meta.label}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {actor ? <span className={cn('rounded px-1.5 py-px font-medium', actor.chip)}>{actor.label}</span> : null}
            <span className={line.cls}>{line.text}</span>
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid size-8 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </header>

      <p className="text-sm leading-relaxed text-zinc-700">{meta.role}</p>
      {meta.on_error ? (
        <p className="text-xs text-zinc-500">
          Si elle tombe en panne : {ON_ERROR[meta.on_error] ?? meta.on_error}.
        </p>
      ) : null}

      {attempts.map((a) => (
        <section key={`${a.node}-${a.attempt}`} className="flex flex-col gap-2.5 rounded-xl border bg-white p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium">
              {attempts.length > 1 ? <span className="text-zinc-500">Passage {a.attempt} · </span> : null}
              {a.summary || 'En cours…'}
            </p>
            {a.durationMs !== null && !a.reused ? (
              <span className="shrink-0 text-xs text-zinc-500 tabular-nums">{fmtMs(a.durationMs)}</span>
            ) : null}
          </div>
          {a.data.llm ? <LlmUsage usage={a.data.llm as LlmUsageData} /> : null}
          {a.status ? <Details node={a.node} data={a.data} /> : null}
          <div className="flex flex-wrap items-center gap-2">
            {/* Relancer une sortie à texte fixe redonnerait le même texte : seules les étapes qui travaillent se relancent. */}
            {onRerun && a.status && (meta.kind === 'step' || meta.kind === 'router') ? (
              <button
                type="button"
                onClick={() => onRerun(a.node, a.attempt)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <RotateCcw className="size-3.5" />
                Relancer depuis ici
              </button>
            ) : null}
            <details className="group w-full text-xs">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-zinc-500 hover:text-zinc-800">
                <ChevronDown className="size-3.5 transition group-open:rotate-180" />
                Données techniques
              </summary>
              <pre className="mt-1.5 max-h-64 overflow-auto rounded-lg bg-zinc-50 p-2 font-mono text-[11px] whitespace-pre-wrap">
                {JSON.stringify(a.data, null, 2)}
              </pre>
            </details>
          </div>
        </section>
      ))}
    </div>
  )
}
