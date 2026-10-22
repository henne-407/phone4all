/** Navigation über den Hash: #/seite oder #/seite?edit=<id> (öffnet den Eintrag). */

import { useEffect, useState } from 'react'

export interface Route {
  page: string
  edit: string
}

function read(): Route {
  const [page, query = ''] = location.hash.replace(/^#\/?/, '').split('?')
  return { page, edit: new URLSearchParams(query).get('edit') ?? '' }
}

export function go(page: string, edit = ''): void {
  location.hash = `/${page}${edit ? `?edit=${encodeURIComponent(edit)}` : ''}`
}

export function useRoute(): Route {
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const on = (): void => setRoute(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

/** Bearbeitungswunsch aus der Adresse einmal abholen (danach wieder entfernen). */
export function takeEditRequest(page: string): string {
  const r = read()
  if (r.page !== page || !r.edit) return ''
  history.replaceState(null, '', `#/${page}`)
  return r.edit
}
