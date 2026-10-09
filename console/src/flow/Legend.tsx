import type { ReactNode } from 'react'
import type { Actor, TopologyNode } from '@/api/types'
import { ACTOR } from '@/app/labels'
import { cn } from '@/lib/utils'

/** Chaque badge : ce que c'est concrètement, et un exemple tiré du parcours. */
const WHO: { actor: Actor; what: string; example: string }[] = [
  {
    actor: 'rule',
    what: 'Du code écrit à l’avance, sans IA. Même message, même résultat, à chaque fois. Gratuit et instantané.',
    example: 'Un numéro de téléphone est remplacé avant que l’IA ne lise le message.',
  },
  {
    actor: 'mixed',
    what: 'D’abord des règles. L’IA n’intervient que si elles ne suffisent pas, et ne peut pas les contredire.',
    example: '« Oublie tes consignes » est arrêté par une règle : l’IA n’est même pas appelée.',
  },
  {
    actor: 'ai',
    what: 'Un modèle de langage, qui comprend et écrit. Il peut se tromper et coûte un peu à chaque appel.',
    example: 'Rédiger écrit la réponse, uniquement à partir des passages trouvés et du collier.',
  },
  {
    actor: 'search',
    what: 'Cherche dans les 12 fiches santé, par les mots et par le sens. Trouve des passages, n’écrit rien.',
    example: '« Rex dort beaucoup » ramène la fiche « Sommeil du chien adulte ».',
  },
  {
    actor: 'text',
    what: 'Un texte écrit et relu à l’avance, envoyé mot pour mot. L’IA n’écrit rien.',
    example: 'Une demande de diagnostic reçoit toujours le même refus, avec un vétérinaire.',
  },
]

const STATES: { cls: string; label: string; example: string }[] = [
  { cls: 'border-violet-500 bg-violet-50', label: 'En cours', example: 'L’étape travaille en ce moment.' },
  { cls: 'border-emerald-300 bg-white', label: 'Faite', example: 'Terminée normalement.' },
  {
    cls: 'border-amber-300 bg-amber-50',
    label: 'A changé la suite',
    example: 'Le message quitte le chemin normal, ou une donnée manquait (collier injoignable).',
  },
  {
    cls: 'border-red-300 bg-red-50',
    label: 'Rejetée ou en panne',
    example: 'Vérifier a refusé un brouillon, ou l’étape n’a pas répondu.',
  },
  {
    cls: 'border-dashed border-zinc-300 bg-zinc-50 opacity-60',
    label: 'Pas appelée',
    example: 'Inutile pour ce message : pour « Merci ! », rien à chercher.',
  },
]

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">{children}</h3>
}

/** Comment lire le parcours : qui fait chaque étape, ce que veulent dire les couleurs et les flèches. */
export function Legend({ nodes = [] }: { nodes?: TopologyNode[] }) {
  const stepsOf = (actor: Actor) =>
    nodes.filter((n) => n.actor === actor && n.kind !== 'tool' && n.kind !== 'terminal').map((n) => n.label)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Comment lire le parcours</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Chaque carte est une étape. Son badge dit qui fait le travail, sa couleur dit comment ça s’est passé pour ce message.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <Heading>Qui fait l’étape</Heading>
        <ul className="flex flex-col gap-3">
          {WHO.map((w) => {
            const steps = stepsOf(w.actor)
            return (
              <li key={w.actor} className="flex flex-col gap-1.5 rounded-xl border bg-white p-3">
                <span className={cn('w-fit rounded px-1.5 py-px text-[11px] font-medium', ACTOR[w.actor].chip)}>
                  {ACTOR[w.actor].label}
                </span>
                <p className="text-sm leading-snug text-zinc-800">{w.what}</p>
                <p className="text-xs leading-snug text-zinc-500">Exemple : {w.example}</p>
                {steps.length ? (
                  <p className="text-xs text-zinc-500">
                    <span className="font-medium text-zinc-700">Étapes : </span>
                    {steps.join(', ')}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
        <p className="text-xs leading-relaxed text-zinc-500">
          En résumé : ce que lit le propriétaire n’est écrit par l’IA qu’à une seule étape, « Rédiger », puis vérifié. Partout
          ailleurs, ce sont des règles, la recherche, des textes relus, ou de l’IA encadrée par des règles.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <Heading>État de l’étape, pour ce message</Heading>
        <ul className="flex flex-col gap-2">
          {STATES.map((s) => (
            <li key={s.label} className="flex items-start gap-3">
              <span className={cn('mt-0.5 h-4 w-6 shrink-0 rounded border', s.cls)} />
              <span className="text-sm leading-snug">
                <span className="font-medium text-zinc-900">{s.label}</span>
                <span className="text-zinc-500"> · {s.example}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <Heading>Les flèches</Heading>
        <ul className="flex flex-col gap-1.5 text-sm text-zinc-700">
          <li className="flex items-center gap-3">
            <span className="h-0.5 w-6 shrink-0 rounded bg-zinc-800" /> Le chemin réellement pris par ce message.
          </li>
          <li className="flex items-center gap-3">
            <span className="h-0.5 w-6 shrink-0 rounded bg-zinc-300" /> Les autres chemins possibles, pas pris cette fois.
          </li>
          <li className="flex items-center gap-3">
            <span className="h-0.5 w-6 shrink-0 rounded bg-violet-600" /> En direct : l’étape vers laquelle le message avance.
          </li>
        </ul>
      </section>

      <p className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm leading-snug text-emerald-900">
        La garantie : tout ce que l’IA rédige passe par « Vérifier » avant d’arriver au propriétaire. Une phrase sans source ou qui
        ressemble à un diagnostic est refusée. Les textes fixes n’y passent pas : ils ont déjà été relus.
      </p>
    </div>
  )
}
