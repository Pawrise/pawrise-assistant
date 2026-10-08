import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * La photo du chien (`public/pets/<pet_ref>.jpg`, photos Unsplash libres de droits), ou son
 * initiale si la photo manque.
 */
export function PetAvatar({ petRef, name, className }: { petRef: string; name: string; className?: string }) {
  const [missing, setMissing] = useState(false)
  if (missing) {
    return (
      <span
        className={cn('grid shrink-0 place-items-center rounded-full bg-amber-100 font-semibold text-amber-900', className)}
        aria-hidden
      >
        {name[0]}
      </span>
    )
  }
  return (
    <img
      src={`/pets/${petRef}.jpg`}
      alt=""
      onError={() => setMissing(true)}
      className={cn('shrink-0 rounded-full object-cover', className)}
    />
  )
}
