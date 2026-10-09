import { ClipboardCheck, Gauge } from 'lucide-react'
import type { ComponentProps } from 'react'
import { href } from '@/app/route'
import { Tabs } from '@/components/Tabs'
import { EvalsTab } from './EvalsTab'
import { ScenariosTab } from './ScenariosTab'
import type { EvalState } from './useEvals'

const TABS = [
  { id: 'evaluations', label: 'Évaluations', icon: Gauge },
  { id: 'scenarios', label: 'Scénarios', icon: ClipboardCheck },
]

/** Peut-on lui faire confiance ? Des chiffres et des cas de référence. */
export function QualityView({
  tab,
  evals,
  onStartEvals,
  scenarios,
}: {
  tab: string | null
  evals: EvalState
  onStartEvals: () => void
  scenarios: ComponentProps<typeof ScenariosTab>
}) {
  const current = TABS.some((t) => t.id === tab) ? (tab as string) : 'evaluations'
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs tabs={TABS} current={current} hrefOf={(t) => href('quality', t)} />
      <div className="min-h-0 flex-1">
        {current === 'evaluations' ? <EvalsTab evals={evals} onStart={onStartEvals} /> : null}
        {current === 'scenarios' ? <ScenariosTab {...scenarios} /> : null}
      </div>
    </div>
  )
}
