import { useEffect, type ReactNode } from 'react'

/** Un panneau par-dessus la vue : en bas sur téléphone, à droite sur tablette. */
export function Sheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean
  onClose: () => void
  label: string
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
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="animate-in fade-in absolute inset-0 bg-zinc-950/30 duration-200"
      />
      <div
        className={
          'absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl bg-zinc-50 shadow-2xl ' +
          'animate-in slide-in-from-bottom duration-300 ' +
          'md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[420px] md:rounded-none md:rounded-l-2xl md:slide-in-from-right'
        }
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300 md:hidden" aria-hidden />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-5">
          {children}
        </div>
      </div>
    </div>
  )
}
