import { ArrowUp, ChevronRight, FileText, PawPrint, Siren, Stethoscope } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Pet, Scenario } from '@/api/types'
import { TONE, verdict } from '@/app/labels'
import { href } from '@/app/route'
import { liveStatus, type Entry } from '@/app/store'
import { HandoffPanel } from '@/components/HandoffPanel'
import { cn } from '@/lib/utils'
import { fmtMs } from '@/run/status'

function Avatar() {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-900 text-white" aria-hidden>
      <PawPrint className="size-4" />
    </span>
  )
}

function Reply({ entry, onHandoff }: { entry: Entry; onHandoff: (e: Entry) => void }) {
  const { run } = entry
  const [sources, setSources] = useState(false)

  if (run.phase === 'running' || run.phase === 'idle') {
    return (
      <p key={liveStatus(run)} className="shimmer animate-in fade-in py-1.5 text-[15px] duration-300">
        {liveStatus(run)}
      </p>
    )
  }
  if (run.phase === 'error') {
    return (
      <div className="rounded-2xl rounded-tl-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        Le service ne répond pas pour le moment.
      </div>
    )
  }
  if (entry.graph === 'handoff' && run.summary) {
    return (
      <div className="flex flex-col gap-2 rounded-2xl rounded-tl-md border bg-white p-4 shadow-xs">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="size-4" /> Dossier prêt pour le vétérinaire
        </p>
        <HandoffPanel summary={run.summary} />
        <Meta entry={entry} label="Dossier vérifié" tone="ok" />
      </div>
    )
  }
  const r = run.response
  if (!r) return null
  const v = verdict(r)
  const urgent = r.escalation.urgency === 'high'
  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          'flex flex-col gap-3 rounded-2xl rounded-tl-md border bg-white px-4 py-3 shadow-xs',
          urgent && 'border-red-200',
        )}
      >
        {urgent ? (
          <p className="-mx-4 -mt-3 flex items-center gap-2 rounded-t-2xl rounded-tl-md bg-red-600 px-4 py-2 text-sm font-semibold text-white">
            <Siren className="size-4" /> Urgence
          </p>
        ) : null}
        <p className="text-[15px] leading-relaxed text-zinc-900">{r.response_text}</p>
        {r.citations.length ? (
          <div>
            <button
              type="button"
              onClick={() => setSources(!sources)}
              aria-expanded={sources}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-900"
            >
              {r.citations.length} source{r.citations.length > 1 ? 's' : ''} {sources ? '▴' : '▾'}
            </button>
            {sources ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {r.citations.map((c) => (
                  <li key={c.source_id} className="rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-600">
                    {c.snippet}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {r.escalation.trigger ? (
          <div className="flex flex-wrap gap-2">
            <span
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-sm font-medium',
                urgent ? 'bg-red-600 text-white' : 'bg-zinc-900 text-white',
              )}
            >
              <Stethoscope className="size-4" /> Contacter un vétérinaire
            </span>
            <button
              type="button"
              onClick={() => onHandoff(entry)}
              className="inline-flex h-9 items-center gap-2 rounded-xl border bg-white px-3.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              <FileText className="size-4" /> Préparer le dossier
            </button>
          </div>
        ) : null}
      </div>
      <Meta entry={entry} label={v.label} tone={v.tone} />
    </div>
  )
}

function Meta({ entry, label, tone }: { entry: Entry; label: string; tone: keyof typeof TONE }) {
  const ms = entry.run.response?.metadata.latency_ms ?? entry.run.attempts.at(-1)?.endTs ?? 0
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-zinc-500">
      <span className={cn('rounded-full px-2 py-0.5 font-medium ring-1', TONE[tone])}>{label}</span>
      <span className="tabular-nums">{fmtMs(ms)}</span>
      <a href={href('flow', entry.id)} className="ml-auto inline-flex items-center gap-0.5 font-medium text-zinc-700 hover:text-zinc-950">
        Voir le parcours <ChevronRight className="size-3.5" />
      </a>
    </div>
  )
}

export function ChatView({
  entries,
  pets,
  petRef,
  onPet,
  scenarios,
  onSend,
  onScenario,
  onHandoff,
}: {
  entries: Entry[]
  pets: Pet[]
  petRef: string
  onPet: (ref: string) => void
  scenarios: Scenario[]
  onSend: (message: string) => void
  onScenario: (s: Scenario) => void
  onHandoff: (e: Entry) => void
}) {
  const [draft, setDraft] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const busy = entries.some((e) => e.run.phase === 'running')
  const pet = pets.find((p) => p.pet_ref === petRef)
  const examples = scenarios.filter((s) => !s.faults.length)

  const last = entries.at(-1)
  const progress = last ? `${last.id}:${last.run.attempts.length}:${last.run.phase}` : ''
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [entries.length, progress])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    onSend(text)
    setDraft('')
  }
  const onEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.code === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
          <div className="flex items-center justify-center gap-1.5">
            {pets.map((p) => (
              <button
                key={p.pet_ref}
                type="button"
                onClick={() => onPet(p.pet_ref)}
                aria-pressed={p.pet_ref === petRef}
                className={cn(
                  'flex h-9 items-center gap-2 rounded-full border px-3 text-sm transition',
                  p.pet_ref === petRef ? 'border-zinc-900 bg-white font-medium shadow-xs' : 'border-transparent text-zinc-500 hover:bg-white',
                )}
              >
                <span className="grid size-6 place-items-center rounded-full bg-amber-100 text-xs font-semibold text-amber-900">
                  {p.name[0]}
                </span>
                {p.name}
                <span className="hidden text-xs font-normal text-zinc-500 sm:inline">
                  {p.breed}, {p.age_years} ans
                </span>
              </button>
            ))}
          </div>

          {!entries.length ? (
            <div className="flex flex-col items-center gap-6 pt-6 text-center sm:pt-12">
              <span className="grid size-14 place-items-center rounded-2xl bg-zinc-900 text-white shadow-lg">
                <PawPrint className="size-7" />
              </span>
              <div>
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                  Une question sur {pet?.name ?? 'votre chien'} ?
                </h1>
                <p className="mt-1.5 text-sm text-zinc-500">
                  L’assistant lit les données du collier et répond avec des sources. Il ne remplace pas le vétérinaire.
                </p>
              </div>
              <div className="grid w-full gap-2 sm:grid-cols-2">
                {examples.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onScenario(s)}
                    className="flex flex-col items-start gap-0.5 rounded-xl border bg-white px-3.5 py-3 text-left shadow-xs transition hover:border-zinc-300 hover:shadow-sm"
                  >
                    <span className="text-xs font-medium text-zinc-500">{s.label}</span>
                    <span className="text-sm text-zinc-900">{s.user_message}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {entries.map((e) => (
            <div key={e.id} className="flex flex-col gap-3">
              {e.graph === 'turn' ? (
                <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-zinc-900 px-4 py-2.5 text-[15px] leading-relaxed text-white">
                  {e.message}
                </p>
              ) : (
                <p className="self-center text-xs text-zinc-500">Dossier vétérinaire demandé</p>
              )}
              <div className="flex max-w-[92%] gap-2.5 sm:max-w-[85%]">
                <Avatar />
                <div className="min-w-0 flex-1">
                  <Reply entry={e} onHandoff={onHandoff} />
                </div>
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>
      </div>

      <div className="border-t bg-white/90 backdrop-blur">
        {entries.length ? (
          <div className="mx-auto max-w-[720px] overflow-x-auto px-4 pt-2.5 [scrollbar-width:none] sm:px-6">
            <div className="flex w-max gap-1.5">
              {examples.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onScenario(s)}
                  className="h-8 rounded-full border bg-white px-3 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <form onSubmit={submit} className="mx-auto flex max-w-[720px] items-end gap-2 px-4 py-3 sm:px-6">
          <label htmlFor="composer" className="sr-only">
            Votre message
          </label>
          <textarea
            id="composer"
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onEnter}
            placeholder={`Écrivez à propos de ${pet?.name ?? 'votre chien'}…`}
            className="field-sizing-content max-h-36 min-h-11 flex-1 resize-none rounded-2xl border bg-zinc-50 px-4 py-2.5 text-[15px] outline-none focus:border-zinc-400 focus:bg-white"
          />
          <button
            type="submit"
            disabled={!draft.trim() || busy}
            aria-label="Envoyer"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-zinc-900 text-white transition hover:bg-zinc-700 disabled:bg-zinc-300"
          >
            <ArrowUp className="size-5" />
          </button>
        </form>
      </div>
    </div>
  )
}
