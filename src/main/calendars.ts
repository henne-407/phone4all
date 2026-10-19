/** Kalender: CalDAV (alle Plattformen) und Evolution Data Server (GNOME Online-Konten, nur Linux). */

import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { CalEvent, CalendarInfo, DavAccount } from '../shared/types'
import { DavClient, DavError, errorText, hasChild, textOf, type XmlNode, parseXml } from './dav'
import { eds, edsAvailable } from './eds'
import { type EventFields, type RawEvent, expandEvents, newCalendar, parseCalendar, updateCalendar } from './ical'
import type { Store } from './store'

const DEFAULT_COLOR = '#6750a4'

const PROPFIND_PRINCIPAL = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:current-user-principal/><c:calendar-home-set/><d:resourcetype/></d:prop>
</d:propfind>`
const PROPFIND_CALENDARS = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
  <d:prop>
    <d:resourcetype/><d:displayname/><a:calendar-color/>
    <c:supported-calendar-component-set/><d:current-user-privilege-set/>
  </d:prop>
</d:propfind>`
const reportEvents = (start: string, end: string): string => `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data><c:expand start="${start}" end="${end}"/></c:calendar-data></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
    <c:time-range start="${start}" end="${end}"/>
  </c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`

function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export interface Calendar {
  id: string
  name: string
  color: string
  writable: boolean
  group: string
  href: string // CalDAV-Collection
  backend: Backend
}

interface Backend {
  events(cal: Calendar, start: number, end: number): Promise<(RawEvent & { href: string })[]>
  save(cal: Calendar, ev: EventFields, href: string, isNew: boolean): Promise<void>
  delete(cal: Calendar, uid: string, href: string): Promise<void>
  refresh(): Promise<void>
}

// -- CalDAV ---------------------------------------------------------------------

export class CalDavBackend implements Backend {
  readonly client: DavClient

  constructor(readonly conf: DavAccount, password: string) {
    this.client = new DavClient(conf, password)
  }

  /** Findet die Kalender des Kontos. Akzeptiert Server-, Principal- oder Kalender-URL. */
  async discover(): Promise<Calendar[]> {
    const { home, collection } = await this.client.discover(
      'caldav',
      PROPFIND_PRINCIPAL,
      'calendar-home-set',
      'calendar',
    )
    if (collection) return this.listCollections(collection, 0)
    if (!home) throw new DavError('Keine Kalender gefunden – bitte die CalDAV-URL prüfen')
    const calendars = await this.listCollections(home, 1)
    if (!calendars.length) throw new DavError('Das Konto enthält keine Terminkalender')
    return calendars
  }

  private async listCollections(url: string, depth: number): Promise<Calendar[]> {
    const result: Calendar[] = []
    for (const { href, props } of await this.client.propfind(url, PROPFIND_CALENDARS, depth)) {
      if (!hasChild(props.resourcetype, 'calendar')) continue
      const comps: XmlNode[] = props['supported-calendar-component-set']?.comp ?? []
      if (comps.length && !comps.some((c) => c?.['@_name'] === 'VEVENT')) continue // z. B. reine Aufgabenlisten
      let writable = true
      const privs: XmlNode[] = props['current-user-privilege-set']?.privilege ?? []
      if (privs.length) {
        const names = new Set(privs.flatMap((p) => (p && typeof p === 'object' ? Object.keys(p) : [])))
        writable = ['write', 'write-content', 'all'].some((n) => names.has(n))
      }
      const color = textOf(props['calendar-color']).trim().slice(0, 7)
      result.push({
        id: `caldav:${this.conf.id}:${href}`,
        name: textOf(props.displayname) || decodeURIComponent(href.replace(/\/$/, '').split('/').pop() ?? href),
        color: /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_COLOR,
        writable,
        group: this.conf.name || new URL(href).host,
        href: href.endsWith('/') ? href : href + '/',
        backend: this,
      })
    }
    return result
  }

  async events(cal: Calendar, start: number, end: number): Promise<(RawEvent & { href: string })[]> {
    const r = await this.client.request('REPORT', cal.href, reportEvents(utcStamp(start), utcStamp(end)), 1)
    const root = parseXml(await r.text())
    const result: (RawEvent & { href: string })[] = []
    for (const resp of root?.multistatus?.response ?? []) {
      const href = new URL(textOf(resp.href).trim(), r.url).toString()
      let data = ''
      for (const ps of resp.propstat ?? []) data ||= textOf(ps.prop?.['calendar-data'])
      if (!data.trim()) continue
      const vcal = parseCalendar(data)
      if (!vcal) continue
      for (const ev of expandEvents(vcal, start, end)) result.push({ ...ev, href })
    }
    return result
  }

  async save(cal: Calendar, ev: EventFields, href: string, isNew: boolean): Promise<void> {
    if (isNew) {
      const target = new URL(ev.uid.replace(/[^\w.-]/g, '_') + '.ics', cal.href).toString()
      await this.client.request('PUT', target, newCalendar(ev), undefined, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'If-None-Match': '*',
      })
      return
    }
    const r = await this.client.request('GET', href, undefined, undefined, { 'Content-Type': 'text/calendar' })
    const body = updateCalendar(await r.text(), ev)
    if (!body) throw new DavError('Termin auf dem Server nicht gefunden')
    const headers: Record<string, string> = { 'Content-Type': 'text/calendar; charset=utf-8' }
    const etag = r.headers.get('etag')
    if (etag) headers['If-Match'] = etag
    await this.client.request('PUT', href, body, undefined, headers)
  }

  async delete(_cal: Calendar, _uid: string, href: string): Promise<void> {
    await this.client.request('DELETE', href, undefined, undefined, { 'Content-Type': 'text/calendar' })
  }

  async refresh(): Promise<void> {}
}

// -- Evolution Data Server --------------------------------------------------------

class EdsBackend implements Backend {
  async list(): Promise<Calendar[]> {
    const cals = await eds.call<Omit<Calendar, 'backend' | 'href'>[]>('calendars')
    return cals.map((c) => ({ ...c, href: '', backend: this }))
  }

  async events(cal: Calendar, start: number, end: number): Promise<(RawEvent & { href: string })[]> {
    const r = await eds.call<{ events: RawEvent[]; writable: boolean }>('events', { calendar: cal.id, start, end })
    cal.writable = cal.writable && r.writable
    return r.events.map((e) => ({ ...e, href: '' }))
  }

  async save(cal: Calendar, ev: EventFields, _href: string, isNew: boolean): Promise<void> {
    await eds.call('save', { calendar: cal.id, event: ev, isNew })
  }

  async delete(cal: Calendar, uid: string): Promise<void> {
    await eds.call('delete', { calendar: cal.id, uid })
  }

  async refresh(): Promise<void> {
    await eds.call('refresh')
  }
}

// -- Verwaltung -------------------------------------------------------------------

/** Hält die Kalenderliste. Ereignisse: 'calendars-changed', 'events-changed'. */
export class CalendarManager extends EventEmitter {
  calendars: Calendar[] = []
  errors: string[] = []
  loading = false
  private eds = edsAvailable() ? new EdsBackend() : null

  constructor(private store: Store) {
    super()
  }

  get edsAvailable(): boolean {
    return this.eds !== null
  }

  get settings(): Store['settings']['calendar'] {
    return this.store.settings.calendar
  }

  caldavBackend(conf: DavAccount, password?: string): CalDavBackend {
    return new CalDavBackend(conf, password ?? this.store.getSecret(`caldav:${conf.id}`))
  }

  /** Kalenderlisten aller Quellen neu einlesen. */
  async reload(): Promise<void> {
    this.loading = true
    this.emit('calendars-changed')
    const calendars: Calendar[] = []
    const errors: string[] = []
    if (this.eds && this.settings.use_eds) {
      try {
        calendars.push(...(await this.eds.list()))
      } catch (e) {
        errors.push(`Evolution-Kalender: ${errorText(e)}`)
      }
    }
    await Promise.all(
      this.settings.caldav.map(async (conf) => {
        try {
          calendars.push(...(await this.caldavBackend(conf).discover()))
        } catch (e) {
          errors.push(`${conf.name || conf.url}: ${errorText(e)}`)
        }
      }),
    )
    this.loading = false
    this.calendars = calendars
    this.errors = errors
    this.emit('calendars-changed')
  }

  isEnabled(id: string): boolean {
    return !this.settings.disabled.includes(id)
  }

  setEnabled(id: string, enabled: boolean): void {
    const disabled = new Set(this.settings.disabled)
    if (enabled) disabled.delete(id)
    else disabled.add(id)
    this.settings.disabled = [...disabled].sort()
    this.store.saveSettings()
    this.emit('events-changed')
  }

  enabledCalendars(): Calendar[] {
    return this.calendars.filter((c) => this.isEnabled(c.id))
  }

  writableCalendars(): Calendar[] {
    return this.enabledCalendars().filter((c) => c.writable)
  }

  defaultCalendar(): Calendar | null {
    const cals = this.writableCalendars()
    return cals.find((c) => c.id === this.settings.default) ?? cals[0] ?? null
  }

  info(): CalendarInfo[] {
    return this.calendars.map(({ id, name, color, writable, group }) => ({
      id,
      name,
      color,
      writable,
      group,
      enabled: this.isEnabled(id),
    }))
  }

  /** Termine aller aktiven Kalender im Zeitraum. */
  async fetch(start: number, end: number): Promise<{ events: CalEvent[]; errors: string[] }> {
    const events: CalEvent[] = []
    const errors: string[] = []
    await Promise.all(
      this.enabledCalendars().map(async (cal) => {
        try {
          for (const ev of await cal.backend.events(cal, start, end)) {
            events.push({
              ...ev,
              calendarId: cal.id,
              calendarName: cal.name,
              color: cal.color,
              editable: cal.writable && !ev.recurring,
            })
          }
        } catch (e) {
          errors.push(`${cal.name}: ${errorText(e)}`)
        }
      }),
    )
    events.sort(
      (a, b) =>
        Number(!a.allDay) - Number(!b.allDay) || a.start - b.start || a.summary.localeCompare(b.summary, 'de'),
    )
    return { events, errors }
  }

  private find(id: string): Calendar {
    const cal = this.calendars.find((c) => c.id === id)
    if (!cal) throw new DavError('Kalender nicht gefunden')
    return cal
  }

  async save(ev: CalEvent, isNew: boolean): Promise<void> {
    const cal = this.find(ev.calendarId)
    const fields: EventFields = {
      uid: ev.uid || `${randomUUID()}@sip-telefon`,
      summary: ev.summary,
      start: ev.start,
      end: ev.end,
      allDay: ev.allDay,
      location: ev.location,
      description: ev.description,
    }
    await cal.backend.save(cal, fields, ev.href, isNew)
    this.emit('events-changed')
  }

  async delete(ev: CalEvent): Promise<void> {
    const cal = this.find(ev.calendarId)
    await cal.backend.delete(cal, ev.uid, ev.href)
    this.emit('events-changed')
  }

  async refresh(): Promise<void> {
    const backends = new Set(this.calendars.map((c) => c.backend))
    await Promise.all([...backends].map((b) => b.refresh().catch(() => undefined)))
    this.emit('events-changed')
  }
}
