/**
 * Gespräche zusammenfassen: Nach einem aufgezeichneten Gespräch einer Nebenstelle mit
 * „Zusammenfassen“ wandelt die Anlage die Aufnahme in Text um und lässt das Sprachmodell
 * Anliegen, Ergebnis und nächste Schritte notieren. Ergebnis in data/summaries/<id>.json,
 * zugestellt per Messenger, E-Mail und Webhook.
 *
 * Rechtlich (§ 201 StGB): nur mit Hinweis an den Anrufer (Hinweisansage) und Zustimmung
 * der Beschäftigten – deshalb ist es je Nebenstelle einzuschalten.
 */

import fs from 'node:fs'
import path from 'node:path'
import { loadJson, saveJson } from './files'
import type { ChatFn } from './llm'

export interface CallSummary {
  /** Linkedid des Gesprächs */
  id: string
  time: number
  extension: string
  direction: 'in' | 'out' | 'internal'
  /** Gegenseite: Rufnummer und Name */
  other: string
  other_name: string
  duration: number
  transcript: string
  summary: string
  error: string
}

export interface SummaryJob {
  id: string
  extension: string
  direction: CallSummary['direction']
  other: string
  other_name: string
  duration: number
}

export interface SummaryDeps {
  transcribe: (file: string) => Promise<string>
  chat: () => ChatFn
  deliver: (s: CallSummary) => void
  now?: () => number
}

export const SUMMARY_PROMPT = `Du fasst Telefongespräche einer Firma für die Beschäftigten zusammen. Schreibe auf Deutsch,
knapp und sachlich, ohne Einleitung:

Anliegen: ein Satz
Ergebnis: ein bis zwei Sätze
Nächste Schritte: Stichpunkte mit Zuständigkeit und Termin, falls genannt (sonst „keine“)

Erfinde nichts. Die Abschrift stammt aus einer automatischen Spracherkennung und kann Fehler enthalten.`

/** Aufnahmen zu einem Gespräch (MixMonitor: <linkedid>-<uniqueid>.wav) */
export function recordingsOf(dir: string, linkedid: string): string[] {
  if (!/^[\w.]+$/.test(linkedid)) return []
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${linkedid}-`) && f.endsWith('.wav'))
      .map((f) => path.join(dir, f))
  } catch {
    return []
  }
}

export class Summaries {
  private queue: { job: SummaryJob; files: string[] }[] = []
  private busy = false

  constructor(
    private dir: string,
    private deps: SummaryDeps,
  ) {}

  private file(id: string): string {
    return path.join(this.dir, `${id.replace(/[^\w.-]/g, '_')}.json`)
  }

  get(id: string): CallSummary | null {
    return loadJson<CallSummary | null>(this.file(id), null)
  }

  /** Neueste zuerst; optional nur einer Nebenstelle */
  list(ext = '', limit = 200): CallSummary[] {
    let names: string[] = []
    try {
      names = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'))
    } catch {
      return []
    }
    return names
      .map((f) => loadJson<CallSummary | null>(path.join(this.dir, f), null))
      .filter((s): s is CallSummary => Boolean(s) && (!ext || s!.extension === ext))
      .sort((a, b) => b.time - a.time)
      .slice(0, limit)
  }

  remove(id: string): void {
    fs.rmSync(this.file(id), { force: true })
  }

  /** Ältere als days Tage löschen (wie die Aufnahmen) */
  prune(days: number): number {
    if (days <= 0) return 0
    const limit = (this.deps.now ?? Date.now)() - days * 86400000
    let removed = 0
    for (const s of this.list('', 100000)) {
      if (s.time < limit) {
        this.remove(s.id)
        removed++
      }
    }
    return removed
  }

  enqueue(job: SummaryJob, files: string[]): void {
    if (!files.length || this.queue.some((q) => q.job.id === job.id) || fs.existsSync(this.file(job.id))) return
    this.queue.push({ job, files })
    void this.next()
  }

  private async next(): Promise<void> {
    if (this.busy) return
    const item = this.queue.shift()
    if (!item) return
    this.busy = true
    try {
      const result = await this.run(item.job, item.files)
      fs.mkdirSync(this.dir, { recursive: true })
      saveJson(this.file(result.id), result)
      this.deps.deliver(result)
    } catch (e) {
      console.error('Zusammenfassung:', (e as Error).message)
    } finally {
      this.busy = false
      void this.next()
    }
  }

  async run(job: SummaryJob, files: string[]): Promise<CallSummary> {
    const result: CallSummary = { ...job, time: (this.deps.now ?? Date.now)(), transcript: '', summary: '', error: '' }
    try {
      const parts: string[] = []
      for (const f of files) parts.push(await this.deps.transcribe(f))
      result.transcript = parts.join('\n').trim()
      if (result.transcript.length < 20) {
        result.error = 'Zu wenig Gesprochenes für eine Zusammenfassung.'
        return result
      }
      const who = job.other_name ? `${job.other_name} (${job.other})` : job.other
      result.summary = await this.deps.chat()(
        [
          { role: 'system', content: SUMMARY_PROMPT },
          { role: 'user', content: `Gespräch von Nebenstelle ${job.extension} mit ${who || 'unbekannt'}, ${Math.round(job.duration / 60)} Minuten.\n\nAbschrift:\n${result.transcript.slice(0, 30000)}` },
        ],
        { maxTokens: 600 },
      )
      if (!result.summary) result.error = 'Das Sprachmodell hat nichts geliefert.'
    } catch (e) {
      result.error = (e as Error).message
    }
    return result
  }
}
