/**
 * Rückrufe, die die Anlage selbst auslöst:
 *
 *   ccbs   Rückruf bei besetzt (*37): Sobald Anrufer und Ziel frei sind, klingelt erst der
 *          Anrufer; nimmt er ab, wählt die Anlage das Ziel.
 *   queue  Rückruf statt Warteschleife (Taste 1): Sobald in der Gruppe jemand frei ist, ruft
 *          die Anlage den Anrufer an und stellt ihn an erster Stelle in die Warteschlange.
 *
 * Offene Rückrufe liegen in data/callbacks.json und überstehen einen Neustart.
 */

import { randomUUID } from 'node:crypto'
import { loadJson, saveJson } from './files'
import type { PbxConfig } from './model'
import type { LineState } from './presence'

export interface CallbackRequest {
  id: string
  kind: 'ccbs' | 'queue'
  /** ccbs: Nebenstelle, die zurückgerufen wird · queue: Nummer des Anrufers */
  from: string
  /** ccbs: Nebenstelle, die besetzt war · queue: Gruppe (ID) */
  to: string
  name: string
  created: number
  expires: number
  attempts: number
  /** Frühester nächster Versuch (ms) */
  next: number
}

export interface CallbackDeps {
  config: () => PbxConfig
  /** Zustand einer Nebenstelle aus der Besetztanzeige */
  lineState: (num: string) => LineState
  /** Nebenstelle für die Gruppe angemeldet (nicht abgemeldet, nicht Nicht stören) */
  available: (num: string, gid: string) => boolean
  /** Gespräch über AMI starten; true = angenommen */
  originate: (fields: Record<string, string>) => Promise<boolean>
  /** Gemeldet, wenn ein Rückruf startet oder aufgegeben wird */
  report?: (event: 'started' | 'failed', req: CallbackRequest) => void
  now?: () => number
}

const MAX_ATTEMPTS = 3
/** Pause nach einem nicht angenommenen Rückruf */
const RETRY_MS = 2 * 60000
/** Zuletzt besetzte Nebenstelle für *37 merken */
const BUSY_MS = 10 * 60000

const label = (s: string): string => s.replace(/["<>,|\r\n]/g, ' ').trim()

export class Callbacks {
  private list: CallbackRequest[]
  private lastBusy = new Map<string, { to: string; at: number }>()
  private running = new Set<string>()
  private now: () => number

  constructor(
    private file: string,
    private deps: CallbackDeps,
  ) {
    this.list = loadJson<CallbackRequest[]>(file, []).filter((r) => r && typeof r.id === 'string')
    this.now = deps.now ?? Date.now
  }

  private save(): void {
    saveJson(this.file, this.list)
  }

  all(): CallbackRequest[] {
    this.expire()
    return [...this.list]
  }

  /** Offene Rückrufe einer Nebenstelle (für die Apps) */
  forExtension(ext: string): { id: string; to: string; name: string; expires: number }[] {
    return this.all()
      .filter((r) => r.kind === 'ccbs' && r.from === ext)
      .map((r) => ({ id: r.id, to: r.to, name: r.name, expires: r.expires }))
  }

  /** Wartende Rückrufe einer Gruppe (Wallboard) */
  forGroup(gid: string): CallbackRequest[] {
    return this.all().filter((r) => r.kind === 'queue' && r.to === gid)
  }

  /** Vom Wählplan: Ziel war besetzt */
  busy(ext: string, to: string): void {
    if (ext && to && ext !== to) this.lastBusy.set(ext, { to, at: this.now() })
  }

  private minutes(): number {
    return Math.min(240, Math.max(1, this.deps.config().callback.minutes || 30))
  }

  /**
   * Rückruf bei besetzt anfordern. Ohne Ziel: die zuletzt besetzte Nebenstelle;
   * Ziel „0“ löscht alle eigenen. Ergebnis wie bei Funktionscodes.
   */
  requestCcbs(ext: string, target = ''): 'on' | 'off' | 'error' {
    const cfg = this.deps.config()
    if (!cfg.callback.enabled || !cfg.extensions.some((e) => e.number === ext)) return 'error'
    if (target === '0') {
      const before = this.list.length
      this.list = this.list.filter((r) => !(r.kind === 'ccbs' && r.from === ext))
      if (before !== this.list.length) this.save()
      return 'off'
    }
    let to = target
    if (!to) {
      const last = this.lastBusy.get(ext)
      if (!last || this.now() - last.at > BUSY_MS) return 'error'
      to = last.to
    }
    const dest = cfg.extensions.find((e) => e.number === to)
    if (!dest || to === ext) return 'error'
    // Gleicher Wunsch noch einmal = zurücknehmen
    const same = this.list.find((r) => r.kind === 'ccbs' && r.from === ext && r.to === to)
    if (same && target) {
      this.cancel(same.id)
      return 'off'
    }
    if (!same) this.add('ccbs', ext, to, dest.name || to)
    void this.tick()
    return 'on'
  }

  /** Rückruf aus der Warteschlange (Taste 1) */
  requestQueue(gid: string, number: string, name: string): boolean {
    const cfg = this.deps.config()
    const g = cfg.groups.find((x) => x.id === gid)
    const num = number.replace(/[^\d+]/g, '')
    if (!cfg.callback.enabled || !g?.callback || g.mode !== 'queue' || !/^\+?\d{2,20}$/.test(num)) return false
    if (!this.list.some((r) => r.kind === 'queue' && r.to === gid && r.from === num)) this.add('queue', num, gid, name)
    return true
  }

  private add(kind: CallbackRequest['kind'], from: string, to: string, name: string): void {
    const now = this.now()
    this.list.push({ id: randomUUID(), kind, from, to, name: label(name), created: now, expires: now + this.minutes() * 60000, attempts: 0, next: 0 })
    this.save()
  }

  cancel(id: string, ext = ''): boolean {
    const before = this.list.length
    this.list = this.list.filter((r) => r.id !== id || (ext !== '' && r.from !== ext))
    if (before === this.list.length) return false
    this.save()
    return true
  }

  /** Nebenstelle umbenannt oder gelöscht: Rückrufe mitziehen bzw. verwerfen */
  forget(num: string): void {
    const before = this.list.length
    this.list = this.list.filter((r) => r.kind !== 'ccbs' || (r.from !== num && r.to !== num))
    if (before !== this.list.length) this.save()
  }

  private expire(): void {
    const now = this.now()
    const cfg = this.deps.config()
    const keep = this.list.filter((r) => {
      if (r.expires <= now || r.attempts >= MAX_ATTEMPTS || !cfg.callback.enabled) return false
      if (r.kind === 'queue') return cfg.groups.some((g) => g.id === r.to && g.mode === 'queue' && g.callback)
      return cfg.extensions.some((e) => e.number === r.from) && cfg.extensions.some((e) => e.number === r.to)
    })
    if (keep.length === this.list.length) return
    this.list = keep
    this.save()
  }

  /** Prüfen, ob ein Rückruf jetzt möglich ist (bei jeder Änderung der Besetztanzeige und regelmäßig) */
  async tick(): Promise<void> {
    this.expire()
    const now = this.now()
    const cfg = this.deps.config()
    const busy = new Set<string>()
    for (const r of [...this.list].sort((a, b) => a.created - b.created)) {
      if (r.next > now || this.running.has(r.id)) continue
      if (r.kind === 'ccbs') {
        if (busy.has(r.from) || busy.has(r.to)) continue
        if (this.deps.lineState(r.from) !== 'idle' || this.deps.lineState(r.to) !== 'idle') continue
        busy.add(r.from).add(r.to)
        void this.start(r, {
          Channel: `Local/${r.from}@p4a-originate`,
          Context: 'p4a-from-ext',
          Exten: r.to,
          Priority: '1',
          CallerID: `"Rückruf ${label(r.name)}" <${r.to}>`,
          Variable: `P4A_EXT=${r.from},_P4A_DIAL=${r.to},_P4A_LABEL=Rückruf ${label(r.name)}`,
          Timeout: '30000',
        })
      } else {
        const g = cfg.groups.find((x) => x.id === r.to)
        if (!g) continue
        // Nur wenn jemand frei ist und nicht schon ein anderer Rückruf dieser Gruppe läuft
        if ([...this.running].some((id) => this.list.find((x) => x.id === id)?.to === g.id) || busy.has(g.id)) continue
        const free = g.members.some((m) => this.deps.available(m, g.id) && this.deps.lineState(m) === 'idle')
        if (!free) continue
        busy.add(g.id)
        const internal = cfg.extensions.some((e) => e.number === r.from)
        void this.start(r, {
          Channel: internal ? `Local/${r.from}@p4a-direct` : `Local/${r.from}@p4a-fwd`,
          Context: 'p4a-qcb-in',
          Exten: 's',
          Priority: '1',
          CallerID: `"Rückruf ${label(r.name || r.from)}" <${r.from}>`,
          Variable: `P4A_GID=${g.id},P4A_QNAME=${label(r.name || r.from)},P4A_QNUM=${r.from}`,
          Timeout: '40000',
        })
      }
    }
  }

  private async start(r: CallbackRequest, fields: Record<string, string>): Promise<void> {
    this.running.add(r.id)
    r.attempts++
    this.save()
    this.deps.report?.('started', r)
    let ok = false
    try {
      ok = await this.deps.originate({ Action: 'Originate', ...fields })
    } catch {
      ok = false
    } finally {
      this.running.delete(r.id)
    }
    if (ok) {
      this.list = this.list.filter((x) => x.id !== r.id)
    } else {
      r.next = this.now() + RETRY_MS
      if (r.attempts >= MAX_ATTEMPTS) this.deps.report?.('failed', r)
    }
    this.save()
  }
}
