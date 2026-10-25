/** Kontakte aus vCard- und CSV-Daten lesen (wie src/main/contactImport.ts der App). */

import { type Contact, numbersMatch } from './shared'

type NewContact = Omit<Contact, 'id'> & { id?: string }

// -- vCard ------------------------------------------------------------------

function unfold(text: string): string {
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Quoted-Printable-Soft-Umbrüche (vCard 2.1) und gefaltete Zeilen zusammenführen
  text = text.replace(/=\n/g, '')
  return text.replace(/\n[ \t]/g, '')
}

function unescape(value: string): string {
  return value.replace(/\\(.)/g, (_m, ch: string) => ('nN'.includes(ch) ? '\n' : ch))
}

/** Trennt an `sep`, aber nicht an maskierten Zeichen. */
function split(value: string, sep = ';'): string[] {
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '\\' && i + 1 < value.length) {
      cur += ch + value[++i]
    } else if (ch === sep) {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  parts.push(cur)
  return parts.map(unescape)
}

function decodeQuotedPrintable(value: string, charset: string): string {
  const bytes: number[] = []
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff)
    }
  }
  try {
    return new TextDecoder(charset).decode(new Uint8Array(bytes))
  } catch {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes))
  }
}

function params(raw: string[]): [Record<string, string>, Set<string>] {
  const p: Record<string, string> = {}
  const types = new Set<string>()
  for (const item of raw) {
    const eq = item.indexOf('=')
    if (eq < 0) {
      types.add(item.toUpperCase()) // vCard 2.1: TEL;CELL;VOICE:…
      continue
    }
    const key = item.slice(0, eq).toUpperCase()
    const val = item.slice(eq + 1)
    if (key === 'TYPE') val.split(',').forEach((t) => types.add(t.replace(/"/g, '').toUpperCase()))
    else p[key] = val.replace(/^"|"$/g, '')
  }
  return [p, types]
}

interface Card {
  fn: string
  n: string
  org: string
  tels: [Set<string>, string][]
}

export function parseVcards(text: string): NewContact[] {
  const contacts: NewContact[] = []
  let cur: Card | null = null
  for (const line of unfold(text).split('\n')) {
    if (!line.trim()) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const head = line.slice(0, colon)
    let value = line.slice(colon + 1)
    const [propRaw, ...rawParams] = head.split(';')
    const prop = propRaw.split('.').pop()!.toUpperCase() // "item1.TEL" -> "TEL"
    if (prop === 'BEGIN' && value.trim().toUpperCase() === 'VCARD') {
      cur = { fn: '', n: '', org: '', tels: [] }
      continue
    }
    if (!cur) continue
    if (prop === 'END' && value.trim().toUpperCase() === 'VCARD') {
      const contact = finishVcard(cur)
      if (contact) contacts.push(contact)
      cur = null
      continue
    }
    const [p, types] = params(rawParams)
    const enc = (p.ENCODING ?? '').toUpperCase()
    if (enc === 'QUOTED-PRINTABLE' || enc === 'QP') value = decodeQuotedPrintable(value, p.CHARSET ?? 'utf-8')
    if (prop === 'FN') {
      cur.fn = unescape(value).trim()
    } else if (prop === 'N') {
      const parts = [...split(value), '', '', '', '', '']
      const [family, given, middle, prefix] = parts
      cur.n = [prefix, given, middle, family].filter((x) => x.trim()).join(' ').trim()
    } else if (prop === 'ORG') {
      cur.org = split(value)[0].trim()
    } else if (prop === 'TEL') {
      const number = unescape(value).trim().replace(/^tel:/i, '')
      if (number && !types.has('FAX')) cur.tels.push([types, number])
    }
  }
  return contacts
}

const MOBILE_TYPES = ['CELL', 'MOBILE', 'IPHONE']

function finishVcard(cur: Card): NewContact | null {
  const isMobile = (t: Set<string>): boolean => MOBILE_TYPES.some((m) => t.has(m))
  const mobile = cur.tels.filter(([t]) => isMobile(t)).map(([, n]) => n)
  const other = cur.tels.filter(([t]) => !isMobile(t)).map(([, n]) => n)
  // Bevorzugte Nummer zuerst
  const pref = (n: string): number => (cur.tels.some(([t, num]) => num === n && [...t].some((x) => x.includes('PREF'))) ? 0 : 1)
  other.sort((a, b) => pref(a) - pref(b))
  return makeContact(cur.fn || cur.n, cur.org, other, mobile)
}

function dedupe(numbers: string[]): string[] {
  const result: string[] = []
  for (const raw of numbers) {
    const n = raw.trim()
    if (n && !result.some((r) => numbersMatch(n, r))) result.push(n)
  }
  return result
}

function makeContact(name: string, company: string, phonesIn: string[], mobilesIn: string[]): NewContact | null {
  const phones = dedupe(phonesIn)
  const mobiles = dedupe(mobilesIn)
  if (!phones.length && !mobiles.length) return null
  const phone = phones.shift() ?? ''
  const mobile = mobiles.shift() ?? ''
  return {
    name: (name || company || phone || mobile).trim(),
    phone,
    mobile,
    company: (company || '').trim(),
    other: [...phones, ...mobiles],
  }
}

// -- CSV --------------------------------------------------------------------

const NAME_COLS =
  /^(name|name1|display ?name|anzeigename|full ?name|vollständiger name|kontakt|kontaktname|ansprechpartner|kurzname|bezeichnung)$/
const FIRST_COLS = /^(first ?name|given ?name|vorname)$/
const MIDDLE_COLS = /^(middle ?name|additional ?name|weitere vornamen|zweiter vorname)$/
const LAST_COLS = /^(last ?name|family ?name|surname|nachname)$/
const COMPANY_COLS =
  /^(company|firma|firmenname|organi[sz]ation( 1)?( - )?( ?name)?|unternehmen|kunde|kundenname|name2)$/
const PHONE_COLS = /phone|telefon|(^|[^a-z])tel($|[^a-z]|nr)|rufnummer|durchwahl|handy|mobil|mobile|cell/
export const MOBILE_HINT = /mobil|mobile|handy|cell/

export function readText(data: Buffer): string {
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return data.subarray(3).toString('utf8')
  if ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff)) {
    return new TextDecoder('utf-16').decode(data)
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
    if (!text.includes('\x00')) return text
  } catch {
    // kein UTF-8
  }
  return new TextDecoder('windows-1252').decode(data)
}

function sniffDelimiter(sample: string): string {
  const lines = sample.split('\n').slice(0, 5)
  let best = ','
  let bestScore = -1
  for (const d of [',', ';', '\t']) {
    const counts = lines.map((l) => l.split(d).length - 1)
    // gleichmäßig häufig vorkommende Trennzeichen gewinnen
    const score = counts[0] > 0 && counts.every((c) => c === counts[0] || c === 0) ? counts[0] * 10 : counts[0]
    if (score > bestScore) {
      best = d
      bestScore = score
    }
  }
  return best
}

export function parseCsvRows(text: string): string[][] {
  const delim = sniffDelimiter(text.slice(0, 4096))
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell === '') {
      quoted = true
    } else if (ch === delim) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim()))
}

export function parseCsv(text: string): [NewContact[], number] {
  const rows = parseCsvRows(text)
  if (rows.length < 2) return [[], 0]
  return [rowsToContacts(rows[0], rows.slice(1)), rows.length - 1]
}

export interface ColumnGuess {
  headers: string[]
  name: number[]
  first: number[]
  middle: number[]
  last: number[]
  company: number[]
  phone: number[]
  types: Record<string, number>
}

/** Ordnet Spaltennamen den Kontaktfeldern zu (für CSV und Datenbanktabellen). */
export function guessColumns(headersIn: unknown[]): ColumnGuess {
  const headers = headersIn.map((h) => String(h).trim().toLowerCase())
  const cols = (re: RegExp): number[] => headers.flatMap((h, i) => (re.test(h) ? [i] : []))
  const company = cols(COMPANY_COLS)
  const types: Record<string, number> = {}
  const phone: number[] = []
  headers.forEach((h, i) => {
    // Google: "Phone 1 - Type"/"Phone 1 - Label" + "Phone 1 - Value"
    const m = /^(.*?)\s*-\s*(type|label|typ|bezeichnung)$/.exec(h)
    if (m) types[m[1]] = i
    else if (PHONE_COLS.test(h) && !h.includes('fax') && !company.includes(i)) phone.push(i)
  })
  return {
    headers,
    name: cols(NAME_COLS),
    first: cols(FIRST_COLS),
    middle: cols(MIDDLE_COLS),
    last: cols(LAST_COLS),
    company,
    phone,
    types,
  }
}

/** Tabellenzeilen (Listen von Werten) mit Kopfzeile -> Kontakte. */
export function rowsToContacts(headers: unknown[], rows: unknown[][]): NewContact[] {
  const g = guessColumns(headers)
  const contacts: NewContact[] = []
  for (const rawRow of rows) {
    const row = rawRow.map((v) => (v === null || v === undefined ? '' : String(v)))
    while (row.length < g.headers.length) row.push('')
    const first = (indices: number[]): string => {
      for (const i of indices) if (row[i].trim()) return row[i].trim()
      return ''
    }
    const name = first(g.name) || [first(g.first), first(g.middle), first(g.last)].filter(Boolean).join(' ')
    const phones: string[] = []
    const mobiles: string[] = []
    for (const i of g.phone) {
      const header = g.headers[i]
      const base = header.replace(/\s*-\s*(value|wert)$/, '')
      let kind = header
      if (base in g.types) {
        kind = row[g.types[base]].toLowerCase()
        if (kind.includes('fax')) continue
      }
      for (const number of row[i].split(/\s*:::\s*/)) {
        if (number.trim()) (MOBILE_HINT.test(kind) ? mobiles : phones).push(number.trim())
      }
    }
    const contact = makeContact(name, first(g.company), phones, mobiles)
    if (contact) contacts.push(contact)
  }
  return contacts
}

/** Liest den Inhalt einer .vcf- oder .csv-Datei. Gibt [Kontakte, Anzahl ohne Nummer] zurück. */
export function parseFileData(data: Buffer): [NewContact[], number] {
  const text = readText(data)
  let contacts: NewContact[]
  let total: number
  if (text.toUpperCase().includes('BEGIN:VCARD')) {
    total = (text.match(/^BEGIN:VCARD/gim) ?? []).length
    contacts = parseVcards(text)
  } else {
    ;[contacts, total] = parseCsv(text)
  }
  return [contacts, Math.max(0, total - contacts.length)]
}
