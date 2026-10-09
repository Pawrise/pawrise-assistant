import type { ReactNode } from 'react'
import type { Actor } from '@/api/types'
import { ACTOR } from '@/app/labels'
import { cn } from '@/lib/utils'

const WHO: { actor: Actor; text: string }[] = [
  { actor: 'rule', text: 'Code écrit à l’avance. Prévisible, sans IA.' },
  { actor: 'mixed', text: 'Règles d’abord, IA seulement si besoin.' },
  { actor: 'ai', text: 'Comprend et rédige. Payant, peut se tromper.' },
  { actor: 'search', text: 'Trouve des passages dans les fiches santé.' },
  { actor: 'text', text: 'Phrase relue, envoyée telle quelle.' },
]

const STATES: { cls: string; label: string }[] = [
  { cls: 'border-violet-500 bg-violet-50', label: 'En cours' },
  { cls: 'border-emerald-300 bg-white', label: 'Faite' },
  { cls: 'border-amber-300 bg-amber-50', label: 'A changé la suite' },
  { cls: 'border-red-300 bg-red-50', label: 'Rejetée ou en panne' },
  { cls: 'border-dashed border-zinc-300 bg-zinc-50', label: 'Pas appelée' },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">{title}</h3>
      {children}
    </section>
  )
}

/** Comment lire le parcours, en un coup d'œil. */
export function Legend() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-base font-semibold">Comment lire</h2>

      <Section title="Qui fait l’étape">
        <ul className="flex flex-col gap-2">
          {WHO.map((w) => (
            <li key={w.actor} className="grid grid-cols-[92px_1fr] items-center gap-3 text-sm">
              <span className={cn('w-fit rounded px-1.5 py-px text-[11px] font-medium', ACTOR[w.actor].chip)}>
                {ACTOR[w.actor].label}
              </span>
              <span className="text-zinc-700">{w.text}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Couleur de l’étape">
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-zinc-700">
          {STATES.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              <span className={cn('h-3.5 w-5 shrink-0 rounded border', s.cls)} />
              {s.label}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Flèches">
        <ul className="flex flex-col gap-1.5 text-sm text-zinc-700">
          <li className="flex items-center gap-3">
            <span className="h-0.5 w-6 shrink-0 rounded bg-zinc-800" /> Chemin pris
          </li>
          <li className="flex items-center gap-3">
            <span className="h-0.5 w-6 shrink-0 rounded bg-zinc-300" /> Chemin possible, pas pris
          </li>
        </ul>
      </Section>

      <p className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
        Tout texte écrit par l’IA passe par « Vérifier » avant d’être envoyé.
      </p>
    </div>
  )
}
