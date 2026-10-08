import { useEffect, useState } from 'react'

export type View = 'conversation' | 'knowledge' | 'quality'

export interface Route {
  view: View
  /** L'onglet de la vue (ex. « fiches », « evaluations »). */
  tab: string | null
  /** Un élément précis : un passage du corpus, un chien… */
  id: string | null
}

const PATHS: Record<View, string> = {
  conversation: 'conversation',
  knowledge: 'connaissances',
  quality: 'qualite',
}

export function parse(hash: string): Route {
  const [path, tab, ...rest] = hash.replace(/^#\/?/, '').split('/')
  const view = (Object.keys(PATHS) as View[]).find((v) => PATHS[v] === path) ?? 'conversation'
  const id = rest.length ? decodeURIComponent(rest.join('/')) : null
  return { view, tab: tab || null, id }
}

export const href = (view: View, tab?: string | null, id?: string | null) =>
  `#/${PATHS[view]}${tab ? `/${tab}` : ''}${tab && id ? `/${encodeURIComponent(id)}` : ''}`

export function go(view: View, tab?: string | null, id?: string | null) {
  window.location.hash = href(view, tab, id)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash))
  useEffect(() => {
    const on = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatch(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}
