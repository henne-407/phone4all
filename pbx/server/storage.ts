/**
 * Speicher der Anlage: Belegung je Bereich, Aufnahmen auflisten und löschen,
 * Aufnahmen und Voicemails nach der eingestellten Frist aufräumen.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { StorageSettings } from './model'
import { PATHS } from './paths'

export interface Recording {
  name: string
  size: number
  time: number
  /** Gespräch (Anruf-ID vorne im Namen) oder Konferenz */
  kind: 'call' | 'conference'
}

export interface StorageReport {
  free: number | null
  areas: { id: string; name: string; bytes: number }[]
  recordings: Recording[]
}

const DAY = 86400000
const RECORDING = /^[\w.-]+\.wav$/

/** Ordner mit den Voicemails (je Nebenstelle INBOX, Old, … mit msg0000.wav/.txt) */
export function voicemailDir(): string {
  return path.join(PATHS.spool, 'voicemail', 'default')
}

/** Belegte Bytes eines Ordners (rekursiv) */
export function dirSize(dir: string): number {
  let total = 0
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    try {
      if (e.isDirectory()) total += dirSize(p)
      else if (e.isFile()) total += fs.statSync(p).size
    } catch {
      // gerade gelöscht
    }
  }
  return total
}

export function listRecordings(dir = PATHS.recordings): Recording[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(dir).filter((n) => RECORDING.test(n))
  } catch {
    return []
  }
  return names
    .map((name) => {
      const st = fs.statSync(path.join(dir, name))
      return { name, size: st.size, time: st.mtimeMs, kind: name.startsWith('konferenz-') ? ('conference' as const) : ('call' as const) }
    })
    .sort((a, b) => b.time - a.time)
}

/** Pfad einer Aufnahme; null bei ungültigem Namen */
export function recordingFile(name: string, dir = PATHS.recordings): string | null {
  return RECORDING.test(name) && !name.startsWith('.') ? path.join(dir, name) : null
}

export function report(freeBytes: number | null): StorageReport {
  const areas: [string, string, string][] = [
    ['recordings', 'Aufnahmen', PATHS.recordings],
    ['voicemail', 'Voicemail', voicemailDir()],
    ['messenger', 'Messenger', PATHS.messenger],
    ['backups', 'Sicherungen', PATHS.backups],
    ['sounds', 'Ansagen und Wartemusik', path.dirname(PATHS.sounds)],
    ['log', 'Protokolle und Anrufliste', PATHS.log],
  ]
  return {
    free: freeBytes,
    areas: areas.map(([id, name, dir]) => ({ id, name, bytes: dirSize(dir) })),
    recordings: listRecordings(),
  }
}

/** Aufnahmen älter als die Frist löschen; gibt die Zahl der gelöschten Dateien zurück. */
export function expireRecordings(days: number, now = Date.now(), dir = PATHS.recordings): number {
  if (!days) return 0
  let removed = 0
  for (const r of listRecordings(dir)) {
    if (now - r.time < days * DAY) continue
    fs.rmSync(path.join(dir, r.name), { force: true })
    removed++
  }
  return removed
}

/**
 * Voicemails älter als die Frist löschen. Eine Nachricht sind msgNNNN.txt und die
 * Tondateien gleichen Namens; Lücken in der Nummerierung schließt Asterisk beim
 * nächsten Abhören selbst.
 */
export function expireVoicemail(days: number, now = Date.now(), dir = voicemailDir()): number {
  if (!days) return 0
  let removed = 0
  const walk = (d: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        walk(path.join(d, e.name))
        continue
      }
      const m = /^(msg\d{4})\.txt$/.exec(e.name)
      if (!m) continue
      const txt = path.join(d, e.name)
      if (now - fs.statSync(txt).mtimeMs < days * DAY) continue
      for (const f of fs.readdirSync(d)) if (f.startsWith(m[1] + '.')) fs.rmSync(path.join(d, f), { force: true })
      removed++
    }
  }
  walk(dir)
  return removed
}

export function expire(settings: StorageSettings, now = Date.now()): { recordings: number; voicemail: number } {
  return { recordings: expireRecordings(settings.recordings_days, now), voicemail: expireVoicemail(settings.voicemail_days, now) }
}

/** Voicemail-Box einer Nebenstelle zur neuen Nummer mitnehmen */
export function moveMailbox(from: string, to: string, dir = voicemailDir()): void {
  const src = path.join(dir, from)
  const dst = path.join(dir, to)
  if (!/^\d+$/.test(from) || !/^\d+$/.test(to) || !fs.existsSync(src) || fs.existsSync(dst)) return
  fs.renameSync(src, dst)
}

/** Voicemail-Box einer gelöschten Nebenstelle entfernen (eine neue mit derselben Nummer beginnt leer) */
export function removeMailbox(number: string, dir = voicemailDir()): void {
  if (/^\d+$/.test(number)) fs.rmSync(path.join(dir, number), { recursive: true, force: true })
}
