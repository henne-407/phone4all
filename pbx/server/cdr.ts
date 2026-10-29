/** Anrufliste aus den CDR-Daten von Asterisk (cdr_custom, eine Zeile je Gesprächsabschnitt). */

import fs from 'node:fs'
import path from 'node:path'
import { PATHS } from './paths'

export interface CallRecord {
  id: string
  start: string
  direction: 'in' | 'out' | 'internal'
  from: string
  fromName: string
  to: string
  answeredBy: string
  status: 'answered' | 'missed' | 'busy' | 'failed' | 'blocked'
  duration: number
  recordings: string[]
}

const FIELDS = [
  'start', 'answer', 'end', 'duration', 'billsec', 'disposition', 'src', 'clid', 'dst',
  'dcontext', 'channel', 'dstchannel', 'uniqueid', 'linkedid', 'userfield', 'recordingfile', 'lastapp', 'p4a_to',
] as const
type Row = Record<(typeof FIELDS)[number], string>

export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

function readTail(file: string, bytes: number): string {
  try {
    const fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    const text = buf.toString('utf8')
    return start ? text.slice(text.indexOf('\n') + 1) : text
  } catch {
    return ''
  }
}

/** „PJSIP/10-00000003“ → „10“ (nur Nebenstellen, keine SIP-Konten) */
function extOf(channel: string): string {
  const m = /^PJSIP\/(\d+)-/.exec(channel)
  return m ? m[1] : ''
}

function nameOf(clid: string): string {
  const m = /^"(.*)" <.*>$/.exec(clid)
  return m ? m[1] : ''
}

export function groupCalls(rows: Row[], recordings: string[]): CallRecord[] {
  const calls = new Map<string, Row[]>()
  for (const r of rows) {
    const id = r.linkedid || r.uniqueid
    if (!calls.has(id)) calls.set(id, [])
    calls.get(id)!.push(r)
  }
  const result: CallRecord[] = []
  for (const [id, legs] of calls) {
    const first = legs[0]
    const answered = legs.find((l) => l.disposition === 'ANSWERED' && l.dstchannel) ?? legs.find((l) => l.disposition === 'ANSWERED')
    const direction = legs.some((l) => l.userfield === 'in' || l.userfield === 'blocked') ? 'in' : legs.some((l) => l.userfield === 'out') ? 'out' : 'internal'
    const blocked = legs.some((l) => l.userfield === 'blocked')
    const status = blocked ? 'blocked' : answered ? 'answered' : legs.some((l) => l.disposition === 'BUSY') ? 'busy' : direction === 'out' && legs.some((l) => l.disposition === 'FAILED') ? 'failed' : 'missed'
    result.push({
      id,
      start: first.start,
      direction,
      from: first.src,
      fromName: nameOf(first.clid),
      to: legs.find((l) => l.p4a_to)?.p4a_to || first.dst,
      answeredBy: !answered ? '' : extOf(answered.dstchannel) || (answered.lastapp === 'VoiceMail' ? 'Voicemail' : direction === 'internal' ? '' : 'Anlage'),
      status,
      duration: Math.max(0, ...legs.map((l) => Number(l.billsec) || 0)),
      recordings: recordings.filter((f) => f.startsWith(id + '-')),
    })
  }
  return result.sort((a, b) => b.start.localeCompare(a.start))
}

export function readCalls(limit = 200): CallRecord[] {
  const text = readTail(path.join(PATHS.log, 'cdr-custom', 'cdr.csv'), 4 * 1024 * 1024)
  const rows = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => Object.fromEntries(parseCsvLine(l).map((v, i) => [FIELDS[i], v])) as Row)
  let recordings: string[] = []
  try {
    recordings = fs.readdirSync(PATHS.recordings)
  } catch {
    // noch keine Aufnahmen
  }
  return groupCalls(rows, recordings).slice(0, limit)
}

export function tailLog(lines = 300): string {
  const text = readTail(path.join(PATHS.log, 'messages.log'), 256 * 1024)
  return text.split('\n').slice(-lines).join('\n')
}
