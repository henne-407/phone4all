/**
 * Erinnerungsanrufe (Weckruf): Zur eingestellten Uhrzeit klingeln die Telefone der
 * Nebenstelle, nach dem Abheben spricht die Anlage den Text (oder piept). Nimmt niemand
 * ab, versucht sie es noch zweimal im Abstand von fünf Minuten. Einmalige Erinnerungen
 * (auch per *55HHMM) verschwinden danach.
 */

import { localTime } from './holidays'
import { loadJson, saveJson } from './files'
import type { PbxConfig, Reminder } from './model'
import { newId } from './store'

export interface ReminderDeps {
  config: () => PbxConfig
  /** Konfiguration ändern (prüfen und speichern) */
  update: (change: (draft: PbxConfig) => void) => void
  originate: (fields: Record<string, string>) => Promise<boolean>
  /** Text als Ansage ablegen; Pfad ohne Endung, '' = keine Sprachausgabe */
  speak: (text: string) => Promise<string>
  now?: () => number
}

const ATTEMPTS = 3
const RETRY_MS = 5 * 60000
/** Nach einer Unterbrechung (Neustart) höchstens so spät noch anrufen */
const LATE_MINUTES = 5

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Fällige Erinnerungen jetzt (Schlüssel: Datum und Uhrzeit, damit jede nur einmal klingelt) */
export function dueReminders(cfg: PbxConfig, now: Date, done: Record<string, string>): { reminder: Reminder; key: string }[] {
  const local = localTime(now, cfg.system.timezone)
  const result: { reminder: Reminder; key: string }[] = []
  for (const r of cfg.reminders) {
    if (!r.enabled || !/^\d\d:\d\d$/.test(r.time)) continue
    const key = `${local.date} ${r.time}`
    if (done[r.id] === key) continue
    const late = local.minutes - toMinutes(r.time)
    if (late < 0 || late >= LATE_MINUTES) continue
    if (r.days.length ? !r.days.includes(local.weekday) : r.date !== local.date) continue
    result.push({ reminder: r, key })
  }
  return result
}

export class Reminders {
  private done: Record<string, string>
  private retries = new Map<string, { tries: number; next: number; key: string }>()
  private now: () => number
  private running = false

  constructor(
    private file: string,
    private deps: ReminderDeps,
  ) {
    this.done = loadJson<Record<string, string>>(file, {})
    this.now = deps.now ?? Date.now
  }

  /** *55HHMM: einmalige Erinnerung heute (oder morgen, wenn die Zeit vorbei ist); *55 löscht alle einmaligen */
  feature(ext: string, arg: string): 'on' | 'off' | 'error' {
    const cfg = this.deps.config()
    if (!cfg.extensions.some((e) => e.number === ext)) return 'error'
    if (!arg) {
      const had = cfg.reminders.some((r) => r.extension === ext && !r.days.length)
      if (had) this.deps.update((d) => void (d.reminders = d.reminders.filter((r) => r.extension !== ext || r.days.length > 0)))
      return 'off'
    }
    const m = /^([01]\d|2[0-3])([0-5]\d)$/.exec(arg)
    if (!m) return 'error'
    const time = `${m[1]}:${m[2]}`
    const today = localTime(new Date(this.now()), cfg.system.timezone)
    const date = toMinutes(time) > today.minutes ? today.date : localTime(new Date(this.now() + 86400000), cfg.system.timezone).date
    this.deps.update((d) => void d.reminders.push({ id: newId(), extension: ext, enabled: true, time, days: [], date, text: '' }))
    return 'on'
  }

  private save(): void {
    saveJson(this.file, this.done)
  }

  /** Alle 20 Sekunden: fällige Erinnerungen und Wiederholungen anrufen */
  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await this.run()
    } finally {
      this.running = false
    }
  }

  private async run(): Promise<void> {
    const cfg = this.deps.config()
    const now = this.now()
    // Gelöschte Erinnerungen vergessen
    for (const id of Object.keys(this.done)) if (!cfg.reminders.some((r) => r.id === id)) delete this.done[id]
    for (const { reminder, key } of dueReminders(cfg, new Date(now), this.done)) {
      this.done[reminder.id] = key
      this.retries.set(reminder.id, { tries: 0, next: now, key })
    }
    this.save()
    for (const [id, retry] of [...this.retries]) {
      if (retry.next > now) continue
      const r = cfg.reminders.find((x) => x.id === id)
      if (!r) {
        this.retries.delete(id)
        continue
      }
      retry.tries++
      retry.next = now + RETRY_MS
      const answered = await this.call(r).catch(() => false)
      if (answered || retry.tries >= ATTEMPTS) {
        this.retries.delete(id)
        if (!r.days.length) this.deps.update((d) => void (d.reminders = d.reminders.filter((x) => x.id !== id)))
      }
    }
  }

  private async call(r: Reminder): Promise<boolean> {
    const text = r.text.trim() || `Ihre Erinnerung für ${r.time.replace(/^0/, '')} Uhr.`
    const file = await this.deps.speak(text).catch(() => '')
    const data = file ? `silence/1&${file}&silence/1&${file}` : 'silence/1&beep&silence/1&beep&silence/1&beep'
    return this.deps.originate({
      Action: 'Originate',
      Channel: `Local/${r.extension}@p4a-ring`,
      Application: 'Playback',
      Data: data,
      CallerID: `"Erinnerung ${r.time}" <${r.extension}>`,
      Timeout: '40000',
    })
  }
}
