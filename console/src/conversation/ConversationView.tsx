import { MessageCircle, Workflow } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GraphName, Pet, Scenario, Topology } from '@/api/types'
import { useMedia } from '@/app/route'
import type { Entry } from '@/app/store'
import { ChatPane } from '@/chat/ChatPane'
import { Sheet } from '@/components/Sheet'
import { FlowPane } from '@/flow/FlowPane'
import { cn } from '@/lib/utils'

/**
 * La discussion et son parcours, ensemble.
 * - Ordinateur (≥ 1024 px) : côte à côte ; l'échange sélectionné s'affiche en direct à droite.
 * - Tablette : une bascule Discussion | Parcours sur le même écran, le direct continue.
 * - Téléphone : un bandeau d'avancement sous chaque réponse ouvre le parcours en plein écran.
 */
export function ConversationView({
  entries,
  topologies,
  pets,
  petRef,
  onPet,
  scenarios,
  allFaults,
  faults,
  onFaults,
  onSend,
  onScenario,
  onHandoff,
  onRerun,
  onReset,
}: {
  entries: Entry[]
  topologies: Partial<Record<GraphName, Topology>>
  pets: Pet[]
  petRef: string
  onPet: (ref: string) => void
  scenarios: Scenario[]
  allFaults: string[]
  faults: string[]
  onFaults: (f: string[]) => void
  onSend: (message: string) => void
  onScenario: (s: Scenario) => void
  onHandoff: (e: Entry) => void
  onRerun: (entry: Entry, node: string, attempt: number) => void
  onReset: () => void
}) {
  const wide = useMedia('(min-width: 1024px)')
  const tablet = useMedia('(min-width: 768px)')
  const [pane, setPane] = useState<'chat' | 'flow'>('chat')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)

  // Un nouveau message devient l'échange suivi.
  const count = useRef(entries.length)
  useEffect(() => {
    if (entries.length > count.current) setSelectedId(entries.at(-1)?.id ?? null)
    count.current = entries.length
  }, [entries])

  const selected = entries.find((e) => e.id === selectedId) ?? entries.at(-1) ?? null
  const labels = useMemo(
    () => Object.fromEntries((topologies.turn?.nodes ?? []).concat(topologies.handoff?.nodes ?? []).map((n) => [n.id, n.label])),
    [topologies],
  )
  const live = entries.some((e) => e.run.phase === 'running')

  const chat = (
    <ChatPane
      entries={entries}
      pets={pets}
      petRef={petRef}
      onPet={onPet}
      scenarios={scenarios}
      allFaults={allFaults}
      faults={faults}
      onFaults={onFaults}
      selectedId={selected?.id ?? null}
      onSelect={(e) => setSelectedId(e.id)}
      showStrip={!wide}
      onOpenFlow={(e) => {
        setSelectedId(e.id)
        if (tablet) setPane('flow')
        else setSheet(true)
      }}
      labels={labels}
      onSend={onSend}
      onScenario={onScenario}
      onHandoff={onHandoff}
      onReset={() => {
        setSelectedId(null)
        setPane('chat')
        setSheet(false)
        onReset()
      }}
    />
  )
  const flow = <FlowPane entry={selected} topologies={topologies} onRerun={onRerun} />

  if (wide) {
    return (
      <div className="grid h-full min-h-0 grid-cols-[minmax(360px,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-h-0 border-r">{chat}</div>
        <div className="min-h-0">{flow}</div>
      </div>
    )
  }

  if (tablet) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex justify-center border-b bg-white py-2">
          <div role="tablist" aria-label="Affichage" className="flex rounded-xl bg-zinc-100 p-1">
            {(
              [
                ['chat', 'Discussion', MessageCircle],
                ['flow', 'Parcours', Workflow],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={pane === id}
                onClick={() => setPane(id)}
                className={cn(
                  'relative flex h-8 items-center gap-2 rounded-lg px-4 text-sm transition',
                  pane === id ? 'bg-white font-medium shadow-xs' : 'text-zinc-600',
                )}
              >
                <Icon className="size-4" />
                {label}
                {id === 'flow' && live && pane !== 'flow' ? (
                  <span className="size-1.5 animate-pulse rounded-full bg-violet-500" />
                ) : null}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1">{pane === 'chat' ? chat : flow}</div>
      </div>
    )
  }

  return (
    <>
      {chat}
      <Sheet open={sheet} onClose={() => setSheet(false)} label="Parcours" size="full">
        <FlowPane entry={selected} topologies={topologies} onRerun={onRerun} onClose={() => setSheet(false)} />
      </Sheet>
    </>
  )
}
