import { useEffect, useRef, type ReactNode } from 'react'

/** Une bulle sous son bouton, alignée à droite. Se ferme d'un clic ailleurs ou avec Échap. */
export function Popover({
  open,
  onClose,
  trigger,
  label,
  children,
}: {
  open: boolean
  onClose: () => void
  trigger: ReactNode
  label: string
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose()
    }
    const esc = ({ key }: KeyboardEvent) => {
      if (key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open, onClose])

  return (
    <div ref={box} className="relative shrink-0">
      {trigger}
      {open ? (
        <div
          role="dialog"
          aria-label={label}
          className="animate-in fade-in zoom-in-95 absolute top-full right-0 z-40 mt-2 max-h-[70vh] w-[min(360px,calc(100vw-2rem))] origin-top-right overflow-y-auto rounded-2xl border bg-white p-4 shadow-xl ring-1 ring-zinc-900/5 duration-150"
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
