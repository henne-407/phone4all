/**
 * Töne im Browser: Klingeltöne (dieselben synthetischen wie in der Desktop-App oder eine
 * eigene Datei), Freizeichen und Anklopfton. Abgespielt über ein Audio-Element, damit
 * sich das Ausgabegerät wählen lässt (setSinkId).
 */

import { GENERATORS, RATE, RINGTONES, ringback } from '../main/ringtones'

const CUSTOM_KEY = 'phone4all:ringtone-custom'

/** 16-Bit-Mono-WAV (wie encodeWav in src/main/ringtones.ts, ohne Buffer) */
export function encodeWav(samples: ArrayLike<number>, rate = RATE, peak = 0.55): Uint8Array {
  let top = 0
  for (let i = 0; i < samples.length; i++) top = Math.max(top, Math.abs(samples[i]))
  const scale = peak / (top || 1)
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (offset: number, s: string): void => [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.round(samples[i] * scale * 32767))), true)
  }
  return new Uint8Array(view.buffer)
}

/** Kurzer Doppelton beim Anklopfen (während eines Gesprächs), dann Pause */
function waiting(): Float64Array {
  const buf = new Float64Array(3 * RATE)
  for (const start of [0, 0.3]) {
    const s0 = Math.floor(start * RATE)
    for (let i = 0; i < 0.15 * RATE; i++) {
      const t = i / RATE
      buf[s0 + i] = Math.sin(2 * Math.PI * 425 * t) * Math.min(1, t / 0.01, (0.15 - t) / 0.01)
    }
  }
  return buf
}

const cache = new Map<string, Uint8Array>()

function toBase64(data: Uint8Array): string {
  let s = ''
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** WAV eines Tons: Klingeltöne nach Schlüssel, „ringback“ (Freizeichen), „waiting“ (Anklopfen) */
export function toneData(key: string): Uint8Array | null {
  if (key === 'custom') {
    try {
      const raw = localStorage.getItem(CUSTOM_KEY)
      return raw ? fromBase64(raw) : null
    } catch {
      return null
    }
  }
  let data = cache.get(key)
  if (!data) {
    if (key === 'ringback') data = encodeWav(ringback(), RATE, 0.35)
    else if (key === 'waiting') data = encodeWav(waiting(), RATE, 0.3)
    else if (GENERATORS[key]) data = encodeWav(GENERATORS[key]())
    else return null
    cache.set(key, data)
  }
  return data
}

export function saveCustomTone(wav: Uint8Array): void {
  try {
    localStorage.setItem(CUSTOM_KEY, toBase64(wav))
  } catch {
    throw new Error('Die Datei ist zu groß für den Speicher des Browsers. Bitte eine kürzere wählen.')
  }
}

/** Klingeltöne zur Auswahl; den von baresip gibt es im Browser nicht */
export function ringtoneList(): { key: string; name: string; description: string; available: boolean }[] {
  return RINGTONES.filter((r) => r.key !== 'baresip').map((r) => ({ ...r, available: r.key !== 'custom' || toneData('custom') !== null }))
}

/** Spielt einen Ton in Schleife, bis stop() */
export class TonePlayer {
  private audio: HTMLAudioElement | null = null
  private url = ''
  key = ''

  async play(key: string, sinkId = ''): Promise<void> {
    if (this.key === key && this.audio) return
    this.stop()
    const data = toneData(key) ?? toneData('marimba')
    if (!data) return
    this.key = key
    this.url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'audio/wav' }))
    const audio = new Audio(this.url)
    audio.loop = true
    this.audio = audio
    if (sinkId && 'setSinkId' in audio) await audio.setSinkId(sinkId).catch(() => undefined)
    // Ohne vorherigen Klick auf die Seite verbieten manche Browser den Ton; dann bleibt die Benachrichtigung
    if (this.audio === audio) await audio.play().catch(() => undefined)
  }

  stop(): void {
    this.audio?.pause()
    this.audio = null
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = ''
    this.key = ''
  }
}
