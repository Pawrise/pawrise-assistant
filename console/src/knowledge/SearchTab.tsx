import { Search } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { admin, type ChunkView, type Knowledge, type SearchResult } from '@/api/admin'
import { href } from '@/app/route'
import { cn } from '@/lib/utils'

type Candidate = { id: string; rrf_rank: number; bm25_rank: number | null; dense_rank: number | null }
type Kept = { id: string; rerank: number }

const EXAMPLES = [
  'Rex dort beaucoup depuis quelques jours',
  'Il a mangé du chocolat',
  'Mon chien boite de la patte arrière',
  'Comment protéger mon chien des tiques ?',
]

function Rank({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="flex flex-col items-center">
      <span className="text-[10px] text-zinc-500">{label}</span>
      <span className={cn('text-xs font-semibold tabular-nums', value ? 'text-zinc-800' : 'text-zinc-300')}>
        {value ? `#${value}` : '—'}
      </span>
    </span>
  )
}

/** Ce que la recherche trouve pour une question, et pourquoi : deux classements, une fusion, un tri. */
export function SearchTab({ initial }: { initial: string | null }) {
  const [query, setQuery] = useState(initial ?? EXAMPLES[0])
  const [result, setResult] = useState<SearchResult | null>(null)
  const [kb, setKb] = useState<Knowledge | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chunks = useMemo(() => {
    const out: Record<string, ChunkView & { title: string }> = {}
    for (const d of kb?.documents ?? []) for (const c of d.chunks) out[c.chunk_id] = { ...c, title: d.title }
    return out
  }, [kb])

  const run = (q: string) => {
    if (!q.trim()) return
    setBusy(true)
    setError(null)
    Promise.all([admin.search(q), admin.knowledge()])
      .then(([r, k]) => {
        setResult(r)
        setKb(k)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }
  useEffect(() => {
    run(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule recherche à l'ouverture
  }, [])

  const candidates = (result?.retrieval.candidates as Candidate[] | undefined) ?? []
  const kept = (result?.relevance.kept as Kept[] | undefined) ?? []
  const keptIds = new Set(kept.map((k) => k.id))
  const maxScore = Math.max(0.0001, ...kept.map((k) => k.rerank))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[860px] flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
        <div>
          <h2 className="text-lg font-semibold tracking-tight sm:text-xl">Tester la recherche</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Deux classements — par les mots et par le sens — sont fusionnés, puis les 5 meilleurs passages sont gardés pour
            rédiger. C’est tout ce que l’IA verra.
          </p>
        </div>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            run(query)
          }}
          className="flex gap-2"
        >
          <label htmlFor="q" className="sr-only">
            Question
          </label>
          <input
            id="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 min-w-0 flex-1 rounded-xl border bg-white px-3.5 text-[15px] outline-none focus:border-zinc-400"
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            <Search className="size-4" />
            <span className="hidden sm:inline">Chercher</span>
          </button>
        </form>
        <div className="-mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                setQuery(q)
                run(q)
              }}
              className="h-7 rounded-full border bg-white px-2.5 text-xs text-zinc-600 hover:bg-zinc-50"
            >
              {q}
            </button>
          ))}
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        {result ? (
          <>
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                Gardés pour rédiger · {kept.length}
              </h3>
              {kept.map((k, i) => {
                const c = chunks[k.id]
                const cand = candidates.find((x) => x.id === k.id)
                return (
                  <a
                    key={k.id}
                    href={href('knowledge', 'fiches', k.id)}
                    className="flex gap-3 rounded-2xl border bg-white p-3.5 shadow-xs transition hover:border-zinc-300"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-800">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {c?.title ?? k.id} · {c?.section}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[13px] text-zinc-600">{c?.text}</span>
                      <span className="mt-2 flex items-center gap-2">
                        <span className="h-1.5 w-28 overflow-hidden rounded-full bg-zinc-100">
                          <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${(k.rerank / maxScore) * 100}%` }} />
                        </span>
                        <span className="text-[11px] text-zinc-500 tabular-nums">pertinence {k.rerank.toFixed(2)}</span>
                      </span>
                    </span>
                    <span className="hidden shrink-0 gap-3 sm:flex">
                      <Rank label="mots" value={cand?.bm25_rank ?? null} />
                      <Rank label="sens" value={cand?.dense_rank ?? null} />
                      <Rank label="fusion" value={cand?.rrf_rank ?? null} />
                    </span>
                  </a>
                )
              })}
              {!kept.length ? (
                <p className="rounded-xl border border-dashed p-4 text-sm text-zinc-600">
                  Aucun passage assez pertinent : l’assistant répondrait sans fiche, donc prudemment.
                </p>
              ) : null}
            </section>

            <details className="group rounded-2xl border bg-white">
              <summary className="flex list-none items-center justify-between px-4 py-3 text-sm font-medium">
                Écartés · {candidates.filter((c) => !keptIds.has(c.id)).length}
                <span className="text-xs text-zinc-500 group-open:hidden">voir</span>
              </summary>
              <ul className="divide-y border-t">
                {candidates
                  .filter((c) => !keptIds.has(c.id))
                  .map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-700">
                        {chunks[c.id]?.title ?? c.id} · {chunks[c.id]?.section}
                      </span>
                      <span className="flex shrink-0 gap-3">
                        <Rank label="mots" value={c.bm25_rank} />
                        <Rank label="sens" value={c.dense_rank} />
                        <Rank label="fusion" value={c.rrf_rank} />
                      </span>
                    </li>
                  ))}
              </ul>
            </details>
            <p className="text-xs text-zinc-500">
              {String(result.retrieval.retriever ?? '')} · {String(result.relevance.reranker ?? '')}
            </p>
          </>
        ) : busy ? (
          <p className="shimmer text-sm">Recherche en cours…</p>
        ) : null}
      </div>
    </div>
  )
}
