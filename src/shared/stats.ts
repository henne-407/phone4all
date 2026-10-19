/** Auswertungen des Anrufverlaufs für Startseite und Verlaufsansicht. */

import { digits } from './numbers'
import type { HistoryRow } from './types'

function since(days: number): number {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - days).getTime() / 1000
}

export interface Summary {
  total: number
  incoming: number
  outgoing: number
  missed: number
  talk: number
}

/** Kennzahlen seit Mitternacht (days=0) bzw. der letzten `days` Tage. */
export function summary(history: HistoryRow[], days = 0): Summary {
  const start = since(days)
  const entries = history.filter((e) => e.time >= start)
  return {
    total: entries.length,
    incoming: entries.filter((e) => e.direction === 'in' && !e.missed).length,
    outgoing: entries.filter((e) => e.direction === 'out').length,
    missed: entries.filter((e) => e.missed).length,
    talk: entries.reduce((s, e) => s + (e.duration || 0), 0),
  }
}

export interface Frequent {
  name: string
  number: string
  count: number
}

/** Häufigste Gesprächspartner; Kontakte in `exclude` (IDs) werden ausgelassen. */
export function frequent(history: HistoryRow[], limit = 8, days = 90, exclude: Set<string> = new Set()): Frequent[] {
  const start = Date.now() / 1000 - days * 86400
  const counts = new Map<string, { count: number; e: HistoryRow }>()
  for (const e of history) {
    if (e.time < start || !e.number) continue
    // Mehrere Nummern desselben Kontakts zusammenzählen
    const key = e.contactId ? `c:${e.contactId}` : `n:${digits(e.number).slice(-8) || e.number}`
    const entry = counts.get(key)
    if (entry) entry.count++
    else counts.set(key, { count: 1, e })
  }
  const result: Frequent[] = []
  for (const { count, e } of [...counts.values()].sort((a, b) => b.count - a.count)) {
    if (e.contactId && exclude.has(e.contactId)) continue
    result.push({ name: e.contactName || e.name || e.number, number: e.number, count })
    if (result.length >= limit) break
  }
  return result
}
