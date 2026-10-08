import { Bell, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { admin, type Day, type PetControls, type PetView } from '@/api/admin'
import { PetAvatar } from '@/components/PetAvatar'
import { cn } from '@/lib/utils'

/** 30 jours, du plus ancien au plus récent ; les 7 derniers ressortent, la moyenne d'avant en pointillé. */
function Chart({ series, pick, unit, label }: { series: Day[]; pick: (d: Day) => number; unit: string; label: string }) {
  const days = [...series].sort((a, b) => b.days_ago - a.days_ago)
  const values = days.map(pick)
  const max = Math.max(...values) * 1.1
  const base = days.filter((d) => d.days_ago >= 7).map(pick)
  const mean = base.reduce((a, b) => a + b, 0) / Math.max(base.length, 1)
  const w = 300
  const h = 64
  const bw = w / days.length
  const y = (v: number) => h - (v / max) * h
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="flex items-baseline justify-between text-xs text-zinc-500">
        <span className="font-medium text-zinc-700">{label}</span>
        <span>
          moyenne avant : {mean.toFixed(unit === 'h' ? 1 : 0)} {unit}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" preserveAspectRatio="none" role="img" aria-label={label}>
        {days.map((d, i) => (
          <rect
            key={d.days_ago}
            x={i * bw + 1}
            y={y(pick(d))}
            width={bw - 2}
            height={h - y(pick(d))}
            rx={1.5}
            className={d.days_ago < 7 ? 'fill-violet-500' : 'fill-zinc-300'}
          />
        ))}
        <line x1={0} x2={w} y1={y(mean)} y2={y(mean)} className="stroke-zinc-500" strokeDasharray="4 3" strokeWidth={1} />
      </svg>
      <div className="flex justify-between text-[10px] text-zinc-400">
        <span>il y a 30 j</span>
        <span className="text-violet-700">7 derniers jours</span>
      </div>
    </figure>
  )
}

function Delta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-xl bg-zinc-50 px-3 py-2">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  )
}

const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)} %`

function PetCard({ pet, onChange }: { pet: PetView; onChange: (p: PetView) => void }) {
  const [c, setC] = useState<PetControls>(pet.controls)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty =
    Math.round(c.activity_drop_pct) !== Math.round(pet.controls.activity_drop_pct) ||
    Math.round(c.sleep_rise_pct) !== Math.round(pet.controls.sleep_rise_pct) ||
    c.alert !== pet.controls.alert
  const escalates = c.alert || c.activity_drop_pct >= 30

  return (
    <article className="flex flex-col gap-4 rounded-2xl border bg-white p-4 shadow-xs sm:p-5">
      <header className="flex items-center gap-3">
        <PetAvatar petRef={pet.pet_ref} name={pet.name} className="size-11 text-lg" />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 font-semibold">
            {pet.name}
            {pet.modified ? <span className="rounded bg-violet-100 px-1.5 py-px text-[11px] font-medium text-violet-800">modifié</span> : null}
          </h3>
          <p className="text-sm text-zinc-500">
            {pet.breed}, {pet.age_years} ans, {pet.weight_kg} kg
            {pet.declared_conditions.length ? ` · ${pet.declared_conditions.join(', ')}` : ''}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Delta label="Activité (7 j)" value={pct(pet.summary.activity_delta_pct)} />
        <Delta label="Sommeil (7 j)" value={pct(pet.summary.sleep_delta_pct)} />
        <Delta label="FC au repos" value={`${pet.summary.resting_hr_bpm} bpm`} />
        <Delta label="Pic nocturne" value={`${pet.summary.night_hr_peak_bpm} bpm`} />
      </div>

      <Chart series={pet.series} pick={(d) => d.activity_min} unit="min" label="Activité par jour" />
      <Chart series={pet.series} pick={(d) => d.sleep_h} unit="h" label="Sommeil par jour" />

      {pet.alerts.length ? (
        <ul className="flex flex-col gap-1.5">
          {pet.alerts.map((a) => (
            <li key={a.alert_id} className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
              <Bell className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <span className="font-medium">{a.days_ago ? `Il y a ${a.days_ago} j` : 'Aujourd’hui'} · </span>
                {a.summary}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-zinc-500">Aucune alerte du collier.</p>
      )}

      <fieldset className="flex flex-col gap-3 rounded-xl border border-dashed p-3.5">
        <legend className="px-1 text-xs font-semibold text-zinc-700">Simuler d’autres données</legend>
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex justify-between">
            Baisse d’activité sur 7 jours <span className="font-semibold tabular-nums">-{Math.round(c.activity_drop_pct)} %</span>
          </span>
          <input
            type="range"
            min={0}
            max={80}
            step={5}
            value={c.activity_drop_pct}
            onChange={(e) => setC({ ...c, activity_drop_pct: Number(e.target.value) })}
            className="accent-violet-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex justify-between">
            Hausse du sommeil sur 7 jours <span className="font-semibold tabular-nums">+{Math.round(c.sleep_rise_pct)} %</span>
          </span>
          <input
            type="range"
            min={0}
            max={60}
            step={5}
            value={c.sleep_rise_pct}
            onChange={(e) => setC({ ...c, sleep_rise_pct: Number(e.target.value) })}
            className="accent-violet-600"
          />
        </label>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={c.alert} onChange={(e) => setC({ ...c, alert: e.target.checked })} className="size-4 accent-violet-600" />
          Alerte « baisse d’activité » active
        </label>
        <p className={cn('rounded-lg px-2.5 py-1.5 text-xs', escalates ? 'bg-amber-50 text-amber-900' : 'bg-zinc-50 text-zinc-600')}>
          {escalates
            ? 'Avec ces données, l’assistant proposera un vétérinaire (règle R-ESC-03).'
            : 'Sous -30 % et sans alerte : pas d’escalade automatique.'}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={() => {
              setBusy(true)
              setError(null)
              admin
                .editPet(pet.pet_ref, c)
                .then(onChange)
                .catch((e: Error) => setError(e.message))
                .finally(() => setBusy(false))
            }}
            className="h-9 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            {busy ? 'Application…' : 'Appliquer'}
          </button>
          {error ? <span className="text-xs text-red-700">{error}</span> : null}
        </div>
      </fieldset>
    </article>
  )
}

export function PetsTab() {
  const [pets, setPets] = useState<PetView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    admin.pets().then(setPets).catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight sm:text-xl">Les chiens et leur collier</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Ce que l’assistant lit sur chaque chien. Changez les données pour voir la réponse changer.
            </p>
          </div>
          {pets?.some((p) => p.modified) ? (
            <button
              type="button"
              onClick={() => void admin.resetPets().then(setPets)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <RotateCcw className="size-4" /> Données d’origine
            </button>
          ) : null}
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {!pets && !error ? <p className="text-sm text-zinc-500">Chargement…</p> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {pets?.map((p) => (
            // Une nouvelle version du serveur repart de ses valeurs : la clé change avec elles.
            <PetCard key={`${p.pet_ref}:${JSON.stringify(p.controls)}`} pet={p} onChange={(np) => setPets(pets.map((x) => (x.pet_ref === np.pet_ref ? np : x)))} />
          ))}
        </div>
      </div>
    </div>
  )
}
