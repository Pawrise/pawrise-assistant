// Marque Pawrise, reprise du site (pawrise-website/components/Logo.tsx) : fleur à 8 pétales lime.
const PETAL = 'M0 -13 C7 -13 11 -22 9 -34 C8 -40 4 -44 0 -44 C-4 -44 -8 -40 -9 -34 C-11 -22 -7 -13 0 -13 Z'

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <g transform="translate(50 50)" fill="#d3fc72">
        {Array.from({ length: 8 }, (_, i) => (
          <path key={i} d={PETAL} transform={`rotate(${i * 45})`} />
        ))}
      </g>
    </svg>
  )
}
