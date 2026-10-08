import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Un panneau par-dessus la vue. `panel` : en bas sur téléphone, à droite à partir de la tablette.
 * `full` : tout l'écran sur téléphone, un large panneau à droite au-delà.
 */
export function Sheet({
  open,
  onClose,
  label,
  size = 'panel',
  children,
}: {
  open: boolean
  onClose: () => void
  label: string
  size?: 'panel' | 'full'
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const on = ({ key }: KeyboardEvent) => {
      if (key === 'Escape') onClose()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [open, onClose])

  if (!open) return null
  const full = size === 'full'
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="animate-in fade-in absolute inset-0 bg-zinc-950/30 duration-200"
      />
      <div
        className={cn(
          'absolute flex flex-col bg-zinc-50 shadow-2xl duration-300 animate-in',
          full
            ? 'inset-0 slide-in-from-bottom md:inset-y-0 md:right-0 md:left-auto md:w-[min(880px,94vw)] md:rounded-l-2xl md:slide-in-from-right'
            : 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl slide-in-from-bottom md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[420px] md:rounded-none md:rounded-l-2xl md:slide-in-from-right',
        )}
      >
        {full ? (
          <div className="min-h-0 flex-1 overflow-hidden md:rounded-l-2xl">{children}</div>
        ) : (
          <>
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300 md:hidden" aria-hidden />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-5">
              {children}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
