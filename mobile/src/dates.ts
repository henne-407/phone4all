/** Termine nach Tagen ordnen und deutsch beschriften. */

import type { CalendarEvent } from './provisioning'

const DAY = 86400000

/** Lokales Datum als „2026-12-24“ */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Beginn und Ende eines Termins als Zeitpunkte; ganztägige Termine in lokaler Zeit */
export function eventRange(ev: CalendarEvent): [Date, Date] {
  if (ev.allDay) {
    const [y, m, d] = ev.start.split('-').map(Number)
    const [y2, m2, d2] = ev.end.split('-').map(Number)
    return [new Date(y, m - 1, d), new Date(y2, m2 - 1, d2)]
  }
  return [new Date(ev.start), new Date(ev.end)]
}

export interface DayGroup {
  date: string
  label: string
  events: CalendarEvent[]
}

export function dayLabel(date: Date, today = new Date()): string {
  const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diff = Math.round((d - d0) / DAY)
  const text = date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
  if (diff === 0) return `Heute, ${text}`
  if (diff === 1) return `Morgen, ${text}`
  return text
}

/** Termine je Tag (mehrtägige an jedem Tag) ab heute, sortiert */
export function groupByDay(events: CalendarEvent[], from: Date, days: number, today = new Date()): DayGroup[] {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const groups: DayGroup[] = []
  for (let i = 0; i < days; i++) {
    const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const dayEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i + 1)
    const list = events
      .filter((ev) => {
        const [s, e] = eventRange(ev)
        return s < dayEnd && (e > dayStart || (+e === +s && s >= dayStart))
      })
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || +eventRange(a)[0] - +eventRange(b)[0])
    if (list.length) groups.push({ date: isoDate(dayStart), label: dayLabel(dayStart, today), events: list })
  }
  return groups
}

export function timeLabel(ev: CalendarEvent): string {
  if (ev.allDay) return 'ganztägig'
  const [s, e] = eventRange(ev)
  const f = (d: Date): string => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return `${f(s)}–${f(e)}`
}
