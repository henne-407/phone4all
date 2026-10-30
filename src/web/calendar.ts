/**
 * Kalender im Browser: die zentralen Kalender der Telefonanlage (wie PbxBackend in
 * src/main/calendars.ts). CalDAV-Konten gibt es im Browser nicht – fremde Server
 * erlauben Anfragen von anderen Seiten in der Regel nicht.
 */

import { EventEmitter } from 'node:events'
import type { CalEvent, CalendarInfo, PbxCalendar } from '../shared/types'
import type { Store } from '../main/store'

const pad = (n: number): string => String(n).padStart(2, '0')

/** Ganztägig: „2026-12-24“ → lokale Mitternacht; sonst ISO → ms */
function pbxTime(value: string, allDay: boolean): number {
  if (allDay) {
    const [y, m, d] = value.split('-').map(Number)
    return new Date(y, m - 1, d).getTime()
  }
  return Date.parse(value)
}

function toPbxTime(ms: number, allDay: boolean): string {
  const d = new Date(ms)
  return allDay ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : d.toISOString()
}

interface PbxEvent {
  uid: string
  summary: string
  start: string
  end: string
  allDay: boolean
  location: string
  description: string
}

export interface PbxSource {
  url: string
  name: string
  calendars: PbxCalendar[]
}

/** Ereignisse: 'calendars-changed', 'events-changed' (wie CalendarManager) */
export class WebCalendar extends EventEmitter {
  errors: string[] = []
  loading = false
  private calendars: (PbxCalendar & { group: string })[] = []
  pbxSource: () => PbxSource | null = () => null

  constructor(private store: Store) {
    super()
  }

  private get settings(): Store['settings']['calendar'] {
    return this.store.settings.calendar
  }

  async reload(): Promise<void> {
    const pbx = this.pbxSource()
    this.calendars = pbx?.url ? pbx.calendars.map((c) => ({ ...c, group: pbx.name })) : []
    this.errors = []
    this.emit('calendars-changed')
    this.emit('events-changed')
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

  private id(c: PbxCalendar): string {
    return `pbx:${c.id}`
  }

  enabledCalendars(): (PbxCalendar & { group: string })[] {
    return this.calendars.filter((c) => this.isEnabled(this.id(c)))
  }

  defaultCalendar(): { id: string } | null {
    const writable = this.enabledCalendars().filter((c) => c.writable)
    const found = writable.find((c) => this.id(c) === this.settings.default) ?? writable[0]
    return found ? { id: this.id(found) } : null
  }

  info(): CalendarInfo[] {
    return this.calendars.map((c) => ({ id: this.id(c), name: c.name, color: c.color, writable: c.writable, group: c.group, enabled: this.isEnabled(this.id(c)) }))
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const url = this.pbxSource()?.url
    if (!url) throw new Error('Keine Telefonanlage verbunden')
    let r: Response
    try {
      r = await fetch(`${url}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      })
    } catch {
      throw new Error('Telefonanlage nicht erreichbar')
    }
    if (!r.ok) {
      const data = (await r.json().catch(() => null)) as { error?: string } | null
      throw new Error(data?.error || `Telefonanlage antwortet mit Fehler ${r.status}`)
    }
    return r
  }

  async fetch(start: number, end: number): Promise<{ events: CalEvent[]; errors: string[] }> {
    const events: CalEvent[] = []
    const errors: string[] = []
    await Promise.all(
      this.enabledCalendars().map(async (cal) => {
        try {
          const q = new URLSearchParams({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), calendar: cal.id })
          const list = (await (await this.call('GET', `/events?${q}`)).json()) as PbxEvent[]
          for (const e of list) {
            events.push({
              uid: e.uid,
              summary: e.summary,
              start: pbxTime(e.start, e.allDay),
              end: pbxTime(e.end, e.allDay),
              allDay: e.allDay,
              location: e.location ?? '',
              description: e.description ?? '',
              recurring: false,
              href: '',
              calendarId: this.id(cal),
              calendarName: cal.name,
              color: cal.color,
              editable: cal.writable,
            })
          }
        } catch (e) {
          errors.push(`${cal.name}: ${(e as Error).message}`)
        }
      }),
    )
    events.sort((a, b) => Number(!a.allDay) - Number(!b.allDay) || a.start - b.start || a.summary.localeCompare(b.summary, 'de'))
    return { events, errors }
  }

  private find(id: string): PbxCalendar {
    const cal = this.calendars.find((c) => this.id(c) === id)
    if (!cal) throw new Error('Kalender nicht gefunden')
    return cal
  }

  async save(ev: CalEvent): Promise<void> {
    const cal = this.find(ev.calendarId)
    const uid = ev.uid || `${crypto.randomUUID()}@sip-telefon`
    await this.call('PUT', `/events/${encodeURIComponent(cal.id)}/${encodeURIComponent(uid)}`, {
      summary: ev.summary,
      start: toPbxTime(ev.start, ev.allDay),
      end: toPbxTime(ev.end, ev.allDay),
      allDay: ev.allDay,
      location: ev.location,
      description: ev.description,
    })
    this.emit('events-changed')
  }

  async delete(ev: CalEvent): Promise<void> {
    const cal = this.find(ev.calendarId)
    await this.call('DELETE', `/events/${encodeURIComponent(cal.id)}/${encodeURIComponent(ev.uid)}`)
    this.emit('events-changed')
  }

  async refresh(): Promise<void> {
    this.emit('events-changed')
  }
}
