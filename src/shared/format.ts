/** Zeit- und Datumsformate für die Oberfläche (deutsch). */

import type { CalEvent } from './types'

const pad = (n: number): string => String(n).padStart(2, '0')
const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

export function formatDuration(seconds: number): string {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

export function formatTalk(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} Min.`
  return `${Math.floor(minutes / 60)} Std. ${pad(minutes % 60)} Min.`
}

export function hm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes())
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000)
}

/** Zeitpunkt eines Anrufs: „Heute, 14:30“, „Gestern, …“, „Mo, …“, sonst Datum. */
export function formatTime(ts: number): string {
  const dt = new Date(ts * 1000)
  const days = daysBetween(dt, new Date())
  if (days <= 0) return `Heute, ${hm(dt)}`
  if (days === 1) return `Gestern, ${hm(dt)}`
  if (days < 7) return `${WEEKDAYS_SHORT[dt.getDay()]}, ${hm(dt)}`
  return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()}, ${hm(dt)}`
}

const longDay = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
const shortDay = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const shortDayNoYear = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })
const monthYear = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' })

export function fmtDay(d: Date, long = true): string {
  return (long ? longDay : shortDay).format(d)
}

export function fmtMonth(d: Date): string {
  return monthYear.format(d)
}

export function dayLabel(d: Date): string {
  const today = new Date()
  if (sameDay(d, today)) return 'Heute'
  if (sameDay(d, addDays(today, 1))) return 'Morgen'
  return shortDayNoYear.format(d)
}

function dm(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`
}

export function fmtEventTime(ev: CalEvent, day?: Date): string {
  const start = new Date(ev.start)
  const end = new Date(ev.end)
  if (ev.allDay) {
    const days = Math.round((ev.end - ev.start) / 86400000)
    return days <= 1 ? 'Ganztägig' : `Ganztägig · bis ${fmtDay(addDays(end, -1), false)}`
  }
  const s = day && startOfDay(start) < startOfDay(day) ? `Seit ${dm(start)} ${hm(start)}` : hm(start)
  const e = sameDay(start, end) ? hm(end) : `${dm(end)} ${hm(end)}`
  return `${s} – ${e}`
}

/** Liegt der Termin (auch teilweise) auf dem Tag `day`? */
export function covers(ev: CalEvent, day: Date): boolean {
  const ds = startOfDay(day).getTime()
  const de = addDays(startOfDay(day), 1).getTime()
  if (ev.start === ev.end) return ds <= ev.start && ev.start < de
  return ev.start < de && ev.end > ds
}

/** Anzeige „in 5 Min.“ / „um 14:30“ / „Morgen, 9:00“ */
export function relativeStart(start: number, now = Date.now()): string {
  const delta = start - now
  const d = new Date(start)
  if (delta < 3600000) return `in ${Math.max(1, Math.floor(delta / 60000))} Min.`
  if (sameDay(d, new Date(now))) return `um ${hm(d)}`
  return `${dayLabel(d)}, ${hm(d)}`
}
