import { ClipboardCheck, Gauge, ScrollText } from 'lucide-react'
import type { ComponentProps } from 'react'
import type { Info, Pet } from '@/api/types'
import { href } from '@/app/route'
import { Tabs } from '@/components/Tabs'
import { EvalsTab } from './EvalsTab'
import { JournalTab } from './JournalTab'
import { ScenariosTab } from './ScenariosTab'
import type { EvalState } from './useEvals'

const TABS = [
  { id: 'evaluations', label: 'Évaluations', icon: Gauge },
  { id: 'scenarios', label: 'Scénarios', icon: ClipboardCheck },
  { id: 'journal', label: 'Journal d’audit', icon: ScrollText },
]

/** Peut-on lui faire confiance ? Des chiffres, des cas de référence, une trace de chaque réponse. */
export function QualityView({
  tab,
  info,
  pets,
  labels,
  evals,
  onStartEvals,
  scenarios,
}: {
  tab: string | null
  info: Info | null
  pets: Pet[]
  labels: Record<string, string>
  evals: EvalState
  onStartEvals: () => void
  scenarios: ComponentProps<typeof ScenariosTab>
}) {
  const current = TABS.some((t) => t.id === tab) ? (tab as string) : 'evaluations'
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs tabs={TABS} current={current} hrefOf={(t) => href('quality', t)} />
      <div className="min-h-0 flex-1">
        {current === 'evaluations' ? <EvalsTab evals={evals} onStart={onStartEvals} info={info} /> : null}
        {current === 'scenarios' ? <ScenariosTab {...scenarios} /> : null}
        {current === 'journal' ? <JournalTab pets={pets} labels={labels} /> : null}
      </div>
    </div>
  )
}
