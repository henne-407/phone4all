/** Ansagen und Wartemusik: WAV-Dateien (8 kHz, 16 Bit, mono), umgewandelt im Browser. */

import fs from 'node:fs'
import path from 'node:path'
import { writeAtomic } from './files'
import { HttpError } from './http'
import { PATHS } from './paths'
import { safeList } from './store'

export type SoundKind = 'custom' | 'moh'

export function soundDir(kind: string): string {
  if (kind === 'custom') return PATHS.sounds
  if (kind === 'moh') return PATHS.moh
  throw new HttpError(404, 'Unbekannte Art.')
}

/** Prüft den WAV-Kopf: PCM, 16 Bit, mono, 8000 oder 16000 Hz. */
export function checkWav(data: Buffer): { rate: number; seconds: number } {
  if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') {
    throw new HttpError(400, 'Keine WAV-Datei.')
  }
  let pos = 12
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null
  while (pos + 8 <= data.length) {
    const id = data.toString('ascii', pos, pos + 4)
    const size = data.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      fmt = {
        format: data.readUInt16LE(pos + 8),
        channels: data.readUInt16LE(pos + 10),
        rate: data.readUInt32LE(pos + 12),
        bits: data.readUInt16LE(pos + 22),
      }
    } else if (id === 'data' && fmt) {
      if (fmt.format !== 1 || fmt.channels !== 1 || fmt.bits !== 16 || fmt.rate !== 8000) {
        throw new HttpError(400, 'Erwartet wird WAV mit 8 kHz, 16 Bit, mono.')
      }
      return { rate: fmt.rate, seconds: Math.min(size, data.length - pos - 8) / (fmt.rate * 2) }
    }
    pos += 8 + size + (size % 2)
  }
  throw new HttpError(400, 'Unvollständige WAV-Datei.')
}

export function slug(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '')
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'ansage'
  return base
}

export function saveSound(kind: SoundKind, name: string, data: Buffer): string {
  checkWav(data)
  const dir = soundDir(kind)
  const existing = new Set(safeList(dir))
  let file = slug(name)
  for (let i = 2; existing.has(`${file}.wav`); i++) file = `${slug(name)}-${i}`
  writeAtomic(path.join(dir, `${file}.wav`), data)
  return file
}

export function listSounds(kind: SoundKind): { name: string; size: number }[] {
  const dir = soundDir(kind)
  return safeList(dir)
    .filter((f) => /\.(wav|gsm|sln|ulaw|alaw)$/.test(f))
    .map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function soundFile(kind: string, name: string): string {
  if (!/^[\w.-]+$/.test(name)) throw new HttpError(400, 'Ungültiger Dateiname.')
  const file = path.join(soundDir(kind), name)
  if (!fs.existsSync(file)) throw new HttpError(404, 'Datei nicht gefunden.')
  return file
}
