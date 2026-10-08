import { ArrowLeft, Check, FileText, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { admin, type ChunkView, type DocView, type Knowledge } from '@/api/admin'
import { go } from '@/app/route'
import { Sheet } from '@/components/Sheet'
import { cn } from '@/lib/utils'

const docOf = (chunkId: string) => chunkId.split('#')[0]

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn('relative h-6 w-10 shrink-0 rounded-full transition', on ? 'bg-emerald-500' : 'bg-zinc-300')}
    >
      <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
    </button>
  )
}

function ChunkCard({
  chunk,
  cited,
  focused,
  onSaved,
  onDeleted,
}: {
  chunk: ChunkView
  cited: number
  focused: boolean
  onSaved: (c: ChunkView) => void
  onDeleted: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [section, setSection] = useState(chunk.section)
  const [text, setText] = useState(chunk.text)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focused])

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <article
      ref={ref}
      className={cn(
        'flex flex-col gap-2.5 rounded-2xl border bg-white p-4 shadow-xs transition',
        !chunk.enabled && 'bg-zinc-50 opacity-70',
        focused && 'ring-2 ring-violet-500 ring-offset-2',
      )}
    >
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="w-full rounded-lg border px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-zinc-400"
            />
          ) : (
            <h3 className="text-sm font-semibold">{chunk.section}</h3>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="font-mono text-zinc-400">{chunk.chunk_id}</span>
            {chunk.origin === 'edited' ? <span className="rounded bg-violet-100 px-1.5 py-px font-medium text-violet-800">modifié</span> : null}
            {chunk.origin === 'added' ? <span className="rounded bg-sky-100 px-1.5 py-px font-medium text-sky-800">ajouté</span> : null}
            {!chunk.enabled ? <span className="rounded bg-zinc-200 px-1.5 py-px font-medium text-zinc-700">désactivé</span> : null}
            {cited ? <span className="rounded bg-emerald-50 px-1.5 py-px font-medium text-emerald-800">cité {cited} fois</span> : null}
          </p>
        </div>
        <Toggle
          on={chunk.enabled}
          label="Utilisé par l’assistant"
          onChange={(enabled) => void act('toggle', async () => onSaved(await admin.editChunk(chunk.chunk_id, { enabled })))}
        />
      </header>

      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="resize-y rounded-xl border bg-zinc-50 px-3 py-2 text-sm leading-relaxed outline-none focus:border-zinc-400 focus:bg-white"
        />
      ) : (
        <p className="text-sm leading-relaxed text-zinc-700">{chunk.text}</p>
      )}

      <footer className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button
              type="button"
              disabled={busy !== null || !text.trim()}
              onClick={() =>
                void act('save', async () => {
                  onSaved(await admin.editChunk(chunk.chunk_id, { text, section }))
                  setEditing(false)
                })
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
            >
              <Check className="size-3.5" /> {busy === 'save' ? 'Ré-indexation…' : 'Enregistrer et ré-indexer'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setText(chunk.text)
                setSection(chunk.section)
              }}
              className="h-8 rounded-lg px-3 text-xs font-medium text-zinc-600 hover:bg-zinc-100"
            >
              Annuler
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={!chunk.enabled}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              <Pencil className="size-3.5" /> Modifier
            </button>
            <button
              type="button"
              onClick={() => void act('delete', async () => {
                await admin.deleteChunk(chunk.chunk_id)
                onDeleted()
              })}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-zinc-500 hover:bg-red-50 hover:text-red-700"
            >
              <Trash2 className="size-3.5" /> Supprimer
            </button>
          </>
        )}
        {busy === 'toggle' ? <span className="text-xs text-zinc-500">Ré-indexation…</span> : null}
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
      </footer>
    </article>
  )
}

function AddDocument({ onAdded }: { onAdded: (d: DocView) => void }) {
  const [title, setTitle] = useState('')
  const [sections, setSections] = useState([{ section: '', text: '' }])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const valid = title.trim() && sections.every((s) => s.section.trim() && s.text.trim())
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        setBusy(true)
        admin
          .addDocument(title.trim(), sections)
          .then(onAdded)
          .catch((err: Error) => setError(err.message))
          .finally(() => setBusy(false))
      }}
    >
      <div>
        <h2 className="text-base font-semibold">Ajouter une fiche santé</h2>
        <p className="mt-0.5 text-sm text-zinc-500">Chaque section devient un passage que l’assistant peut citer.</p>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Titre de la fiche
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex. Coup de chaleur"
          className="rounded-xl border bg-white px-3 py-2 font-normal outline-none focus:border-zinc-400"
        />
      </label>
      {sections.map((s, i) => (
        <fieldset key={i} className="flex flex-col gap-2 rounded-xl border bg-white p-3">
          <legend className="px-1 text-xs font-medium text-zinc-500">Passage {i + 1}</legend>
          <input
            value={s.section}
            onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, section: e.target.value } : x)))}
            placeholder="Titre de la section"
            className="rounded-lg border px-2.5 py-1.5 text-sm outline-none focus:border-zinc-400"
          />
          <textarea
            value={s.text}
            onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
            rows={4}
            placeholder="Le contenu, relu par un vétérinaire."
            className="resize-y rounded-lg border px-2.5 py-1.5 text-sm outline-none focus:border-zinc-400"
          />
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() => setSections([...sections, { section: '', text: '' }])}
        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg border bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
      >
        <Plus className="size-4" /> Un passage de plus
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={!valid || busy}
        className="h-10 rounded-xl bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
      >
        {busy ? 'Indexation…' : 'Ajouter et indexer'}
      </button>
    </form>
  )
}

export function DocsTab({ focus, cited }: { focus: string | null; cited: Record<string, number> }) {
  const [kb, setKb] = useState<Knowledge | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    admin.knowledge().then(setKb).catch((e: Error) => setError(e.message))
  }, [])

  // La fiche ouverte vient de l'adresse : un lien de source y mène directement.
  const docId = focus ? docOf(focus) : null
  const doc = kb?.documents.find((d) => d.doc_id === docId) ?? null
  const changed = useMemo(
    () => kb?.documents.some((d) => d.origin === 'added' || d.chunks.some((c) => c.origin !== 'seed' || !c.enabled)) ?? false,
    [kb],
  )

  const say = (text: string) => {
    setNotice(text)
    window.setTimeout(() => setNotice(null), 3500)
  }
  const replaceChunk = (c: ChunkView) => {
    setKb((k) =>
      k && {
        ...k,
        documents: k.documents.map((d) => ({ ...d, chunks: d.chunks.map((x) => (x.chunk_id === c.chunk_id ? c : x)) })),
      },
    )
    say('Ré-indexé : les prochaines réponses utilisent cette version.')
  }
  const open = (id: string | null) => go('knowledge', 'fiches', id)

  if (error) return <p className="p-6 text-sm text-red-700">{error}</p>
  if (!kb) return <p className="p-6 text-sm text-zinc-500">Chargement de la base…</p>

  const list = (
    <nav aria-label="Fiches santé" className="flex flex-col gap-1">
      {kb.documents.map((d) => {
        const off = d.chunks.filter((c) => !c.enabled).length
        const edited = d.chunks.some((c) => c.origin === 'edited')
        const hits = d.chunks.reduce((n, c) => n + (cited[c.chunk_id] ?? 0), 0)
        return (
          <button
            key={d.doc_id}
            type="button"
            onClick={() => open(d.doc_id)}
            aria-current={doc?.doc_id === d.doc_id}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition',
              doc?.doc_id === d.doc_id ? 'bg-white shadow-xs ring-1 ring-zinc-200' : 'hover:bg-white/70',
            )}
          >
            <FileText className={cn('size-4 shrink-0', off === d.chunks.length ? 'text-zinc-300' : 'text-zinc-500')} />
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-sm font-medium', off === d.chunks.length && 'text-zinc-400 line-through')}>
                {d.title}
              </span>
              <span className="text-xs text-zinc-500">
                {d.chunks.length} passage{d.chunks.length > 1 ? 's' : ''}
                {off ? ` · ${off} désactivé${off > 1 ? 's' : ''}` : ''}
                {edited ? ' · modifiée' : ''}
                {d.origin === 'added' ? ' · ajoutée' : ''}
              </span>
            </span>
            {hits ? (
              <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-800">{hits}</span>
            ) : null}
          </button>
        )
      })}
    </nav>
  )

  const actions = (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700"
      >
        <Plus className="size-4" /> Ajouter une fiche
      </button>
      {changed ? (
        <button
          type="button"
          onClick={() =>
            void admin.resetKnowledge().then((r) => {
              setKb({ ...kb, documents: r.documents })
              say('Corpus d’origine restauré.')
            })
          }
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <RotateCcw className="size-4" /> Réinitialiser
        </button>
      ) : null}
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col md:grid md:grid-cols-[300px_minmax(0,1fr)]">
      <aside className={cn('min-h-0 flex-col gap-3 overflow-y-auto border-r bg-zinc-100/50 p-3 md:flex', doc ? 'hidden' : 'flex')}>
        <div className="px-1 pt-1">
          <p className="text-sm font-semibold">{kb.documents.length} fiches santé</p>
          <p className="text-xs text-zinc-500">
            Recherche : {kb.retriever} · classement : {kb.reranker}
          </p>
        </div>
        {actions}
        {list}
      </aside>

      <section className={cn('min-h-0 overflow-y-auto', doc ? 'block' : 'hidden md:block')}>
        {doc ? (
          <div className="mx-auto flex max-w-[760px] flex-col gap-3 p-4 sm:p-6">
            <button
              type="button"
              onClick={() => open(null)}
              className="inline-flex w-fit items-center gap-1 text-sm font-medium text-zinc-600 md:hidden"
            >
              <ArrowLeft className="size-4" /> Toutes les fiches
            </button>
            <header className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold tracking-tight sm:text-xl">{doc.title}</h2>
                <p className="text-sm text-zinc-500">
                  L’interrupteur retire un passage de la recherche sans l’effacer. Chaque modification est ré-indexée tout de suite.
                </p>
              </div>
            </header>
            {doc.chunks.map((c) => (
              <ChunkCard
                key={c.chunk_id}
                chunk={c}
                cited={cited[c.chunk_id] ?? 0}
                focused={focus === c.chunk_id}
                onSaved={replaceChunk}
                onDeleted={() => {
                  setKb({
                    ...kb,
                    documents: kb.documents
                      .map((d) => ({ ...d, chunks: d.chunks.filter((x) => x.chunk_id !== c.chunk_id) }))
                      .filter((d) => d.chunks.length),
                  })
                  say('Passage supprimé de la base.')
                }}
              />
            ))}
          </div>
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <div className="max-w-sm">
              <p className="text-base font-semibold">Ce que l’assistant a le droit de dire</p>
              <p className="mt-1 text-sm text-zinc-500">
                Il ne répond qu’à partir de ces fiches et des données du collier. Choisissez une fiche pour la lire, la modifier ou la retirer.
              </p>
            </div>
          </div>
        )}
      </section>

      {notice ? (
        <div className="animate-in fade-in slide-in-from-bottom-2 fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg md:bottom-6">
          {notice}
        </div>
      ) : null}

      <Sheet open={adding} onClose={() => setAdding(false)} label="Ajouter une fiche">
        <AddDocument
          onAdded={(d) => {
            setKb({ ...kb, documents: [...kb.documents, d] })
            setAdding(false)
            open(d.doc_id)
            say('Fiche ajoutée et indexée.')
          }}
        />
      </Sheet>
    </div>
  )
}
