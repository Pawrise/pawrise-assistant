import { Check, Play, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/** Ce que la console sait faire pour une étape de démo. */
export interface DemoActions {
  /** Envoie un scénario dans la conversation (sans ses pannes, sauf `faults`). */
  scenario: (id: string, faults?: string[]) => void
  /** Envoie un message libre dans la conversation. */
  say: (message: string, opts?: { pet?: string; faults?: string[] }) => void
  /** Prépare le dossier vétérinaire du dernier échange qui en propose un. */
  handoff: () => boolean
  open: (view: 'conversation' | 'knowledge' | 'quality', tab?: string, id?: string) => void
}

interface Step {
  id: string
  title: string
  watch: string
  run: (a: DemoActions) => void | boolean
}

const GROUPS: { title: string; hint: string; steps: Step[] }[] = [
  {
    title: 'Répondre juste',
    hint: 'Conversation',
    steps: [
      {
        id: 'sourced',
        title: 'Une réponse sourcée',
        watch: 'Les phrases d’attente défilent, les étapes s’allument, la réponse cite ses fiches et porte « Vérifiée ».',
        run: (a) => a.scenario('A'),
      },
      {
        id: 'pii',
        title: 'Les données perso masquées',
        watch: 'Touchez « Masquer les données perso » : le numéro est remplacé avant tout appel à l’IA.',
        run: (a) => a.say('Rex dort beaucoup, rappelez-moi au 06 12 34 56 78'),
      },
      {
        id: 'alert',
        title: 'Une alerte du collier',
        watch: 'La réponse reprend les chiffres de Nala et propose un vétérinaire (règle R-ESC-03).',
        run: (a) => a.scenario('B'),
      },
      {
        id: 'handoff',
        title: 'Le dossier pour le vétérinaire',
        watch: 'Un second parcours collecte, date, synthétise et vérifie le dossier.',
        run: (a) => a.handoff(),
      },
    ],
  },
  {
    title: 'Se protéger',
    hint: 'Conversation',
    steps: [
      {
        id: 'urgent',
        title: 'L’urgence passe avant tout',
        watch: 'Texte fixe en rouge en 2 s environ : ni recherche ni rédaction.',
        run: (a) => a.scenario('U'),
      },
      {
        id: 'diagnosis',
        title: 'Le refus de diagnostic',
        watch: 'Le message n’atteint jamais l’IA qui rédige : texte fixe et vétérinaire.',
        run: (a) => a.scenario('C'),
      },
      {
        id: 'jailbreak',
        title: 'Le détournement',
        watch: 'L’assistant ne change pas de rôle, sans proposer de vétérinaire.',
        run: (a) => a.scenario('D'),
      },
      {
        id: 'retry',
        title: 'Un brouillon fautif est rejeté',
        watch: '« Vérifier » rejette deux fois, puis réponse prudente. Ensuite : « Relancer depuis ici » sur Rédiger, sans panne.',
        run: (a) => a.scenario('F', ['draft_diagnostic', 'draft_ungrounded']),
      },
      {
        id: 'down',
        title: 'L’IA tombe en panne',
        watch: 'Rien n’est inventé : réponse prudente et vétérinaire.',
        run: (a) => a.scenario('A', ['llm_down']),
      },
    ],
  },
  {
    title: 'Justifier',
    hint: 'Connaissances',
    steps: [
      {
        id: 'search',
        title: 'D’où vient la réponse',
        watch: 'Les passages trouvés par les mots et par le sens, puis les 5 gardés avec leur pertinence.',
        run: (a) => a.open('knowledge', 'recherche', 'Rex dort beaucoup depuis quelques jours'),
      },
      {
        id: 'grounding',
        title: 'Sans fiche, pas de réponse',
        watch: 'Désactivez les passages de la fiche, reposez la question : réponse prudente. Réactivez-les.',
        run: (a) => a.open('knowledge', 'fiches', 'sommeil-chien-adulte'),
      },
      {
        id: 'collar',
        title: 'Les données du collier changent la réponse',
        watch: 'Montez la baisse d’activité de Rex à 40 %, appliquez, puis demandez « Rex bouge moins, c’est grave ? ».',
        run: (a) => a.open('knowledge', 'chiens'),
      },
    ],
  },
  {
    title: 'Prouver',
    hint: 'Qualité',
    steps: [
      {
        id: 'evals',
        title: '48 cas d’évaluation',
        watch: 'Les indicateurs du projet face à leurs cibles, dont zéro faux diagnostic.',
        run: (a) => a.open('quality', 'evaluations'),
      },
      {
        id: 'audit',
        title: 'Le journal d’audit',
        watch: 'Chaque réponse de la démo est là, avec son parcours et son escalade.',
        run: (a) => a.open('quality', 'journal'),
      },
    ],
  },
]

const KEY = 'pawrise-demo-done'

function loadDone(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

/** Le fil d'une démo : chaque fonctionnalité, ce qu'il faut observer, et un bouton pour la montrer. */
export function DemoGuide({ actions, onDone }: { actions: DemoActions; onDone: () => void }) {
  const [done, setDone] = useState<string[]>(loadDone)
  const [hint, setHint] = useState<string | null>(null)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(done))
    } catch {
      // stockage indisponible : la liste reste valable pour cette visite
    }
  }, [done])
  const total = GROUPS.reduce((n, g) => n + g.steps.length, 0)

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Démo guidée</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            {done.length}/{total} fonctionnalités montrées. Chaque bouton lance l’action et ferme ce panneau.
          </p>
        </div>
        {done.length ? (
          <button
            type="button"
            onClick={() => setDone([])}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs text-zinc-600 hover:bg-zinc-50"
          >
            <RotateCcw className="size-3.5" /> Remettre à zéro
          </button>
        ) : null}
      </header>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(done.length / total) * 100}%` }} />
      </div>
      {hint ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{hint}</p> : null}
      {GROUPS.map((g) => (
        <section key={g.title} className="flex flex-col gap-2">
          <h3 className="flex items-baseline justify-between text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            {g.title}
            <span className="font-normal tracking-normal normal-case">{g.hint}</span>
          </h3>
          <ol className="flex flex-col gap-1.5">
            {g.steps.map((s) => {
              const shown = done.includes(s.id)
              return (
                <li key={s.id} className={cn('flex items-start gap-3 rounded-xl border bg-white p-3', shown && 'bg-emerald-50/50')}>
                  <span
                    className={cn(
                      'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border',
                      shown ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-zinc-300',
                    )}
                  >
                    {shown ? <Check className="size-3" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{s.title}</span>
                    <span className="block text-xs leading-relaxed text-zinc-500">{s.watch}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (s.run(actions) === false) {
                        setHint('Il faut d’abord une réponse qui propose un vétérinaire : montrez « Une alerte du collier ».')
                        return
                      }
                      setHint(null)
                      setDone((d) => (d.includes(s.id) ? d : [...d, s.id]))
                      onDone()
                    }}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-zinc-900 px-2.5 text-xs font-medium text-white hover:bg-zinc-700"
                  >
                    <Play className="size-3" /> Montrer
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}
