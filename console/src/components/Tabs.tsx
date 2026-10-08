import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Les onglets d'une vue : défilants sur téléphone, centrés au-delà. */
export function Tabs({
  tabs,
  current,
  hrefOf,
}: {
  tabs: { id: string; label: string; icon: LucideIcon }[]
  current: string
  hrefOf: (id: string) => string
}) {
  return (
    <nav aria-label="Onglets" className="border-b bg-white">
      <div className="mx-auto flex max-w-[1100px] gap-1 overflow-x-auto px-3 [scrollbar-width:none] sm:px-5">
        {tabs.map((t) => (
          <a
            key={t.id}
            href={hrefOf(t.id)}
            aria-current={current === t.id ? 'page' : undefined}
            className={cn(
              'flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm transition',
              current === t.id ? 'border-zinc-900 font-medium text-zinc-950' : 'border-transparent text-zinc-500 hover:text-zinc-900',
            )}
          >
            <t.icon className="size-4" />
            {t.label}
          </a>
        ))}
      </div>
    </nav>
  )
}
