/**
 * Zentrale Kalender: Termine für alle Apps (z. B. Betriebsferien, Schichten,
 * Besprechungsräume) und die gesetzlichen Feiertage des Bundeslandes. Termine liegen
 * je Kalender in data/calendars/<id>.json.
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadJson, saveJson } from './files'
import { holidays, localTime } from './holidays'
import type { CentralCalendar, PbxConfig } from './model'
import { PATHS } from './paths'
import { type CalendarHit, keywordMatch } from './routing'
import { ValidationError } from './store'

/**
 * Termin wie über die Schnittstelle übertragen. Ganztägig: start/end als Datum
 * (JJJJ-MM-TT, Ende exklusiv), sonst ISO-Zeitpunkte mit Zeitzone.
 */
export interface CalendarEvent {
  uid: string
  summary: string
  start: string
  end: string
  allDay: boolean
  location: string
  description: string
  updated: string
}

const DIR = PATHS.calendars
const DATE = /^\d{4}-\d{2}-\d{2}$/

function file(id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new ValidationError('Ungültiger Kalender.')
  return path.join(DIR, `${id}.json`)
}

function ms(value: string): number {
  return Date.parse(value)
}

/** Prüft und vereinheitlicht einen Termin aus der Weboberfläche oder der App. */
export function cleanEvent(raw: Partial<CalendarEvent>, uid?: string): CalendarEvent {
  const allDay = Boolean(raw.allDay)
  const start = String(raw.start ?? '')
  const end = String(raw.end ?? '')
  const valid = (v: string): boolean => (allDay ? DATE.test(v) : !Number.isNaN(ms(v)) && !DATE.test(v))
  if (!String(raw.summary ?? '').trim()) throw new ValidationError('Der Termin braucht einen Titel.')
  if (!valid(start) || !valid(end)) throw new ValidationError('Beginn oder Ende ist ungültig.')
  if (ms(end) < ms(start) || (allDay && ms(end) === ms(start))) throw new ValidationError('Das Ende liegt vor dem Beginn.')
  return {
    uid: uid || String(raw.uid || '') || `${randomUUID()}@phone4all`,
    summary: String(raw.summary).trim().slice(0, 200),
    start,
    end,
    allDay,
    location: String(raw.location ?? '').slice(0, 200),
    description: String(raw.description ?? '').slice(0, 4000),
    updated: new Date().toISOString(),
  }
}

export class CalendarStore {
  /** Ändert sich bei jedem geänderten Termin; die Apps fragen danach. */
  revision = Date.now()

  /** Termine um heute je Kalender, für Regeln nach Kalender (bei jeder Änderung neu) */
  private recent = new Map<string, { revision: number; day: string; events: CalendarEvent[] }>()

  constructor(private cfg: () => PbxConfig) {}

  /** Laufender Termin mit dem Stichwort im Titel (Regeln „bei Termin im Kalender“) */
  current(id: string, keyword: string, now: Date): CalendarHit | null {
    const t = now.getTime()
    const tz = this.cfg().system.timezone
    const today = localTime(now, tz).date
    let cached = this.recent.get(id)
    if (cached?.revision !== this.revision || cached.day !== today) {
      try {
        cached = { revision: this.revision, day: today, events: this.events(id, t - 2 * 86400000, t + 2 * 86400000) }
      } catch {
        return null
      }
      this.recent.set(id, cached)
    }
    for (const e of cached.events) {
      if (!keywordMatch(e.summary, keyword)) continue
      // Ganztägige Termine nach dem Datum in der Zeitzone der Anlage
      const running = e.allDay ? e.start <= today && today < e.end : ms(e.start) <= t && t < ms(e.end)
      if (running) return { summary: e.summary, end: ms(e.end), allDay: e.allDay }
    }
    return null
  }

  private calendar(id: string): CentralCalendar {
    const cal = this.cfg().calendars.find((c) => c.id === id)
    if (!cal) throw new ValidationError('Kalender nicht gefunden.')
    return cal
  }

  private load(id: string): CalendarEvent[] {
    return loadJson<CalendarEvent[]>(file(id), [])
  }

  private save(id: string, events: CalendarEvent[]): void {
    saveJson(file(id), events, 0o644)
    this.revision++
  }

  /** Termine im Zeitraum [start, end) als Millisekunden. */
  events(id: string, start: number, end: number): CalendarEvent[] {
    const cal = this.calendar(id)
    const overlaps = (e: CalendarEvent): boolean => ms(e.start) < end && ms(e.end) > start
    if (cal.kind === 'holidays') {
      const { state } = this.cfg().system
      const result: CalendarEvent[] = []
      for (let y = new Date(start).getUTCFullYear(); y <= new Date(end).getUTCFullYear(); y++) {
        for (const [date, name] of holidays(y, state)) {
          const next = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10)
          result.push({ uid: `${date}-${state}@feiertage.phone4all`, summary: name, start: date, end: next, allDay: true, location: '', description: '', updated: '' })
        }
      }
      return result.filter(overlaps)
    }
    return this.load(id).filter(overlaps).sort((a, b) => ms(a.start) - ms(b.start))
  }

  upsert(id: string, raw: Partial<CalendarEvent>, uid?: string): CalendarEvent {
    if (this.calendar(id).kind !== 'events') throw new ValidationError('In diesen Kalender können keine Termine eingetragen werden.')
    const event = cleanEvent(raw, uid)
    const list = this.load(id).filter((e) => e.uid !== event.uid)
    list.push(event)
    this.save(id, list)
    return event
  }

  remove(id: string, uid: string): void {
    this.calendar(id)
    const list = this.load(id)
    const rest = list.filter((e) => e.uid !== uid)
    if (rest.length === list.length) throw new ValidationError('Termin nicht gefunden.')
    this.save(id, rest)
  }

  /** Termine eines abonnierten Kalenders nach dem Abgleich ersetzen */
  replace(id: string, events: CalendarEvent[]): void {
    if (this.calendar(id).kind !== 'subscription') return
    if (JSON.stringify(events) !== JSON.stringify(this.load(id))) this.save(id, events)
  }

  /** Dateien gelöschter Kalender entfernen. */
  cleanup(): void {
    const known = new Set(this.cfg().calendars.map((c) => `${c.id}.json`))
    try {
      for (const f of fs.readdirSync(DIR)) if (f.endsWith('.json') && !known.has(f)) fs.rmSync(path.join(DIR, f))
    } catch {
      // noch keine Kalender
    }
  }
}
