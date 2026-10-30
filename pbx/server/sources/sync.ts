/**
 * Zentrale Kontakt- und Kalenderquellen: Die Anlage liest CardDAV-Adressbücher,
 * vCard-/CSV-Dateien, SQL Server, Microsoft 365 und Google sowie ICS-Abos und CalDAV-Kalender regelmäßig und
 * gibt sie wie das eigene Telefonbuch bzw. die eigenen Kalender an alle Apps weiter.
 * Gelesene Kontakte liegen in data/sources/<id>.json, Termine in data/calendars/<id>.json.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { CalendarEvent } from '../calendars'
import type { DirectoryEntry } from '../directory'
import { loadJson, saveJson } from '../files'
import type { CalendarSource, CentralCalendar, ContactSource, PbxConfig } from '../model'
import { PATHS } from '../paths'
import { parseFileData, parseVcards } from './contactImport'
import { DavClient, DavError, errorText, hasChild, parseXml, textOf } from './dav'
import { type RawEvent, expandEvents, parseCalendar } from './ical'
import type { Contact } from './shared'
import { cloudContacts, cloudEvents } from './cloud'
import { MsSqlSource } from './sqlSource'

const DIR = path.join(PATHS.data, 'sources')
/** Zeitraum der gelesenen Termine: zwei Monate zurück, gut ein Jahr voraus */
const PAST = 60 * 86400000
const FUTURE = 400 * 86400000

export interface SourceStatus {
  synced: number
  error: string
  count: number
  running: boolean
}

const PROPFIND_HOME = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop><d:current-user-principal/><card:addressbook-home-set/><d:resourcetype/></d:prop>
</d:propfind>`
const PROPFIND_BOOKS = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`
const REPORT_CARDS = `<?xml version="1.0" encoding="utf-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop><d:getetag/><card:address-data/></d:prop>
</card:addressbook-query>`
const reportEvents = (start: string, end: string): string => `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
    <c:time-range start="${start}" end="${end}"/>
  </c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`

function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

type Found = Omit<Contact, 'id'>

/** Kontakte eines CardDAV-Kontos (alle Adressbücher) oder eines einzelnen Adressbuchs */
async function cardDav(src: ContactSource): Promise<Found[]> {
  const client = new DavClient({ id: src.id, name: src.name, url: src.url, user: src.user }, src.password)
  const { home, collection } = await client.discover('carddav', PROPFIND_HOME, 'addressbook-home-set', 'addressbook')
  let books = collection ? [collection] : []
  if (!collection && home) {
    books = (await client.propfind(home, PROPFIND_BOOKS, 1)).filter((b) => hasChild(b.props.resourcetype, 'addressbook')).map((b) => b.href)
  }
  if (!books.length) throw new DavError('Keine Adressbücher gefunden – bitte die Adresse prüfen')
  const result: Found[] = []
  for (const href of books) {
    const r = await client.request('REPORT', href.endsWith('/') ? href : `${href}/`, REPORT_CARDS, 1)
    const cards: string[] = []
    for (const resp of parseXml(await r.text())?.multistatus?.response ?? []) {
      for (const ps of resp.propstat ?? []) {
        const data = textOf(ps.prop?.['address-data'])
        if (data.trim()) cards.push(data)
      }
    }
    result.push(...parseVcards(cards.join('\n')))
  }
  return result
}

/** .vcf oder .csv aus dem Netz (z. B. Export-Link eines CRM) */
async function fileUrl(src: ContactSource): Promise<Found[]> {
  const headers: Record<string, string> = { 'User-Agent': 'Phone4All' }
  if (src.user) headers.Authorization = 'Basic ' + Buffer.from(`${src.user}:${src.password}`).toString('base64')
  let r: Response
  try {
    r = await fetch(src.url, { headers, signal: AbortSignal.timeout(30000) })
  } catch (e) {
    throw new DavError(`Server nicht erreichbar: ${(e as Error).message}`)
  }
  if (r.status === 401) throw new DavError('Anmeldung fehlgeschlagen – Benutzername oder Passwort falsch')
  if (!r.ok) throw new DavError(`Serverfehler ${r.status}`)
  return parseFileData(Buffer.from(await r.arrayBuffer()))[0]
}

async function readContacts(src: ContactSource): Promise<Found[]> {
  switch (src.type) {
    case 'carddav':
      return cardDav(src)
    case 'url':
      return fileUrl(src)
    case 'mssql':
      return (await new MsSqlSource({ ...src, port: Number(src.port) || 1433 }, src.password).fetch())[0]
    case 'm365':
    case 'google':
      return cloudContacts(src as ContactSource & { type: 'm365' | 'google' })
  }
}

/** Termine eines ICS-Abos oder CalDAV-Kalenders im Zeitraum */
export async function readEvents(source: CalendarSource, start: number, end: number): Promise<RawEvent[]> {
  if (source.type === 'm365' || source.type === 'google') return cloudEvents({ ...source, type: source.type }, start, end)
  if (source.type === 'caldav') {
    const client = new DavClient({ id: '', name: '', url: source.url, user: source.user }, source.password)
    const r = await client.request('REPORT', source.url, reportEvents(utcStamp(start), utcStamp(end)), 1)
    const result: RawEvent[] = []
    for (const resp of parseXml(await r.text())?.multistatus?.response ?? []) {
      let data = ''
      for (const ps of resp.propstat ?? []) data ||= textOf(ps.prop?.['calendar-data'])
      const vcal = data.trim() ? parseCalendar(data) : null
      if (vcal) result.push(...expandEvents(vcal, start, end))
    }
    return result
  }
  const headers: Record<string, string> = { 'User-Agent': 'Phone4All' }
  if (source.user) headers.Authorization = 'Basic ' + Buffer.from(`${source.user}:${source.password}`).toString('base64')
  let r: Response
  try {
    r = await fetch(source.url, { headers, signal: AbortSignal.timeout(30000) })
  } catch (e) {
    throw new DavError(`Server nicht erreichbar: ${(e as Error).message}`)
  }
  if (r.status === 401) throw new DavError('Anmeldung fehlgeschlagen – Benutzername oder Passwort falsch')
  if (!r.ok) throw new DavError(`Serverfehler ${r.status}`)
  const vcal = parseCalendar(await r.text())
  if (!vcal) throw new DavError('Die Adresse liefert keinen Kalender (iCalendar/.ics)')
  return expandEvents(vcal, start, end)
}

const pad = (n: number): string => String(n).padStart(2, '0')
const localDate = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Gelesener Termin → Termin der Anlage; Serientermine bekommen je Vorkommen eine eigene UID */
export function toCentralEvent(e: RawEvent): CalendarEvent {
  const uid = e.recurring ? `${e.uid}/${e.start}` : e.uid || `${e.start}-${e.summary}`
  const end = e.allDay && e.end <= e.start ? e.start + 86400000 : e.end
  return {
    uid,
    summary: e.summary.slice(0, 200),
    start: e.allDay ? localDate(e.start) : new Date(e.start).toISOString(),
    end: e.allDay ? localDate(end) : new Date(end).toISOString(),
    allDay: e.allDay,
    location: e.location.slice(0, 200),
    description: e.description.slice(0, 4000),
    updated: '',
  }
}

export class SourceSync {
  status: Record<string, SourceStatus> = {}
  private contacts = new Map<string, DirectoryEntry[]>()
  /** Zählt Änderungen an den Kontakten (für Zwischenspeicher von Profilen und Namenssuche) */
  revision = 0
  private timer: NodeJS.Timeout | null = null

  constructor(
    private cfg: () => PbxConfig,
    /** Termine eines Kalenders ersetzen (CalendarStore.replace) */
    private saveEvents: (id: string, events: CalendarEvent[]) => void,
  ) {
    fs.mkdirSync(DIR, { recursive: true })
    this.status = loadJson<Record<string, SourceStatus>>(path.join(DIR, 'status.json'), {})
    for (const s of Object.values(this.status)) s.running = false
    for (const src of cfg().contactsources) this.contacts.set(src.id, loadJson<DirectoryEntry[]>(path.join(DIR, `${src.id}.json`), []))
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), 60000)
    this.timer.unref()
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** Kontakte aller eingeschalteten Quellen */
  entries(): DirectoryEntry[] {
    const enabled = new Set(this.cfg().contactsources.filter((s) => s.enabled).map((s) => s.id))
    return [...this.contacts].filter(([id]) => enabled.has(id)).flatMap(([, list]) => list)
  }

  private due(id: string, minutes: number): boolean {
    const s = this.status[id]
    if (!s) return true
    if (s.running) return false
    // Nach Fehlern nicht im Minutentakt erneut versuchen
    const wait = s.error ? Math.min(minutes, 15) : minutes
    return Date.now() - s.synced >= wait * 60000
  }

  async tick(): Promise<void> {
    const cfg = this.cfg()
    for (const src of cfg.contactsources) if (src.enabled && this.due(src.id, src.refresh_minutes)) await this.syncContacts(src)
    for (const cal of cfg.calendars) if (cal.kind === 'subscription' && this.due(cal.id, cal.source.refresh_minutes)) await this.syncCalendar(cal)
  }

  /** Eine Quelle sofort lesen (Knopf „Jetzt abgleichen“) */
  async syncNow(id: string): Promise<SourceStatus> {
    const cfg = this.cfg()
    const src = cfg.contactsources.find((s) => s.id === id)
    if (src) await this.syncContacts(src)
    const cal = cfg.calendars.find((c) => c.id === id && c.kind === 'subscription')
    if (cal) await this.syncCalendar(cal)
    return this.status[id] ?? { synced: 0, error: 'Unbekannte Quelle', count: 0, running: false }
  }

  private async run(id: string, work: () => Promise<number>): Promise<void> {
    const prev = this.status[id]
    this.status[id] = { synced: prev?.synced ?? 0, error: prev?.error ?? '', count: prev?.count ?? 0, running: true }
    try {
      const count = await work()
      this.status[id] = { synced: Date.now(), error: '', count, running: false }
    } catch (e) {
      this.status[id] = { synced: Date.now(), error: errorText(e), count: prev?.count ?? 0, running: false }
    }
    saveJson(path.join(DIR, 'status.json'), this.status)
  }

  async syncContacts(src: ContactSource): Promise<void> {
    await this.run(src.id, async () => {
      const found = await readContacts(src)
      const list: DirectoryEntry[] = found.map((c, i) => ({
        id: `src-${src.id}-${i}`,
        name: c.name,
        company: c.company,
        phone: c.phone || c.other[0] || '',
        mobile: c.mobile,
      }))
      const before = JSON.stringify(this.contacts.get(src.id) ?? [])
      if (JSON.stringify(list) !== before) {
        this.contacts.set(src.id, list)
        this.revision++
        // Die Apps merken die Änderung an der Profil-Revision, LDAP liest bei jeder Suche neu
        saveJson(path.join(DIR, `${src.id}.json`), list)
      }
      return list.length
    })
  }

  async syncCalendar(cal: CentralCalendar): Promise<void> {
    await this.run(cal.id, async () => {
      const now = Date.now()
      const events = (await readEvents(cal.source, now - PAST, now + FUTURE)).map(toCentralEvent)
      this.saveEvents(cal.id, events)
      return events.length
    })
  }

  /** Gelöschte Quellen aufräumen */
  cleanup(): void {
    const cfg = this.cfg()
    const known = new Set([...cfg.contactsources.map((s) => s.id), ...cfg.calendars.map((c) => c.id)])
    for (const id of Object.keys(this.status)) if (!known.has(id)) delete this.status[id]
    for (const id of [...this.contacts.keys()]) {
      if (cfg.contactsources.some((s) => s.id === id)) continue
      this.contacts.delete(id)
      this.revision++
      fs.rmSync(path.join(DIR, `${id}.json`), { force: true })
    }
    saveJson(path.join(DIR, 'status.json'), this.status)
  }
}
