import { FlaskConical, MessageCircle, PawPrint, Workflow, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Info } from '@/api/types'
import { href, type View } from '@/app/route'
import { cn } from '@/lib/utils'

const TABS: { view: View; label: string; icon: LucideIcon }[] = [
  { view: 'chat', label: 'Discuter', icon: MessageCircle },
  { view: 'flow', label: 'Parcours', icon: Workflow },
  { view: 'test', label: 'Tester', icon: FlaskConical },
]

function Mode({ info }: { info: Info | null }) {
  if (!info) return null
  return (
    <span
      title={info.ai ? `Modèles : ${info.models.join(', ')}` : 'Règles et textes types, sans appel à une IA'}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium',
        info.ai ? 'bg-violet-50 text-violet-800 ring-1 ring-violet-600/15' : 'bg-zinc-100 text-zinc-600',
      )}
    >
      <span className={cn('size-1.5 rounded-full', info.ai ? 'bg-violet-500' : 'bg-zinc-400')} />
      {info.ai ? (
        <>
          IA<span className="hidden sm:inline"> · {info.models.at(-1)}</span>
        </>
      ) : (
        'Sans IA'
      )}
    </span>
  )
}

export function Shell({
  view,
  flowId,
  info,
  live,
  children,
}: {
  view: View
  flowId: string | null
  info: Info | null
  live: boolean
  children: ReactNode
}) {
  const link = (v: View) => href(v, v === 'flow' ? flowId : null)
  return (
    <div className="flex h-dvh flex-col bg-zinc-50 text-zinc-950">
      <header className="z-20 flex h-12 shrink-0 items-center gap-3 border-b bg-white/90 px-4 backdrop-blur md:h-14 md:px-6">
        <a href={href('chat')} className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-zinc-900 text-white">
            <PawPrint className="size-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">
            Pawrise <span className="font-normal text-zinc-500">Assistant</span>
          </span>
        </a>
        <nav aria-label="Vues" className="mx-auto hidden rounded-xl bg-zinc-100 p-1 md:flex">
          {TABS.map((t) => (
            <a
              key={t.view}
              href={link(t.view)}
              aria-current={view === t.view ? 'page' : undefined}
              className={cn(
                'relative flex h-8 items-center gap-2 rounded-lg px-3.5 text-sm transition',
                view === t.view ? 'bg-white font-medium shadow-xs' : 'text-zinc-600 hover:text-zinc-950',
              )}
            >
              <t.icon className="size-4" />
              {t.label}
              {t.view === 'flow' && live ? (
                <span className="absolute top-1.5 right-1.5 size-1.5 animate-pulse rounded-full bg-violet-500" />
              ) : null}
            </a>
          ))}
        </nav>
        <div className="ml-auto md:ml-0">
          <Mode info={info} />
        </div>
      </header>

      <main className="min-h-0 flex-1">{children}</main>

      <nav
        aria-label="Vues"
        className="z-20 grid shrink-0 grid-cols-3 border-t bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {TABS.map((t) => (
          <a
            key={t.view}
            href={link(t.view)}
            aria-current={view === t.view ? 'page' : undefined}
            className={cn(
              'relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] transition',
              view === t.view ? 'font-semibold text-zinc-950' : 'text-zinc-500',
            )}
          >
            <t.icon className={cn('size-5', view === t.view && 'stroke-[2.25]')} />
            {t.label}
            {t.view === 'flow' && live ? (
              <span className="absolute top-2.5 left-1/2 ml-2.5 size-2 animate-pulse rounded-full bg-violet-500" />
            ) : null}
          </a>
        ))}
      </nav>
    </div>
  )
}
