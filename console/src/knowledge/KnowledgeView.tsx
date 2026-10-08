import { BookOpen, Dog, Scale, Search } from 'lucide-react'
import { href } from '@/app/route'
import { Tabs } from '@/components/Tabs'
import { DocsTab } from './DocsTab'
import { PetsTab } from './PetsTab'
import { RulesTab } from './RulesTab'
import { SearchTab } from './SearchTab'

const TABS = [
  { id: 'fiches', label: 'Fiches santé', icon: BookOpen },
  { id: 'recherche', label: 'Tester la recherche', icon: Search },
  { id: 'chiens', label: 'Chiens', icon: Dog },
  { id: 'regles', label: 'Règles et textes', icon: Scale },
]

/** Sur quoi s'appuie l'assistant : on le voit, on le modifie, et la réponse suivante change. */
export function KnowledgeView({ tab, id, cited }: { tab: string | null; id: string | null; cited: Record<string, number> }) {
  const current = TABS.some((t) => t.id === tab) ? (tab as string) : 'fiches'
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs tabs={TABS} current={current} hrefOf={(t) => href('knowledge', t)} />
      <div className="min-h-0 flex-1">
        {current === 'fiches' ? <DocsTab focus={id} cited={cited} /> : null}
        {current === 'recherche' ? <SearchTab key={id ?? ''} initial={id} /> : null}
        {current === 'chiens' ? <PetsTab /> : null}
        {current === 'regles' ? <RulesTab /> : null}
      </div>
    </div>
  )
}
