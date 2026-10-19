/** Ereignisse innerhalb der Oberfläche (Dialoge öffnen, Seiten wechseln). */

import { useEffect } from 'react'
import type { CalEvent, Contact, PageName } from '../../shared/types'

export interface UiEvents {
  'edit-contact': Partial<Contact>
  'open-event': { event: Partial<CalEvent>; isNew: boolean }
  'open-preferences': string
  navigate: PageName
  'customize-home': undefined
  about: undefined
}

type Listener<T> = (payload: T) => void
const listeners = new Map<keyof UiEvents, Set<Listener<never>>>()

export function emit<K extends keyof UiEvents>(name: K, ...payload: UiEvents[K] extends undefined ? [] : [UiEvents[K]]): void {
  for (const l of listeners.get(name) ?? []) (l as Listener<UiEvents[K] | undefined>)(payload[0])
}

export function useUiEvent<K extends keyof UiEvents>(name: K, listener: Listener<UiEvents[K]>): void {
  useEffect(() => {
    let set = listeners.get(name)
    if (!set) listeners.set(name, (set = new Set()))
    set.add(listener as Listener<never>)
    return () => {
      set.delete(listener as Listener<never>)
    }
  }, [name, listener])
}
