import { BookOpen, MessageCircle, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { href, type View } from '@/app/route'
import { cn } from '@/lib/utils'

const TABS: { view: View; label: string; icon: LucideIcon; soon?: boolean }[] = [
  { view: 'conversation', label: 'Conversation', icon: MessageCircle },
  { view: 'knowledge', label: 'Connaissances', icon: BookOpen, soon: true },
  { view: 'quality', label: 'Qualité', icon: ShieldCheck },
]

/** Une vue pas encore ouverte : « Bientôt disponible » au survol, au focus et au toucher. */
function Soon({ label, icon: Icon }: { label: string; icon: LucideIcon }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!shown) return
    const t = window.setTimeout(() => setShown(false), 1800)
    return () => window.clearTimeout(t)
  }, [shown])
  return (
    <span className="group relative flex flex-1 md:flex-none">
      <button
        type="button"
        aria-disabled="true"
        onClick={() => setShown(true)}
        className="flex h-10 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl px-3 text-sm text-zinc-400 md:h-9 md:px-4"
      >
        <Icon className="size-4" />
        <span className="text-[13px] md:text-sm">{label}</span>
      </button>
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 rounded-lg bg-zinc-900 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-white shadow-lg transition',
          'bottom-full mb-2 md:top-full md:bottom-auto md:mt-2 md:mb-0',
          shown ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
        )}
      >
        Bientôt disponible
      </span>
    </span>
  )
}

/**
 * Un dock : les trois vues, rien d'autre. Centré en haut à partir de la tablette, en bas sur
 * téléphone, là où le pouce l'atteint.
 */
export function Shell({ view, live, children }: { view: View; live: boolean; children: ReactNode }) {
  const dock = (
    <nav aria-label="Vues" className="flex rounded-2xl border bg-white/90 p-1 shadow-sm backdrop-blur">
      {TABS.map((t) =>
        t.soon ? (
          <Soon key={t.view} label={t.label} icon={t.icon} />
        ) : (
        <a
          key={t.view}
          href={href(t.view)}
          aria-current={view === t.view ? 'page' : undefined}
          className={cn(
            'relative flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm transition md:h-9 md:flex-none md:px-4',
            view === t.view ? 'bg-zinc-900 font-medium text-white' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950',
          )}
        >
          <t.icon className="size-4" />
          <span className="text-[13px] md:text-sm">{t.label}</span>
          {t.view === 'conversation' && live && view !== 'conversation' ? (
            <span className="absolute top-1.5 right-1.5 size-1.5 animate-pulse rounded-full bg-violet-500" />
          ) : null}
        </a>
        ),
      )}
    </nav>
  )
  return (
    <div className="flex h-dvh flex-col bg-zinc-50 text-zinc-950">
      <header className="z-20 hidden shrink-0 justify-center border-b bg-zinc-50 py-2.5 md:flex">{dock}</header>
      <main className="min-h-0 flex-1">{children}</main>
      <footer className="z-20 shrink-0 border-t bg-zinc-50 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
        {dock}
      </footer>
    </div>
  )
}
