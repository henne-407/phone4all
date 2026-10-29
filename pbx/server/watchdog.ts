/**
 * Watchdog der Anlage: prüft regelmäßig Asterisk (Prozess und AMI), die Anmeldung
 * der SIP-Konten und den Speicherplatz und behebt Ausfälle selbst – AMI neu
 * verbinden, SIP-Konten neu anmelden, ein hängendes Asterisk neu starten.
 *
 * Ereignisse ('event', WatchEvent) und der Zustand ('status') lassen sich später
 * an Home Assistant oder die Mobile-App weiterreichen.
 */

import { EventEmitter } from 'node:events'
import type { CheckId, CheckLevel, WatchCheck, WatchEvent, WatchLevel, WatchdogStatus } from './model'

export type { CheckId, CheckLevel, WatchCheck, WatchEvent, WatchLevel, WatchdogStatus }

export interface WatchSettings {
  auto_repair: boolean
  /** Minuten, die ein SIP-Konto abgemeldet sein darf, bevor neu angemeldet wird */
  trunk_grace: number
}

/** Was der Watchdog von der Anlage braucht (in Tests ersetzbar). */
export interface WatchTarget {
  state(): 'stopped' | 'starting' | 'running' | 'error'
  /** Asterisk-Prozess läuft */
  processRunning(): boolean
  amiConnected(): boolean
  ping(): Promise<boolean>
  reconnectAmi(): Promise<boolean>
  /** Hart neu starten (Prozess beenden, der Start folgt automatisch) */
  restart(reason: string): Promise<void>
  /** Eingeschaltete SIP-Konten mit Registrierung */
  trunks(): { id: string; name: string }[]
  registrations(): Promise<{ trunk: string; status: string }[]>
  register(trunk: string): Promise<void>
  /** PJSIP-Konfiguration neu laden (fehlende Registrierungen) */
  reloadPjsip(): Promise<void>
  /** Freier Speicher im Datenverzeichnis (Byte), null = unbekannt */
  freeBytes(): number | null
}

const NAMES: Record<CheckId, string> = {
  asterisk: 'Telefonanlage (Asterisk)',
  trunks: 'SIP-Konten',
  disk: 'Speicherplatz',
  security: 'Sicherheit',
}

const MAX_EVENTS = 300
const PING_FAILS = 3
const AMI_FAILS = 3
const START_TIMEOUT = 3 * 60000
/** Mindestabstand zwischen zwei Neustarts durch den Watchdog */
const RESTART_PAUSE = 5 * 60000
const MAX_BACKOFF = 30 * 60000
const DISK_WARN = 500 * 1024 * 1024
const DISK_ERROR = 100 * 1024 * 1024

interface TrunkWatch {
  badSince: number
  status: string
  attempts: number
  nextAttempt: number
}

function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

/** Ereignisse: 'event' (WatchEvent), 'status' (WatchdogStatus). */
export class Watchdog extends EventEmitter {
  events: WatchEvent[] = []
  repairs = 0
  checked = 0
  private checks = new Map<CheckId, WatchCheck>()
  private trunkWatch = new Map<string, TrunkWatch>()
  private pingFails = 0
  private amiFails = 0
  private startingSince = 0
  private lastRestart = 0
  private running = false
  private timer: NodeJS.Timeout | null = null

  constructor(
    private target: WatchTarget,
    private settings: () => WatchSettings,
    private now: () => number = Date.now,
  ) {
    super()
  }

  start(intervalMs = 30000): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  status(): WatchdogStatus {
    return {
      auto_repair: this.settings().auto_repair,
      checked: this.checked,
      repairs: this.repairs,
      checks: (['asterisk', 'trunks', 'disk'] as CheckId[]).map(
        (id) => this.checks.get(id) ?? { id, name: NAMES[id], level: 'ok', text: 'Noch nicht geprüft', since: 0 },
      ),
    }
  }

  /** Schlechtester Zustand aller Prüfungen */
  overall(): CheckLevel {
    const levels = [...this.checks.values()].map((c) => c.level)
    return levels.includes('error') ? 'error' : levels.includes('warning') ? 'warning' : 'ok'
  }

  log(level: WatchLevel, check: CheckId, text: string): void {
    const ev: WatchEvent = { time: this.now(), level, check, text }
    this.events.push(ev)
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    console[level === 'error' ? 'error' : 'log'](`[watchdog] ${text}`)
    this.emit('event', ev)
  }

  /** Zustand einer Prüfung setzen; Wechsel landen im Protokoll. */
  private set(id: CheckId, level: CheckLevel, text: string, logChange = true): void {
    const old = this.checks.get(id)
    if (old && old.level === level && old.text === text) return
    this.checks.set(id, { id, name: NAMES[id], level, text, since: old?.level === level ? old.since : this.now() })
    if (!logChange || !old || (old.level === level && level === 'ok')) return
    if (level === 'ok' && old.level !== 'ok') this.log('ok', id, `${NAMES[id]}: wieder in Ordnung`)
    else if (level !== 'ok' && old.level !== level) this.log(level, id, `${NAMES[id]}: ${text}`)
  }

  private repaired(check: CheckId, text: string): void {
    this.repairs++
    this.log('info', check, text)
  }

  /** Eine Prüfrunde; überlappende Runden werden übersprungen. */
  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await this.checkAsterisk()
      if (this.target.amiConnected()) await this.checkTrunks()
      this.checkDisk()
      this.checked = this.now()
      this.emit('status', this.status())
    } finally {
      this.running = false
    }
  }

  private async restart(reason: string): Promise<void> {
    const now = this.now()
    if (!this.settings().auto_repair) return
    if (now - this.lastRestart < RESTART_PAUSE) return // nicht im Kreis neu starten
    this.lastRestart = now
    this.pingFails = 0
    this.amiFails = 0
    this.startingSince = 0
    this.repaired('asterisk', `Asterisk wird neu gestartet: ${reason}`)
    await this.target.restart(reason).catch((e: Error) => this.log('error', 'asterisk', `Neustart fehlgeschlagen: ${e.message}`))
  }

  private async checkAsterisk(): Promise<void> {
    const t = this.target
    const state = t.state()
    const now = this.now()
    if (state !== 'starting') this.startingSince = 0

    if (state === 'stopped' && !t.processRunning()) {
      this.set('asterisk', 'warning', 'Angehalten')
      return
    }
    if (!t.processRunning()) {
      // Abgestürzt: Asterisk wird vom Verwaltungsdienst schon neu gestartet
      this.set('asterisk', 'error', 'Asterisk läuft nicht und wird neu gestartet')
      return
    }
    if (state === 'starting') {
      if (!this.startingSince) this.startingSince = now
      if (now - this.startingSince > START_TIMEOUT) {
        this.set('asterisk', 'error', 'Asterisk startet nicht vollständig')
        await this.restart('Start hängt seit über 3 Minuten')
      } else {
        this.set('asterisk', 'warning', 'Startet …', false)
      }
      return
    }
    if (!t.amiConnected()) {
      // Prozess läuft, aber die Steuerverbindung ist weg
      this.amiFails++
      this.set('asterisk', 'warning', 'Keine Verbindung zur Steuerschnittstelle (AMI)')
      if (!this.settings().auto_repair) return
      if (await t.reconnectAmi()) {
        this.amiFails = 0
        this.repaired('asterisk', 'Verbindung zur Steuerschnittstelle (AMI) wiederhergestellt')
        this.set('asterisk', 'ok', 'Läuft')
      } else if (this.amiFails >= AMI_FAILS) {
        this.set('asterisk', 'error', 'Steuerschnittstelle (AMI) nicht erreichbar')
        await this.restart('Steuerschnittstelle (AMI) nicht erreichbar')
      }
      return
    }
    this.amiFails = 0
    if (await t.ping()) {
      this.pingFails = 0
      this.set('asterisk', 'ok', 'Läuft')
      return
    }
    this.pingFails++
    if (this.pingFails < PING_FAILS) {
      this.set('asterisk', 'warning', `Antwortet nicht (${this.pingFails}. Versuch)`, false)
      return
    }
    this.set('asterisk', 'error', 'Asterisk reagiert nicht')
    await this.restart(`keine Antwort auf ${PING_FAILS} Prüfungen`)
  }

  private async checkTrunks(): Promise<void> {
    const t = this.target
    const trunks = t.trunks()
    if (!trunks.length) {
      this.trunkWatch.clear()
      this.set('trunks', 'ok', 'Keine SIP-Konten mit Anmeldung')
      return
    }
    let regs: { trunk: string; status: string }[]
    try {
      regs = await t.registrations()
    } catch {
      return // AMI gerade weg, das meldet die Asterisk-Prüfung
    }
    const now = this.now()
    const { auto_repair, trunk_grace } = this.settings()
    const grace = Math.max(1, trunk_grace || 3) * 60000
    const bad: string[] = []
    let failed = false
    let missing = false
    for (const id of [...this.trunkWatch.keys()]) if (!trunks.some((x) => x.id === id)) this.trunkWatch.delete(id)

    for (const trunk of trunks) {
      const status = regs.find((r) => r.trunk === trunk.id)?.status ?? ''
      const w = this.trunkWatch.get(trunk.id)
      if (status === 'Registered') {
        if (w) {
          this.trunkWatch.delete(trunk.id)
          this.log('ok', 'trunks', `SIP-Konto „${trunk.name}“ wieder angemeldet`)
        }
        continue
      }
      const shown = status || 'fehlt'
      if (!w) {
        this.trunkWatch.set(trunk.id, { badSince: now, status: shown, attempts: 0, nextAttempt: now + grace })
        this.log('warning', 'trunks', `SIP-Konto „${trunk.name}“ nicht angemeldet (${shown})`)
        bad.push(`${trunk.name} (${shown})`)
        continue
      }
      w.status = shown
      bad.push(`${trunk.name} (${shown})`)
      if (now - w.badSince >= grace) failed = true
      if (!auto_repair || now < w.nextAttempt) continue
      w.attempts++
      // Wartezeit bis zum nächsten Versuch verdoppeln (Zugangsdaten falsch, Anbieter gestört)
      w.nextAttempt = now + Math.min(grace * 2 ** w.attempts, MAX_BACKOFF)
      if (!status) {
        missing = true
      } else {
        this.repaired('trunks', `SIP-Konto „${trunk.name}“ wird neu angemeldet (${w.attempts}. Versuch)`)
        await t.register(trunk.id).catch((e: Error) => this.log('error', 'trunks', `Neu anmelden fehlgeschlagen: ${e.message}`))
      }
    }
    if (missing) {
      this.repaired('trunks', 'Registrierungen fehlen – SIP-Konfiguration wird neu geladen')
      await t.reloadPjsip().catch(() => undefined)
    }
    // Wiederanmeldungen stehen schon einzeln im Protokoll
    if (!bad.length) this.set('trunks', 'ok', `${trunks.length} angemeldet`, false)
    else this.set('trunks', failed ? 'error' : 'warning', `Nicht angemeldet: ${bad.join(', ')}`, failed)
  }

  private checkDisk(): void {
    const free = this.target.freeBytes()
    if (free === null) return
    if (free < DISK_ERROR) this.set('disk', 'error', `Nur noch ${mb(free)} frei – Aufnahmen und Voicemail löschen`)
    else if (free < DISK_WARN) this.set('disk', 'warning', `Nur noch ${mb(free)} frei`)
    else this.set('disk', 'ok', `${mb(free)} frei`)
  }
}
