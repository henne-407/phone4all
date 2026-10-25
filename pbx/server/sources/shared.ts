/**
 * Was die Kontaktquellen der App brauchen (src/shared der App). Die Dateien in diesem
 * Ordner entsprechen src/main/{dav,ical,contactImport,sqlSource}.ts der App, damit
 * Anlage und App Quellen gleich lesen; das Docker-Image enthält nur den Ordner pbx.
 */

export interface Contact {
  id: string
  name: string
  phone: string
  mobile: string
  other: string[]
  company: string
}

/** Zugang zu SQL Server, Felder wie in der App */
export interface SqlSourceConf {
  id: string
  name: string
  host: string
  port: number
  database: string
  user: string
  mode: 'table' | 'query'
  table: string
  name_cols: string
  company_col: string
  phone_cols: string
  query: string
}

export function digits(number: string): string {
  const d = number.replace(/\D/g, '')
  if (number.trim().startsWith('+')) return d
  return d.replace(/^0+/, '')
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
