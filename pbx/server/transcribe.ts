/**
 * Voicemail als Text: Sprachnachrichten werden nach dem Aufsprechen in Text umgewandelt –
 * lokal mit whisper.cpp (im Image enthalten, Modell wird beim ersten Gebrauch geladen)
 * oder über eine OpenAI-kompatible Schnittstelle (/audio/transcriptions, z. B. ein
 * eigener Speaches-Server). Ergebnisse liegen als JSON unter data/transcripts/<Mailbox>/.
 * Es läuft immer nur eine Umwandlung gleichzeitig, damit Gespräche nicht ruckeln.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeAtomic } from './files'
import type { TranscriptionSettings } from './model'
import { safeList } from './store'

const MODEL_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

export interface WhisperModel {
  id: string
  name: string
  /** Größe in MB */
  size: number
}

export const WHISPER_MODELS: WhisperModel[] = [
  { id: 'base-q5_1', name: 'Klein und schnell (60 MB, ungenauer)', size: 60 },
  { id: 'small-q5_1', name: 'Mittel (190 MB, empfohlen)', size: 190 },
  { id: 'large-v3-turbo-q5_0', name: 'Groß (570 MB, beste Erkennung, ab 4 GB Arbeitsspeicher)', size: 570 },
]

export class TranscribeError extends Error {}

export interface Transcript {
  text: string
  /** Fehlertext, wenn die Umwandlung nicht geklappt hat */
  error: string
  time: number
}

export interface TranscriberStatus {
  /** whisper.cpp ist vorhanden (im Image immer) */
  binary: boolean
  /** Geladene Modelle */
  models: string[]
  /** Gerade wird geladen */
  downloading: string
  error: string
  /** Wartende Nachrichten */
  pending: number
}

interface Job {
  mailbox: string
  id: string
  file: string
  done: (t: Transcript) => void
}

/** whisper.cpp mit AVX2, wenn der Prozessor es kann (sonst die einfache Fassung, z. B. für Celeron) */
function pickBinary(dir: string): string {
  const fast = path.join(dir, 'whisper-cli-avx2')
  if (fs.existsSync(fast)) {
    try {
      const flags = /^flags\s*:(.*)$/m.exec(fs.readFileSync('/proc/cpuinfo', 'utf8'))?.[1].split(/\s+/) ?? []
      if (['avx2', 'fma', 'f16c'].every((f) => flags.includes(f))) return fast
    } catch {
      // kein /proc: einfache Fassung
    }
  }
  return path.join(dir, 'whisper-cli')
}

/** Text aus der Ausgabe von whisper-cli: Zeilen zusammenfügen, Platzhalter wie [Musik] weglassen */
export function cleanText(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]|\([^)]*(Musik|Stille|Rauschen|music|silence)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export class Transcriber {
  downloading = ''
  error = ''
  private queue: Job[] = []
  private busy = false
  private queued = new Set<string>()

  constructor(
    private modelDir: string,
    private outDir: string,
    private binDir: string,
  ) {}

  private modelFile(id: string): string {
    return path.join(this.modelDir, `ggml-${id}.bin`)
  }

  private file(mailbox: string, id: string): string {
    return path.join(this.outDir, mailbox, `${id.replace(/[^\w.-]/g, '_')}.json`)
  }

  status(): TranscriberStatus {
    return {
      binary: fs.existsSync(path.join(this.binDir, 'whisper-cli')),
      models: WHISPER_MODELS.filter((m) => fs.existsSync(this.modelFile(m.id))).map((m) => m.id),
      downloading: this.downloading,
      error: this.error,
      pending: this.queue.length + (this.busy ? 1 : 0),
    }
  }

  /** Modell laden (im Hintergrund; Fortschritt über status()) */
  async install(model: string): Promise<void> {
    if (!WHISPER_MODELS.some((m) => m.id === model)) throw new TranscribeError('Unbekanntes Modell.')
    if (this.downloading) throw new TranscribeError('Es wird bereits geladen.')
    const file = this.modelFile(model)
    if (fs.existsSync(file)) return
    this.downloading = model
    this.error = ''
    try {
      const r = await fetch(`${MODEL_BASE}/ggml-${model}.bin`, { signal: AbortSignal.timeout(30 * 60000) })
      if (!r.ok || !r.body) throw new TranscribeError(`Download fehlgeschlagen (HTTP ${r.status}).`)
      fs.mkdirSync(this.modelDir, { recursive: true })
      const tmp = `${file}.part`
      await fs.promises.writeFile(tmp, r.body as unknown as NodeJS.ReadableStream)
      fs.renameSync(tmp, file)
    } catch (e) {
      this.error = (e as Error).message
      throw e
    } finally {
      this.downloading = ''
    }
  }

  get(mailbox: string, id: string): Transcript | null {
    try {
      return JSON.parse(fs.readFileSync(this.file(mailbox, id), 'utf8')) as Transcript
    } catch {
      return null
    }
  }

  /** Anzahl vorhandener Texte (für das Änderungskennzeichen der Apps) */
  count(mailbox: string): number {
    return safeList(path.join(this.outDir, mailbox)).length
  }

  /** Wartet oder läuft schon */
  pending(mailbox: string, id: string): boolean {
    return this.queued.has(`${mailbox}/${id}`)
  }

  /** Texte gelöschter Nachrichten entfernen */
  prune(mailbox: string, keep: Set<string>): void {
    const dir = path.join(this.outDir, mailbox)
    const names = new Set([...keep].map((id) => path.basename(this.file(mailbox, id))))
    for (const f of safeList(dir)) if (!names.has(f)) fs.rmSync(path.join(dir, f), { force: true })
  }

  /** Nachricht einreihen; done wird mit dem Ergebnis (oder Fehler) aufgerufen, nachdem es gespeichert ist */
  enqueue(settings: () => TranscriptionSettings, mailbox: string, id: string, file: string, done: (t: Transcript) => void = () => {}): void {
    const key = `${mailbox}/${id}`
    if (this.queued.has(key)) return
    this.queued.add(key)
    this.queue.push({ mailbox, id, file, done })
    void this.next(settings)
  }

  private async next(settings: () => TranscriptionSettings): Promise<void> {
    if (this.busy) return
    const job = this.queue.shift()
    if (!job) return
    this.busy = true
    let result: Transcript
    try {
      result = { text: await this.transcribe(settings(), job.file), error: '', time: Date.now() }
    } catch (e) {
      result = { text: '', error: (e as Error).message, time: Date.now() }
    }
    try {
      writeAtomic(this.file(job.mailbox, job.id), JSON.stringify(result))
      job.done(result)
    } catch (e) {
      console.error('Voicemail als Text:', (e as Error).message)
    } finally {
      this.queued.delete(`${job.mailbox}/${job.id}`)
      this.busy = false
      void this.next(settings)
    }
  }

  /** Eine WAV-Datei in Text umwandeln */
  async transcribe(s: TranscriptionSettings, file: string): Promise<string> {
    return cleanText(s.engine === 'api' ? await this.api(s, file) : await this.local(s.model, file))
  }

  private async local(model: string, file: string): Promise<string> {
    const modelFile = this.modelFile(model)
    if (!fs.existsSync(modelFile)) {
      if (!this.downloading) void this.install(model).catch((e: Error) => console.error('Spracherkennung laden:', e.message))
      throw new TranscribeError('Das Sprachmodell wird gerade geladen – die nächsten Nachrichten kommen als Text.')
    }
    const threads = String(Math.max(1, Math.min(4, os.cpus().length - 1)))
    return new Promise((resolve, reject) => {
      const proc = spawn(pickBinary(this.binDir), ['-m', modelFile, '-f', file, '-l', 'de', '-t', threads, '-nt', '-np', '-sns'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      let err = ''
      // Nachrichten sind höchstens 5 Minuten lang; auf langsamer Hardware großzügig warten
      const timer = setTimeout(() => proc.kill('SIGKILL'), 15 * 60000)
      proc.stdout.on('data', (d) => (out += d))
      proc.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
      proc.on('error', (e) => {
        clearTimeout(timer)
        reject(new TranscribeError(`Spracherkennung startet nicht: ${e.message}`))
      })
      proc.on('exit', (code, signal) => {
        clearTimeout(timer)
        if (code === 0) resolve(out)
        else reject(new TranscribeError(signal ? 'Spracherkennung abgebrochen (zu langsam oder zu wenig Arbeitsspeicher).' : `Spracherkennung fehlgeschlagen: ${err.trim().split('\n').pop() || code}`))
      })
    })
  }

  private async api(s: TranscriptionSettings, file: string): Promise<string> {
    const form = new FormData()
    form.append('file', new Blob([fs.readFileSync(file)], { type: 'audio/wav' }), 'voicemail.wav')
    form.append('model', s.api_model || 'whisper-1')
    form.append('language', 'de')
    form.append('response_format', 'json')
    let r: Response
    try {
      r = await fetch(`${s.api_url}/audio/transcriptions`, {
        method: 'POST',
        body: form,
        headers: s.api_key ? { Authorization: `Bearer ${s.api_key}` } : {},
        signal: AbortSignal.timeout(5 * 60000),
      })
    } catch (e) {
      throw new TranscribeError(`Spracherkennung nicht erreichbar: ${(e as Error).message}`)
    }
    const body = await r.text()
    if (!r.ok) {
      let msg = body.slice(0, 200)
      try {
        msg = (JSON.parse(body) as { error?: { message?: string } }).error?.message || msg
      } catch {
        // kein JSON
      }
      throw new TranscribeError(`Spracherkennung: HTTP ${r.status} ${msg}`.trim())
    }
    try {
      return String((JSON.parse(body) as { text?: string }).text ?? '')
    } catch {
      return body
    }
  }
}
