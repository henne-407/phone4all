/**
 * Watchdog der App: überwacht im Hintergrund die SIP-Engine (baresip), die Anmeldung
 * an der Telefonanlage und das Netzwerk und stellt die Verbindung bei Abbruch selbst
 * wieder her – neu anmelden, baresip neu starten, nach Netzwechsel und Ruhezustand
 * neu verbinden. Während eines Gesprächs wird nichts neu gestartet.
 */

import { EventEmitter } from 'node:events'
import os from 'node:os'
import type { CheckLevel, Diagnose, RegKind, WatchCheck, WatchEvent, WatchLevel } from '../shared/types'
import type { EngineState } from './baresip'

/** Was der Watchdog vom Telefon braucht (in Tests ersetzbar). */
export interface PhoneTarget {
  /** Soll eine Verbindung bestehen? (Konto eingerichtet, nicht abgemeldet) */
  wanted(): boolean
  engineState(): EngineState
  regKind(): RegKind
  /** Gespräch läuft */
  busy(): boolean
  /** Lebenszeichen der Engine */
  ping(): Promise<boolean>
  /** Neu anmelden, ohne baresip neu zu starten */
  reregister(): void
  /** baresip neu starten */
  restart(): void
  /** Kennung der Netzwerkadressen; ändert sie sich, wird neu verbunden */
  networkKey(): string
}

const NAMES: Record<WatchCheck['id'], string> = {
  engine: 'SIP-Engine (baresip)',
  registration: 'Anmeldung an der Telefonanlage',
  network: 'Netzwerk',
}

const MAX_EVENTS = 200
const PING_FAILS = 2
const START_TIMEOUT = 60000
/** So lange darf die Anmeldung fehlen, bevor neu angemeldet wird */
const REG_GRACE = 60000
const MAX_ENGINE_BACKOFF = 5 * 60000
const MAX_REG_BACKOFF = 10 * 60000
/** Ab dem wievielten Anmeldeversuch baresip ganz neu gestartet wird */
const REG_RESTART_AFTER = 3

/** Adressen aller aktiven Netzwerkschnittstellen (ohne Loopback und Link-Local). */
export function networkKey(): string {
  const addrs: string[] = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.internal || a.address.startsWith('fe80:') || a.address.startsWith('169.254.')) continue
      addrs.push(`${name}=${a.address}`)
    }
  }
  return addrs.sort().join(' ')
}

/** Ereignisse: 'event' (WatchEvent), 'changed' (Zusammenfassung geändert). */
export class Watchdog extends EventEmitter {
  events: WatchEvent[] = []
  repairs = 0
  checked = 0
  private checks = new Map<WatchCheck['id'], WatchCheck>()
  private running = false
  private timer: NodeJS.Timeout | null = null
  private pingFails = 0
  private startingSince = 0
  private engineAttempts = 0
  private nextEngineAttempt = 0
  private regBadSince = 0
  private regAttempts = 0
  private nextRegAttempt = 0
  private network = ''
  /** Neu verbinden, sobald kein Gespräch mehr läuft (Netzwechsel, Aufwachen) */
  private reconnectPending = ''

  constructor(
    private target: PhoneTarget,
    private enabled: () => boolean,
    private now: () => number = Date.now,
  ) {
    super()
  }

  start(intervalMs = 20000): void {
    if (this.timer) return
    this.network = this.target.networkKey()
    this.timer = setInterval(() => void this.tick(), intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  diagnose(): Diagnose {
    return {
      enabled: this.enabled(),
      checked: this.checked,
      repairs: this.repairs,
      checks: (['engine', 'registration', 'network'] as WatchCheck['id'][]).map(
        (id) => this.checks.get(id) ?? { id, name: NAMES[id], level: 'off', text: 'Noch nicht geprüft', since: 0 },
      ),
      events: [...this.events].reverse(),
    }
  }

  /** Kurzfassung für die Statusanzeige */
  summary(): { level: CheckLevel; text: string; repairs: number } {
    const bad = [...this.checks.values()].filter((c) => c.level === 'error' || c.level === 'warning')
    const level: CheckLevel = !this.enabled()
      ? 'off'
      : bad.some((c) => c.level === 'error')
        ? 'error'
        : bad.length
          ? 'warning'
          : 'ok'
    return { level, text: bad.map((c) => `${c.name}: ${c.text}`).join(' · '), repairs: this.repairs }
  }

  log(level: WatchLevel, text: string): void {
    const ev = { time: this.now(), level, text }
    this.events.push(ev)
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    this.emit('event', ev)
  }

  private set(id: WatchCheck['id'], level: CheckLevel, text: string): void {
    const old = this.checks.get(id)
    if (old && old.level === level && old.text === text) return
    this.checks.set(id, { id, name: NAMES[id], level, text, since: old?.level === level ? old.since : this.now() })
    this.emit('changed')
    if (!old || old.level === level) return
    if (level === 'ok' && (old.level === 'error' || old.level === 'warning')) this.log('ok', `${NAMES[id]}: wieder in Ordnung`)
    else if (level === 'error') this.log('error', `${NAMES[id]}: ${text}`)
  }

  private repair(text: string, action: () => void): void {
    this.repairs++
    this.log('info', text)
    action()
  }

  /** Engine neu starten; die Prüfungen beginnen danach von vorn. */
  private restartEngine(text: string): void {
    this.pingFails = 0
    this.startingSince = 0
    this.regBadSince = this.now()
    this.nextRegAttempt = this.now() + REG_GRACE
    this.repair(text, () => this.target.restart())
  }

  /** Nach dem Aufwachen aus dem Ruhezustand: Verbindungen sind meist tot. */
  onResume(): void {
    if (!this.enabled() || !this.target.wanted()) return
    this.reconnectPending = 'Aus dem Ruhezustand aufgewacht'
    void this.tick()
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await this.check()
      this.checked = this.now()
    } finally {
      this.running = false
    }
  }

  private async check(): Promise<void> {
    const t = this.target
    const now = this.now()
    const network = t.networkKey()
    this.set('network', network ? 'ok' : 'warning', network ? network.replace(/\S+=/g, '').split(' ').join(', ') : 'Keine Netzwerkverbindung')
    if (this.network && network !== this.network && network) this.reconnectPending = 'Netzwerk hat sich geändert'
    this.network = network

    if (!this.enabled() || !t.wanted()) {
      this.reset()
      this.set('engine', 'off', this.enabled() ? 'Kein Konto oder abgemeldet' : 'Überwachung ausgeschaltet')
      this.set('registration', 'off', this.enabled() ? 'Kein Konto oder abgemeldet' : 'Überwachung ausgeschaltet')
      return
    }

    if (this.reconnectPending && network && !t.busy()) {
      const reason = this.reconnectPending
      this.reconnectPending = ''
      this.engineAttempts = 0
      this.restartEngine(`${reason} – verbinde neu`)
      return
    }

    // -- SIP-Engine
    const state = t.engineState()
    if (state !== 'starting') this.startingSince = 0
    if (state === 'error' || state === 'stopped') {
      this.set('engine', 'error', 'Läuft nicht')
      this.set('registration', 'error', 'Keine Verbindung')
      if (now < this.nextEngineAttempt) return
      this.engineAttempts++
      // 10 s, 20 s, 40 s … höchstens 5 Minuten
      this.nextEngineAttempt = now + Math.min(10000 * 2 ** (this.engineAttempts - 1), MAX_ENGINE_BACKOFF)
      this.restartEngine(`SIP-Engine ausgefallen – Neustart (${this.engineAttempts}. Versuch)`)
      return
    }
    if (state === 'starting') {
      if (!this.startingSince) this.startingSince = now
      if (now - this.startingSince > START_TIMEOUT) this.restartEngine('SIP-Engine startet nicht – Neustart')
      else this.set('engine', 'warning', 'Startet …')
      return
    }
    if (!(await t.ping())) {
      this.pingFails++
      this.set('engine', 'warning', 'Antwortet nicht')
      if (this.pingFails >= PING_FAILS && !t.busy()) this.restartEngine('SIP-Engine reagiert nicht – Neustart')
      return
    }
    this.pingFails = 0
    this.engineAttempts = 0
    this.nextEngineAttempt = 0
    this.set('engine', 'ok', 'Läuft')

    // -- Anmeldung
    const reg = t.regKind()
    if (reg === 'ok') {
      this.regBadSince = 0
      this.regAttempts = 0
      this.nextRegAttempt = 0
      this.set('registration', 'ok', 'Angemeldet')
      return
    }
    if (!this.regBadSince) {
      this.regBadSince = now
      this.nextRegAttempt = now + REG_GRACE
    }
    const text = reg === 'error' ? 'Anmeldung fehlgeschlagen' : reg === 'busy' ? 'Verbindet …' : 'Abgemeldet'
    this.set('registration', now - this.regBadSince >= REG_GRACE ? 'error' : 'warning', text)
    if (now < this.nextRegAttempt || t.busy()) return
    this.regAttempts++
    // 1, 2, 4 … höchstens 10 Minuten bis zum nächsten Versuch
    this.nextRegAttempt = now + Math.min(REG_GRACE * 2 ** (this.regAttempts - 1), MAX_REG_BACKOFF)
    if (this.regAttempts % REG_RESTART_AFTER === 0) {
      const next = this.nextRegAttempt
      this.restartEngine(`Anmeldung klappt nicht – SIP-Engine wird neu gestartet (${this.regAttempts}. Versuch)`)
      this.nextRegAttempt = next
    } else {
      this.repair(`Nicht angemeldet – melde neu an (${this.regAttempts}. Versuch)`, () => t.reregister())
    }
  }

  private reset(): void {
    this.pingFails = 0
    this.startingSince = 0
    this.engineAttempts = 0
    this.nextEngineAttempt = 0
    this.regBadSince = 0
    this.regAttempts = 0
    this.nextRegAttempt = 0
    this.reconnectPending = ''
  }
}
