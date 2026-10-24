/** Rufnummern: zum Wählen bereinigen und Anrufern Namen zuordnen. */

/** Entfernt Leerzeichen, Klammern, Bindestriche usw.; erlaubt Ziffern, +, *, # */
export function cleanNumber(input: string): string {
  const s = input.trim().replace(/^tel:/i, '').replace(/[^\d+*#]/g, '')
  // „+“ nur am Anfang
  return s.charAt(0) + s.slice(1).replace(/\+/g, '')
}

/** Rufnummer aus einer SIP-Adresse („sip:0301234@anlage“ → „0301234“) */
export function numberFromUri(uri: string): string {
  const m = /^sips?:([^@;]+)/i.exec(uri.trim())
  return m ? decodeURIComponent(m[1]) : uri
}

/**
 * Vergleichsschlüssel: internationale Schreibweise in nationale umwandeln und die
 * letzten neun Ziffern nehmen, damit „+49 30 1234567“ und „030/1234567“ zusammenpassen.
 */
export function matchKey(number: string, country = '49'): string {
  let n = cleanNumber(number).replace(/[*#]/g, '')
  if (n.startsWith('+' + country)) n = '0' + n.slice(country.length + 1)
  else if (n.startsWith('00' + country)) n = '0' + n.slice(country.length + 2)
  n = n.replace(/\D/g, '')
  return n.length > 9 ? n.slice(-9) : n
}

export interface NamedNumber {
  name: string
  numbers: string[]
}

/** Name zu einer Rufnummer suchen (interne Nummern exakt, externe über matchKey) */
export function findName(number: string, entries: NamedNumber[]): string {
  const clean = cleanNumber(number)
  if (!clean) return ''
  const internal = clean.length <= 6
  const key = matchKey(clean)
  for (const e of entries) {
    for (const n of e.numbers) {
      if (!n) continue
      if (internal ? cleanNumber(n) === clean : cleanNumber(n).length > 6 && matchKey(n) === key) return e.name
    }
  }
  return ''
}

/** Gesprächsdauer als „m:ss“ bzw. „h:mm:ss“ */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
