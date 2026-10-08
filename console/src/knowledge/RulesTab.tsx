import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { admin, type Rules } from '@/api/admin'

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-zinc-500">{hint}</p>
      </div>
      {children}
    </section>
  )
}

function More({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group text-xs">
      <summary className="flex list-none items-center gap-1 text-zinc-500 hover:text-zinc-800">
        <ChevronDown className="size-3.5 transition group-open:rotate-180" /> {label}
      </summary>
      <pre className="mt-1.5 max-h-80 overflow-auto rounded-lg bg-zinc-50 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-700">
        {children}
      </pre>
    </details>
  )
}

/** Ce qui ne change pas d'une réponse à l'autre : règles, textes fixes, consignes données à l'IA. */
export function RulesTab() {
  const [rules, setRules] = useState<Rules | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    admin.rules().then(setRules).catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[860px] flex-col gap-8 px-4 py-5 sm:px-6 sm:py-8">
        <div>
          <h2 className="text-lg font-semibold tracking-tight sm:text-xl">Règles et textes</h2>
          <p className="mt-1 text-sm text-zinc-500">
            En lecture seule : les changer est une décision d’équipe, relue et testée, pas un réglage de démo.
          </p>
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {rules ? (
          <>
            <Section title="Règles de sécurité" hint="Écrites dans le code, appliquées à chaque réponse, avec ou sans IA.">
              <div className="grid gap-3 sm:grid-cols-2">
                {rules.rules.map((r) => (
                  <article key={r.id} className="flex flex-col gap-1.5 rounded-2xl border bg-white p-4 shadow-xs">
                    <p className="font-mono text-[11px] text-zinc-400">{r.id}</p>
                    <h4 className="text-sm font-semibold">{r.title}</h4>
                    <p className="text-[13px] leading-relaxed text-zinc-600">{r.text}</p>
                    {r.technical ? <More label="Détail technique">{r.technical}</More> : null}
                  </article>
                ))}
              </div>
            </Section>
            <Section title="Textes fixes" hint="Relus à l’avance, envoyés tels quels, sans IA.">
              <div className="flex flex-col gap-2">
                {rules.templates.map((t) => (
                  <article key={t.template_id} className="rounded-2xl border bg-white p-4 shadow-xs">
                    <p className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-mono text-zinc-400">{t.template_id}</span>
                      {t.escalation.trigger ? (
                        <span className="rounded bg-amber-100 px-1.5 py-px font-medium text-amber-900">
                          vétérinaire{t.escalation.urgency === 'high' ? ' · urgence' : ''}
                        </span>
                      ) : null}
                    </p>
                    {t.when ? <p className="mt-1 text-sm font-medium">Quand : {t.when.charAt(0).toLowerCase() + t.when.slice(1)}</p> : null}
                    <p className="mt-1 text-[13px] leading-relaxed text-zinc-700">{t.text}</p>
                  </article>
                ))}
              </div>
            </Section>
            <Section title="Consignes données à l’IA" hint={`Versionnées : chaque réponse note la version utilisée (${rules.prompt_version}).`}>
              <div className="flex flex-col gap-2">
                {rules.prompts.map((p) => (
                  <article key={p.name} className="flex flex-col gap-1.5 rounded-2xl border bg-white p-4 shadow-xs">
                    <p className="flex items-center justify-between gap-2 text-sm font-semibold">
                      {p.name}
                      <span className="font-mono text-[11px] font-normal text-zinc-400">{p.version}</span>
                    </p>
                    <More label="Lire la consigne">{p.text}</More>
                  </article>
                ))}
              </div>
            </Section>
          </>
        ) : !error ? (
          <p className="text-sm text-zinc-500">Chargement…</p>
        ) : null}
      </div>
    </div>
  )
}
