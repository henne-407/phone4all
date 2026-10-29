/**
 * Auswertungen aus der Anrufliste (CDR) und dem Protokoll der Warteschlangen (queue_log):
 * Anrufe je Stunde und Wochentag, Annahmequote je Rufnummer und Gruppe, Gesprächszeit
 * je Nebenstelle und Wartezeiten in Warteschlangen.
 */

import type { CallRecord } from './cdr'
import type { PbxConfig } from './model'

export interface Counter {
  total: number
  answered: number
}

export interface StatsReport {
  from: string
  to: string
  totals: {
    inbound: number
    answered: number
    /** Nicht angenommen oder auf der Voicemail */
    missed: number
    voicemail: number
    outbound: number
    internal: number
    /** Durchschnittliche Gesprächsdauer angenommener Anrufe (s) */
    avg_talk: number
  }
  /** Eingehende Anrufe je Stunde (0–23) */
  by_hour: Counter[]
  /** Eingehende Anrufe je Wochentag (0 = Montag … 6 = Sonntag) */
  by_weekday: Counter[]
  /** Eingehende Anrufe je angerufener Nummer */
  by_number: (Counter & { number: string })[]
  /** Je Nebenstelle: angenommen, nach außen, Gesprächszeit (s) */
  by_extension: { number: string; name: string; answered: number; outbound: number; talk: number }[]
  /** Warteschlangen: Anrufe, angenommen, aufgelegt, Wartezeit (s) */
  queues: { id: string; name: string; calls: number; answered: number; abandoned: number; avg_wait: number; max_wait: number }[]
}

/** CDR-Zeit „2026-10-24 14:05:00“ (Ortszeit des Containers) → ms */
export function cdrMs(start: string): number {
  return new Date(start.replace(' ', 'T')).getTime()
}

const counters = (n: number): Counter[] => Array.from({ length: n }, () => ({ total: 0, answered: 0 }))

/** Zeile aus queue_log: Zeit|Anruf|Warteschlange|Mitglied|Ereignis|Daten… */
export interface QueueEntry {
  time: number
  call: string
  queue: string
  event: string
  data: string[]
}

export function parseQueueLog(text: string): QueueEntry[] {
  const out: QueueEntry[] = []
  for (const line of text.split('\n')) {
    const f = line.trim().split('|')
    if (f.length < 5 || !/^\d+$/.test(f[0])) continue
    out.push({ time: Number(f[0]) * 1000, call: f[1], queue: f[2], event: f[4], data: f.slice(5) })
  }
  return out
}

export function computeStats(cfg: PbxConfig, calls: CallRecord[], queueLog: QueueEntry[], from: number, to: number): StatsReport {
  const inRange = calls.filter((c) => {
    const t = cdrMs(c.start)
    return t >= from && t < to && c.status !== 'blocked'
  })
  const totals = { inbound: 0, answered: 0, missed: 0, voicemail: 0, outbound: 0, internal: 0, avg_talk: 0 }
  const byHour = counters(24)
  const byWeekday = counters(7)
  const byNumber = new Map<string, Counter>()
  const exts = new Map(cfg.extensions.map((e) => [e.number, { number: e.number, name: e.name, answered: 0, outbound: 0, talk: 0 }]))
  let talk = 0
  let talked = 0
  for (const c of inRange) {
    const d = new Date(cdrMs(c.start))
    if (c.direction === 'out') {
      totals.outbound++
      const e = exts.get(c.from)
      if (e) {
        e.outbound++
        e.talk += c.duration
      }
      continue
    }
    if (c.direction === 'internal') {
      totals.internal++
      continue
    }
    const voicemail = c.answeredBy === 'Voicemail'
    const answered = c.status === 'answered' && !voicemail
    totals.inbound++
    if (answered) {
      totals.answered++
      talk += c.duration
      talked++
    } else totals.missed++
    if (voicemail) totals.voicemail++
    const hour = byHour[d.getHours()]
    const day = byWeekday[(d.getDay() + 6) % 7]
    const num = byNumber.get(c.to) ?? { total: 0, answered: 0 }
    for (const k of [hour, day, num]) {
      k.total++
      if (answered) k.answered++
    }
    byNumber.set(c.to, num)
    const e = exts.get(c.answeredBy)
    if (e && answered) {
      e.answered++
      e.talk += c.duration
    }
  }
  totals.avg_talk = talked ? Math.round(talk / talked) : 0

  // Warteschlangen: Wartezeit beim Verbinden (CONNECT) bzw. Auflegen (ABANDON, EXITWITHTIMEOUT)
  const queues = cfg.groups
    .filter((g) => g.mode === 'queue')
    .map((g) => {
      const entries = queueLog.filter((q) => q.queue === `p4a-${g.id}` && q.time >= from && q.time < to)
      const waits: number[] = []
      let answered = 0
      let abandoned = 0
      for (const q of entries) {
        if (q.event === 'CONNECT') {
          answered++
          waits.push(Number(q.data[0]) || 0)
        } else if (q.event === 'ABANDON' || q.event === 'EXITWITHTIMEOUT') {
          if (q.event === 'ABANDON') abandoned++
          waits.push(Number(q.data[2]) || 0)
        }
      }
      const calls = entries.filter((q) => q.event === 'ENTERQUEUE').length
      return {
        id: g.id,
        name: g.name,
        calls,
        answered,
        abandoned,
        avg_wait: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0,
        max_wait: waits.length ? Math.max(...waits) : 0,
      }
    })

  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    totals,
    by_hour: byHour,
    by_weekday: byWeekday,
    by_number: [...byNumber].map(([number, c]) => ({ number, ...c })).sort((a, b) => b.total - a.total),
    by_extension: [...exts.values()].filter((e) => e.answered || e.outbound).sort((a, b) => b.answered + b.outbound - (a.answered + a.outbound)),
    queues,
  }
}

function csvField(v: string | number): string {
  const s = String(v)
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const DIRECTION: Record<CallRecord['direction'], string> = { in: 'eingehend', out: 'ausgehend', internal: 'intern' }
const STATUS: Record<CallRecord['status'], string> = { answered: 'angenommen', missed: 'verpasst', busy: 'besetzt', failed: 'fehlgeschlagen', blocked: 'gesperrt' }

/** Anrufe als CSV (Semikolon, für Excel mit deutschen Einstellungen) */
export function callsCsv(calls: CallRecord[], from: number, to: number): string {
  const rows = calls
    .filter((c) => {
      const t = cdrMs(c.start)
      return t >= from && t < to
    })
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((c) => [c.start, DIRECTION[c.direction], c.from, c.fromName, c.to, c.answeredBy, STATUS[c.status], c.duration].map(csvField).join(';'))
  return ['Beginn;Richtung;Von;Name;An;Angenommen von;Status;Dauer (s)', ...rows].join('\r\n') + '\r\n'
}
