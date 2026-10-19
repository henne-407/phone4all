/** Rufnummern: Normalisieren, Vergleichen, in Freitext finden. */

import type { Contact } from './types'

/** Entfernt Formatierung aus einer Rufnummer, SIP-Adressen bleiben erhalten. */
export function normalizeNumber(number: string): string {
  const n = number.trim()
  if (n.includes('@') || n.startsWith('sip:')) return n
  return n.replace(/[^\d+*#]/g, '')
}

/** sip:0301234@pbx.local;user=phone -> 0301234 */
export function numberFromUri(uri: string): string {
  const m = /^(?:sips?:)?([^@;>]+)@/.exec(uri || '')
  return m ? m[1] : uri || ''
}

export function digits(number: string): string {
  const d = number.replace(/\D/g, '')
  if (number.trim().startsWith('+')) return d
  return d.replace(/^0+/, '')
}

export function contactNumbers(c: Partial<Contact>): string[] {
  return [c.phone ?? '', c.mobile ?? '', ...(c.other ?? [])].filter(Boolean)
}

export function numbersMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const da = digits(a)
  const db = digits(b)
  if (!da || !db) return false
  if (da === db) return true
  // +49301234 vs. 0301234: Länderkennung ignorieren
  const [short, long] = da.length <= db.length ? [da, db] : [db, da]
  return short.length >= 6 && long.endsWith(short)
}

export function hasDigit(text: string): boolean {
  return /\d/.test(text)
}

const PHONE_RE = /(?:tel:\s*)?(?<![\w+])(?:\+|00)?\d[\d \-/()]{4,22}\d(?!\w)/gi

/** Findet Telefonnummern in Freitext (z. B. Einwahlnummern in Terminen). */
export function findNumbers(...texts: string[]): string[] {
  const found: string[] = []
  for (const text of texts) {
    for (const m of (text || '').matchAll(PHONE_RE)) {
      let raw = m[0]
      if (raw.toLowerCase().startsWith('tel:')) raw = raw.slice(4)
      const number = raw.trim()
      const d = number.replace(/\D/g, '')
      // Datumsangaben wie 2026-10-15 oder Uhrzeiten ausschließen
      if (d.length < 6 || /^\d{4}-\d{2}-\d{2}$/.test(number)) continue
      if (!found.includes(number)) found.push(number)
    }
  }
  return found
}
