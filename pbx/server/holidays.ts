/** Gesetzliche Feiertage je Bundesland und die Auswertung von Zeitsteuerungen. */

import type { TimeCondition } from './model'

function easter(year: number): Date {
  // Gaußsche Osterformel (anonymer gregorianischer Algorithmus)
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000)
}

/** Feiertage eines Jahres: Datum (JJJJ-MM-TT) → Name. */
export function holidays(year: number, state: string): Map<string, string> {
  const result = new Map<string, string>()
  const fixed = (month: number, day: number, name: string, states?: string[]): void => {
    if (!states || states.includes(state)) result.set(iso(new Date(Date.UTC(year, month - 1, day))), name)
  }
  const e = easter(year)
  const rel = (offset: number, name: string, states?: string[]): void => {
    if (!states || states.includes(state)) result.set(iso(addDays(e, offset)), name)
  }
  fixed(1, 1, 'Neujahr')
  fixed(1, 6, 'Heilige Drei Könige', ['BW', 'BY', 'ST'])
  fixed(3, 8, 'Internationaler Frauentag', ['BE', 'MV'])
  rel(-2, 'Karfreitag')
  rel(0, 'Ostersonntag', ['BB'])
  rel(1, 'Ostermontag')
  fixed(5, 1, 'Tag der Arbeit')
  rel(39, 'Christi Himmelfahrt')
  rel(49, 'Pfingstsonntag', ['BB'])
  rel(50, 'Pfingstmontag')
  rel(60, 'Fronleichnam', ['BW', 'BY', 'HE', 'NW', 'RP', 'SL'])
  fixed(8, 15, 'Mariä Himmelfahrt', ['SL'])
  fixed(9, 20, 'Weltkindertag', ['TH'])
  fixed(10, 3, 'Tag der Deutschen Einheit')
  fixed(10, 31, 'Reformationstag', ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'])
  fixed(11, 1, 'Allerheiligen', ['BW', 'BY', 'NW', 'RP', 'SL'])
  if (state === 'SN') {
    // Buß- und Bettag: Mittwoch vor dem 23. November
    const nov22 = new Date(Date.UTC(year, 10, 22))
    result.set(iso(addDays(nov22, -((nov22.getUTCDay() + 4) % 7))), 'Buß- und Bettag')
  }
  fixed(12, 25, '1. Weihnachtstag')
  fixed(12, 26, '2. Weihnachtstag')
  return new Map([...result].sort())
}

export interface LocalTime {
  date: string // JJJJ-MM-TT
  weekday: number // 1 = Montag … 7 = Sonntag
  minutes: number // seit Mitternacht
}

export function localTime(now: Date, timezone: string): LocalTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function inClosedDates(date: string, entries: string[]): boolean {
  return entries.some((entry) => {
    const [from, to] = entry.split('..').map((s) => s.trim())
    return to ? date >= from && date <= to : date === from
  })
}

/** Grund, warum geschlossen ist, oder null, wenn geöffnet. */
export function closedReason(tc: TimeCondition, now: Date, state: string, timezone: string): string | null {
  if (tc.override === 'open') return null
  if (tc.override === 'closed') return 'Manuell geschlossen'
  const t = localTime(now, timezone)
  if (inClosedDates(t.date, tc.closed_dates)) return 'Geschlossener Tag'
  if (tc.holidays) {
    const name = holidays(Number(t.date.slice(0, 4)), state).get(t.date)
    if (name) return name
  }
  const open = tc.rules.some((r) => {
    if (!r.days.includes(t.weekday)) return false
    const from = toMinutes(r.from)
    const to = toMinutes(r.to)
    // Über Mitternacht, z. B. 22:00–06:00
    return from <= to ? t.minutes >= from && t.minutes < to : t.minutes >= from || t.minutes < to
  })
  return open ? null : 'Außerhalb der Öffnungszeiten'
}
