import { ACTOR } from '@/app/labels'
import { cn } from '@/lib/utils'

const WHO: { actor: keyof typeof ACTOR; text: string }[] = [
  { actor: 'ai', text: 'un modèle de langage, payant à l’appel' },
  { actor: 'rule', text: 'une règle écrite, toujours la même réponse' },
  { actor: 'search', text: 'la recherche dans les fiches santé' },
  { actor: 'text', text: 'un texte relu à l’avance, sans IA' },
]

const STATES: { cls: string; text: string }[] = [
  { cls: 'border-violet-500 bg-violet-50', text: 'en cours' },
  { cls: 'border-emerald-300 bg-white', text: 'faite' },
  { cls: 'border-amber-300 bg-amber-50', text: 'a changé la suite' },
  { cls: 'border-red-300 bg-red-50', text: 'rejetée ou en panne' },
  { cls: 'border-dashed border-zinc-300 bg-zinc-50 opacity-60', text: 'pas appelée' },
]

/** Comment lire le parcours : qui fait chaque étape, et ce que veulent dire les couleurs. */
export function Legend() {
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Qui fait l’étape</h3>
        <ul className="flex flex-col gap-1.5">
          {WHO.map((w) => (
            <li key={w.actor} className="flex items-center gap-2.5 text-sm text-zinc-700">
              <span className={cn('w-20 shrink-0 rounded px-1.5 py-px text-center text-[11px] font-medium', ACTOR[w.actor].chip)}>
                {ACTOR[w.actor].label}
              </span>
              {w.text}
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">État</h3>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {STATES.map((s) => (
            <li key={s.text} className="flex items-center gap-2 text-sm text-zinc-700">
              <span className={cn('h-3.5 w-5 shrink-0 rounded border', s.cls)} />
              {s.text}
            </li>
          ))}
        </ul>
      </section>
      <p className="text-xs leading-relaxed text-zinc-500">
        Le trait noir montre le chemin pris. Aucune réponse rédigée par l’IA ne part sans passer par « Vérifier ».
      </p>
    </div>
  )
}
