/**
 * Ansagen aus Text: Piper (lokale Sprachausgabe, läuft auch auf dem Raspberry Pi)
 * erzeugt WAV-Dateien. Programm und Stimmen sind groß und werden erst beim ersten
 * Gebrauch aus dem Internet geladen (data/tts), damit das Image klein bleibt. Die
 * Weboberfläche wandelt das Ergebnis wie jede hochgeladene Datei in 8 kHz um.
 */

import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeAtomic } from './files'

const PIPER_RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2'
const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE'

export interface Voice {
  id: string
  name: string
  /** Pfad unterhalb von VOICE_BASE ohne Endung */
  file: string
}

export const VOICES: Voice[] = [
  { id: 'thorsten', name: 'Thorsten (männlich)', file: 'thorsten/medium/de_DE-thorsten-medium' },
  { id: 'kerstin', name: 'Kerstin (weiblich)', file: 'kerstin/low/de_DE-kerstin-low' },
  { id: 'eva', name: 'Eva (weiblich)', file: 'eva_k/x_low/de_DE-eva_k-x_low' },
]

export const MAX_TEXT = 2000

export class TtsError extends Error {}

export interface TtsStatus {
  /** Programm geladen */
  installed: boolean
  /** Geladene Stimmen */
  voices: string[]
  /** Gerade wird geladen */
  installing: string
  error: string
}

function arch(): string {
  const a = os.arch()
  if (a === 'x64') return 'x86_64'
  if (a === 'arm64') return 'aarch64'
  throw new TtsError(`Für diese Hardware (${a}) gibt es keine Sprachausgabe.`)
}

async function fetchFile(url: string, file: string): Promise<void> {
  const r = await fetch(url, { signal: AbortSignal.timeout(300000) })
  if (!r.ok) throw new TtsError(`Download fehlgeschlagen (HTTP ${r.status}): ${url}`)
  writeAtomic(file, Buffer.from(await r.arrayBuffer()))
}

export class Tts {
  installing = ''
  error = ''

  constructor(private dir: string) {}

  private get binary(): string {
    return path.join(this.dir, 'piper', 'piper')
  }

  private voiceFile(id: string): string {
    return path.join(this.dir, 'voices', `${id}.onnx`)
  }

  status(): TtsStatus {
    return {
      installed: fs.existsSync(this.binary),
      voices: VOICES.filter((v) => fs.existsSync(this.voiceFile(v.id)) && fs.existsSync(`${this.voiceFile(v.id)}.json`)).map((v) => v.id),
      installing: this.installing,
      error: this.error,
    }
  }

  /** Programm und Stimme laden (im Hintergrund; Fortschritt über status()) */
  async install(voice: string): Promise<void> {
    const v = VOICES.find((x) => x.id === voice)
    if (!v) throw new TtsError('Unbekannte Stimme.')
    if (this.installing) throw new TtsError('Es wird bereits geladen.')
    this.installing = voice
    this.error = ''
    try {
      if (!fs.existsSync(this.binary)) {
        const tgz = path.join(this.dir, 'piper.tar.gz')
        await fetchFile(`${PIPER_RELEASE}/piper_linux_${arch()}.tar.gz`, tgz)
        await new Promise<void>((resolve, reject) =>
          execFile('tar', ['xzf', tgz, '-C', this.dir], (err) => (err ? reject(new TtsError(`Entpacken fehlgeschlagen: ${err.message}`)) : resolve())),
        )
        fs.rmSync(tgz, { force: true })
      }
      const file = this.voiceFile(v.id)
      if (!fs.existsSync(`${file}.json`)) await fetchFile(`${VOICE_BASE}/${v.file}.onnx.json`, `${file}.json`)
      if (!fs.existsSync(file)) await fetchFile(`${VOICE_BASE}/${v.file}.onnx`, file)
    } catch (e) {
      this.error = (e as Error).message
      throw e
    } finally {
      this.installing = ''
    }
  }

  /** Text sprechen; liefert eine WAV-Datei (Abtastrate der Stimme, meist 22,05 kHz) */
  speak(text: string, voice: string): Promise<Buffer> {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (!clean) return Promise.reject(new TtsError('Bitte einen Text eingeben.'))
    if (clean.length > MAX_TEXT) return Promise.reject(new TtsError(`Höchstens ${MAX_TEXT} Zeichen.`))
    const model = this.voiceFile(voice)
    if (!VOICES.some((v) => v.id === voice) || !fs.existsSync(this.binary) || !fs.existsSync(model)) {
      return Promise.reject(new TtsError('Die Stimme ist noch nicht geladen.'))
    }
    const out = path.join(os.tmpdir(), `p4a-tts-${process.pid}-${Date.now()}.wav`)
    return new Promise((resolve, reject) => {
      const proc = spawn(this.binary, ['--model', model, '--output_file', out, '--sentence_silence', '0.3'], {
        cwd: path.dirname(this.binary),
        env: { ...process.env, LD_LIBRARY_PATH: path.dirname(this.binary) },
        stdio: ['pipe', 'ignore', 'pipe'],
      })
      let err = ''
      const timer = setTimeout(() => proc.kill('SIGKILL'), 60000)
      proc.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
      proc.on('error', (e) => {
        clearTimeout(timer)
        reject(new TtsError(`Sprachausgabe startet nicht: ${e.message}`))
      })
      proc.on('exit', (code) => {
        clearTimeout(timer)
        try {
          if (code !== 0 || !fs.existsSync(out)) return reject(new TtsError(`Sprachausgabe fehlgeschlagen: ${err.trim().split('\n').pop() || code}`))
          resolve(fs.readFileSync(out))
        } finally {
          fs.rmSync(out, { force: true })
        }
      })
      proc.stdin.end(clean)
    })
  }
}
