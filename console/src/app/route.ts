import { useEffect, useState } from 'react'

export type View = 'chat' | 'flow' | 'test'

export interface Route {
  view: View
  /** Pour la vue Parcours : l'échange affiché. */
  id: string | null
}

const PATHS: Record<View, string> = { chat: 'discuter', flow: 'parcours', test: 'tester' }

export function parse(hash: string): Route {
  const [path, id] = hash.replace(/^#\/?/, '').split('/')
  const view = (Object.keys(PATHS) as View[]).find((v) => PATHS[v] === path) ?? 'chat'
  return { view, id: id || null }
}

export const href = (view: View, id?: string | null) => `#/${PATHS[view]}${id ? `/${id}` : ''}`

export function go(view: View, id?: string | null) {
  window.location.hash = href(view, id)
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
