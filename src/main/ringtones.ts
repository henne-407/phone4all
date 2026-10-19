/**
 * Klingeltöne: synthetisch erzeugt (kein Download, keine Lizenzfragen) oder eigene Datei.
 *
 * baresip spielt Töne aus seinem audio_path und wiederholt sie in einer Schleife.
 * Wir legen deshalb ein eigenes Sound-Verzeichnis an: die Originaldateien von
 * baresip als Kopie, dazu unser Klingelton und ein deutsches Freizeichen.
 */

import fs from 'node:fs'
import path from 'node:path'

export const RATE = 32000
const PEAK = 0.55 // etwa -5 dBFS, damit es nicht übersteuert

export const RINGTONES = [
  { key: 'marimba', name: 'Marimba', description: 'Sanfte, aufsteigende Melodie' },
  { key: 'chime', name: 'Glocken', description: 'Warme Glockenklänge' },
  { key: 'classic', name: 'Klassisch', description: 'Doppelklingeln wie ein altes Telefon' },
  { key: 'pulse', name: 'Dezent', description: 'Leiser, kurzer Doppelton' },
  { key: 'baresip', name: 'baresip-Standard', description: 'Der ursprüngliche Klingelton' },
  { key: 'custom', name: 'Eigene Datei', description: 'Eine eigene Audiodatei (WAV, MP3, OGG …)' },
]

/** [Start s, Frequenz, Dauer s, Teiltöne [(Verhältnis, Amplitude)], Abklingzeit s, Anschlag s, Lautstärke] */
type Voice = [number, number, number, [number, number][], number, number, number]

function render(length: number, voices: Voice[]): Float64Array {
  const n = Math.floor(length * RATE)
  const buf = new Float64Array(n)
  const fade = Math.floor(0.08 * RATE) // sanft ausblenden statt abschneiden (sonst knackt es)
  for (const [start, freq, dur, partials, decay, attack, gain] of voices) {
    const s0 = Math.floor(start * RATE)
    const count = Math.min(Math.floor(dur * RATE), n - s0)
    for (const [ratio, amp] of partials) {
      const w = (2 * Math.PI * freq * ratio) / RATE
      // Höhere Teiltöne klingen schneller ab (wie bei echten Instrumenten)
      const d = decay / (1 + (ratio - 1) * 0.6)
      for (let i = 0; i < count; i++) {
        const t = i / RATE
        let env = (attack ? Math.min(1, t / attack) : 1) * Math.exp(-t / d)
        if (count - i < fade) env *= (count - i) / fade
        buf[s0 + i] += gain * amp * env * Math.sin(w * i)
      }
    }
  }
  return buf
}

function marimba(): Float64Array {
  // C-Dur-Arpeggio, zweimal, dann Pause – angenehm, aber gut hörbar
  const partials: [number, number][] = [[1, 1], [4, 0.25], [10, 0.06]]
  const notes = [523.25, 659.25, 783.99, 1046.5]
  const voices: Voice[] = []
  for (let rep = 0; rep < 2; rep++) {
    notes.forEach((f, k) => voices.push([rep * 0.9 + k * 0.16, f, 1.2, partials, 0.35, 0.004, 0.8]))
  }
  return render(3.4, voices)
}

function chime(): Float64Array {
  // Glockenartige, leicht unharmonische Teiltöne
  const partials: [number, number][] = [[1, 1], [2, 0.5], [2.76, 0.35], [5.4, 0.15], [8.9, 0.06]]
  return render(3.6, [
    [0, 659.25, 2.5, partials, 0.9, 0.003, 0.6],
    [0.45, 880, 2.5, partials, 0.9, 0.003, 0.5],
    [0.9, 739.99, 2.2, partials, 0.9, 0.003, 0.5],
  ])
}

function classic(): Float64Array {
  // Zwei kurze Klingelstöße: Glockenton mit schnellem Klöppel (ca. 22 Hz)
  const buf = new Float64Array(Math.floor(3 * RATE))
  for (const burst of [0, 0.55]) {
    const s0 = Math.floor(burst * RATE)
    const count = Math.floor(0.4 * RATE)
    for (let i = 0; i < count; i++) {
      const t = i / RATE
      const hammer = 0.6 + 0.4 * Math.sin(2 * Math.PI * 22 * t)
      const fade = Math.min(1, t / 0.01, (0.4 - t) / 0.03)
      const v =
        Math.sin(2 * Math.PI * 1300 * t) * 0.6 + Math.sin(2 * Math.PI * 1650 * t) * 0.4 + Math.sin(2 * Math.PI * 2600 * t) * 0.15
      buf[s0 + i] += v * hammer * fade
    }
  }
  return buf
}

function pulse(): Float64Array {
  const partials: [number, number][] = [[1, 1], [2, 0.15]]
  return render(2.6, [
    [0, 880, 0.5, partials, 0.12, 0.005, 0.7],
    [0.18, 1174.66, 0.6, partials, 0.15, 0.005, 0.7],
  ])
}

/** Deutsches Freizeichen: 425 Hz, 1 s Ton, 4 s Pause. */
function ringback(): Float64Array {
  const buf = new Float64Array(5 * RATE)
  for (let i = 0; i < RATE; i++) {
    const t = i / RATE
    buf[i] = Math.sin(2 * Math.PI * 425 * t) * Math.min(1, t / 0.01, (1 - t) / 0.01) * 0.35
  }
  return buf
}

const GENERATORS: Record<string, () => Float64Array> = { marimba, chime, classic, pulse }

/** 16-Bit-Mono-WAV */
export function encodeWav(samples: ArrayLike<number>, rate = RATE, peak = PEAK): Buffer {
  let top = 0
  for (let i = 0; i < samples.length; i++) top = Math.max(top, Math.abs(samples[i]))
  const scale = peak / (top || 1)
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    // Hauch von Dither gegen Quantisierungsrauschen bei leisen Ausklängen
    const v = Math.round(samples[i] * scale * 32767 + Math.random() - 0.5)
    data.writeInt16LE(Math.max(-32767, Math.min(32767, v)), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

function writeAtomic(file: string, data: Buffer): void {
  fs.writeFileSync(file + '.tmp', data)
  fs.renameSync(file + '.tmp', file)
}

/** Pfad zur WAV-Datei des Klingeltons (wird bei Bedarf erzeugt). */
function toneFile(key: string, cacheDir: string): string {
  fs.mkdirSync(cacheDir, { recursive: true })
  const file = path.join(cacheDir, `ring-${key}.wav`)
  if (GENERATORS[key] && !fs.existsSync(file)) writeAtomic(file, encodeWav(GENERATORS[key]()))
  return file
}

export function ringtonePath(key: string, cacheDir: string, baresipDir: string | null): string | null {
  if (key === 'custom') {
    const file = path.join(cacheDir, 'ring-custom.wav')
    return fs.existsSync(file) ? file : null
  }
  if (GENERATORS[key]) return toneFile(key, cacheDir)
  return baresipDir ? path.join(baresipDir, 'ring.wav') : null
}

/** Eigene Klingeltondatei (bereits als WAV vom Renderer umgewandelt) übernehmen. */
export function saveCustomRingtone(cacheDir: string, wav: Uint8Array): void {
  fs.mkdirSync(cacheDir, { recursive: true })
  writeAtomic(path.join(cacheDir, 'ring-custom.wav'), Buffer.from(wav))
}

/** Sound-Verzeichnis für baresip anlegen und den gewählten Klingelton als ring.wav einsetzen. */
export function prepareSoundDir(target: string, baresipDir: string | null, ringtone: string, cacheDir: string): string {
  fs.mkdirSync(target, { recursive: true })
  if (baresipDir && fs.existsSync(baresipDir)) {
    for (const name of fs.readdirSync(baresipDir)) {
      if (name === 'ring.wav' || name === 'ringback.wav') continue
      const dest = path.join(target, name)
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(baresipDir, name), dest)
    }
  }
  const source = ringtonePath(ringtone, cacheDir, baresipDir) ?? (baresipDir ? path.join(baresipDir, 'ring.wav') : null)
  const ring = path.join(target, 'ring.wav')
  fs.rmSync(ring, { force: true })
  if (source && fs.existsSync(source)) fs.copyFileSync(source, ring)

  const cached = path.join(cacheDir, 'ringback-de.wav')
  if (!fs.existsSync(cached)) {
    fs.mkdirSync(cacheDir, { recursive: true })
    writeAtomic(cached, encodeWav(ringback(), RATE, 0.35))
  }
  fs.copyFileSync(cached, path.join(target, 'ringback.wav'))
  return target
}
