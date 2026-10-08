import { ArrowUp, ChevronRight, FileText, PawPrint, Siren, SquarePen, Stethoscope, X, Zap } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Pet, Scenario } from '@/api/types'
import { FAULTS, TONE, verdict } from '@/app/labels'
import { href } from '@/app/route'
import { liveStatus, type Entry } from '@/app/store'
import { HandoffPanel } from '@/components/HandoffPanel'
import { PetAvatar } from '@/components/PetAvatar'
import { cn } from '@/lib/utils'
import { fmtMs } from '@/run/status'

const DOT: Record<string, string> = {
  ok: 'bg-emerald-500',
  redirected: 'bg-amber-400',
  degraded: 'bg-amber-400',
  rejected: 'bg-red-500',
  error: 'bg-red-500',
}

/** Les étapes du tour en petits points : on voit avancer le parcours sans quitter la discussion. */
function LiveStrip({ entry, labels, onOpen }: { entry: Entry; labels: Record<string, string>; onOpen: () => void }) {
  const steps = entry.run.attempts.filter((a) => a.node !== 'gate')
  const current = steps.at(-1)
  const live = entry.run.phase === 'running'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-2 flex w-full items-center gap-2 rounded-xl border bg-white/70 px-3 py-2 text-left text-xs text-zinc-600 transition hover:bg-white"
    >
      <span className="flex shrink-0 items-center gap-1" aria-hidden>
        {steps.map((a) => (
          <span
            key={`${a.node}-${a.attempt}`}
            className={cn('size-1.5 rounded-full', a.status ? DOT[a.status] : 'animate-pulse bg-violet-500')}
          />
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {live && current ? labels[current.node] ?? current.node : `${steps.length} étapes`}
      </span>
      <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-zinc-800">
        Parcours <ChevronRight className="size-3.5" />
      </span>
    </button>
  )
}

function Reply({
  entry,
  onHandoff,
}: {
  entry: Entry
  onHandoff: (e: Entry) => void
}) {
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
      </div>
    )
  }
  const r = run.response
  if (!r) return null
  const urgent = r.escalation.urgency === 'high'
  return (
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
            onClick={(e) => {
              e.stopPropagation()
              setSources(!sources)
            }}
            aria-expanded={sources}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-900"
          >
            {r.citations.length} source{r.citations.length > 1 ? 's' : ''} {sources ? '▴' : '▾'}
          </button>
          {sources ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {r.citations.map((c) => (
                <li key={c.source_id}>
                  {c.source_id === 'telemetry' || c.source_id === 'message' ? (
                    <span className="block rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-600">
                      <span className="font-medium text-zinc-800">
                        {c.source_id === 'telemetry' ? 'Collier · ' : 'Votre message · '}
                      </span>
                      {c.snippet}
                    </span>
                  ) : (
                    <a
                      href={href('knowledge', 'fiches', c.source_id)}
                      onClick={(e) => e.stopPropagation()}
                      className="block rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-100"
                    >
                      <span className="font-medium text-zinc-800">Fiche santé · </span>
                      {c.snippet}
                      <span className="ml-1 font-medium text-violet-700">voir dans la base ›</span>
                    </a>
                  )}
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
            onClick={(e) => {
              e.stopPropagation()
              onHandoff(entry)
            }}
            className="inline-flex h-9 items-center gap-2 rounded-xl border bg-white px-3.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            <FileText className="size-4" /> Préparer le dossier
          </button>
        </div>
      ) : null}
    </div>
  )
}

function FaultMenu({
  all,
  active,
  onChange,
}: {
  all: string[]
  active: string[]
  onChange: (f: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Simuler une panne"
        title="Simuler une panne"
        className={cn(
          'relative grid size-11 place-items-center rounded-full border transition',
          active.length ? 'border-red-300 bg-red-50 text-red-700' : 'bg-white text-zinc-600 hover:bg-zinc-50',
        )}
      >
        <Zap className="size-5" />
        {active.length ? (
          <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-red-600 text-[10px] font-semibold text-white">
            {active.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="animate-in fade-in slide-in-from-bottom-2 absolute bottom-14 left-0 z-30 w-[min(320px,calc(100vw-2rem))] rounded-2xl border bg-white p-2 shadow-xl duration-150">
          <p className="px-2 pt-1 pb-2 text-xs font-semibold text-zinc-900">
            Simuler une panne
            <span className="block font-normal text-zinc-500">Pour le prochain message seulement.</span>
          </p>
          {all.map((f) => {
            const on = active.includes(f)
            return (
              <label key={f} className={cn('flex items-start gap-2.5 rounded-xl px-2 py-1.5', on ? 'bg-red-50' : 'hover:bg-zinc-50')}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onChange(on ? active.filter((x) => x !== f) : [...active, f])}
                  className="mt-0.5 size-4 accent-red-600"
                />
                <span className="flex flex-col">
                  <span className="text-sm text-zinc-900">{FAULTS[f]?.label ?? f}</span>
                  <span className="text-xs text-zinc-500">Attendu : {FAULTS[f]?.effect}</span>
                </span>
              </label>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function ChatPane({
  entries,
  pets,
  petRef,
  onPet,
  scenarios,
  allFaults,
  faults,
  onFaults,
  selectedId,
  onSelect,
  showStrip,
  onOpenFlow,
  labels,
  onSend,
  onScenario,
  onHandoff,
  onReset,
}: {
  entries: Entry[]
  pets: Pet[]
  petRef: string
  onPet: (ref: string) => void
  scenarios: Scenario[]
  allFaults: string[]
  faults: string[]
  onFaults: (f: string[]) => void
  selectedId: string | null
  onSelect: (e: Entry) => void
  /** Le parcours n'est pas visible à côté : on montre un bandeau d'avancement sous chaque réponse. */
  showStrip: boolean
  onOpenFlow: (e: Entry) => void
  labels: Record<string, string>
  onSend: (message: string) => void
  onScenario: (s: Scenario) => void
  onHandoff: (e: Entry) => void
  /** Vide la discussion : l'historique envoyé à l'assistant repart de zéro. */
  onReset: () => void
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
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
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
                <PetAvatar petRef={p.pet_ref} name={p.name} className="size-6 text-xs" />
                {p.name}
                <span className="hidden text-xs font-normal text-zinc-500 sm:inline">
                  {p.breed}, {p.age_years} ans
                </span>
              </button>
            ))}
            {entries.length ? (
              <button
                type="button"
                onClick={onReset}
                disabled={busy}
                title="Repartir d’une conversation vide"
                className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-full border bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                <SquarePen className="size-4" />
                <span className="hidden sm:inline">Nouvelle conversation</span>
              </button>
            ) : null}
          </div>

          {!entries.length ? (
            <div className="flex flex-col items-center gap-6 pt-4 text-center sm:pt-8">
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

          {entries.map((e) => {
            const selected = e.id === selectedId
            return (
              <div key={e.id} className="flex flex-col gap-2">
                {e.graph === 'turn' ? (
                  <div className="flex max-w-[85%] flex-col items-end gap-1 self-end">
                    <p className="rounded-2xl rounded-br-md bg-zinc-900 px-4 py-2.5 text-[15px] leading-relaxed text-white">
                      {e.message}
                    </p>
                    {e.faults.length ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-red-700">
                        <Zap className="size-3" />
                        {e.faults.map((f) => FAULTS[f]?.label ?? f).join(' · ')}
                      </span>
                    ) : null}
                    {e.parent ? (
                      <span className="text-[11px] font-medium text-violet-700">
                        Relancé depuis « {labels[e.parent.node] ?? e.parent.node} », sans panne
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className="self-center text-xs text-zinc-500">Dossier vétérinaire demandé</p>
                )}
                <div className="flex max-w-[94%] gap-2.5 sm:max-w-[88%]">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-900 text-white" aria-hidden>
                    <PawPrint className="size-4" />
                  </span>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(e)}
                    onKeyDown={(k) => {
                      if (k.code === 'Enter') onSelect(e)
                    }}
                    aria-pressed={selected}
                    className={cn(
                      'min-w-0 flex-1 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
                      // On ne marque la sélection que s'il y a un choix à faire entre plusieurs échanges.
                      !showStrip && selected && entries.length > 1 && 'ring-2 ring-violet-500/40 ring-offset-4 ring-offset-zinc-50',
                    )}
                  >
                    <Reply entry={e} onHandoff={onHandoff} />
                    {e.run.phase === 'done' && (e.run.response || e.run.summary) ? (
                      <Meta entry={e} />
                    ) : null}
                    {showStrip ? <LiveStrip entry={e} labels={labels} onOpen={() => onOpenFlow(e)} /> : null}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={end} />
        </div>
      </div>

      <div className="border-t bg-white/90 backdrop-blur">
        {faults.length ? (
          <div className="mx-auto flex max-w-[720px] flex-wrap gap-1.5 px-4 pt-2.5 sm:px-6">
            {faults.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => onFaults(faults.filter((x) => x !== f))}
                className="inline-flex h-7 items-center gap-1 rounded-full bg-red-50 px-2.5 text-xs font-medium text-red-800 ring-1 ring-red-600/20"
              >
                <Zap className="size-3" /> {FAULTS[f]?.label ?? f} <X className="size-3" />
              </button>
            ))}
          </div>
        ) : entries.length ? (
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
          <FaultMenu all={allFaults} active={faults} onChange={onFaults} />
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
            className="field-sizing-content max-h-36 min-h-11 min-w-0 flex-1 resize-none rounded-2xl border bg-zinc-50 px-4 py-2.5 text-[15px] outline-none focus:border-zinc-400 focus:bg-white"
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

function Meta({ entry }: { entry: Entry }) {
  const r = entry.run.response
  const v = r ? verdict(r) : { label: 'Dossier vérifié', tone: 'ok' as const }
  const ms = r?.metadata.latency_ms ?? entry.run.attempts.at(-1)?.endTs ?? 0
  return (
    <div className="mt-2 flex items-center gap-2 px-1 text-xs text-zinc-500">
      <span className={cn('rounded-full px-2 py-0.5 font-medium ring-1', TONE[v.tone])}>{v.label}</span>
      <span className="tabular-nums">{fmtMs(ms)}</span>
    </div>
  )
}
