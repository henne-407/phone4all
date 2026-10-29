/** Telefonlogik: verbindet baresip-Ereignisse mit Anrufzustand, Verlauf und Oberfläche. */

import path from 'node:path'
import { findNumbers, normalizeNumber, numberFromUri } from '../shared/numbers'
import type { Banner, CalEvent, CallInfo, RegKind } from '../shared/types'
import { type AudioConf, Baresip, type BaresipEvent, type EngineState, accountLine, findEngine } from './baresip'
import type { CalendarManager } from './calendars'
import { DIRS, RINGTONE_DIR } from './paths'
import { prepareSoundDir } from './ringtones'
import type { Store } from './store'

const CLOSE_REASONS: [string, string][] = [
  ['486', 'Besetzt'],
  ['busy', 'Besetzt'],
  ['603', 'Abgelehnt'],
  ['decline', 'Abgelehnt'],
  ['404', 'Nummer nicht gefunden'],
  ['not found', 'Nummer nicht gefunden'],
  ['480', 'Nicht erreichbar'],
  ['408', 'Keine Antwort'],
]

export interface Call extends CallInfo {
  declined: boolean
  pendingTransfer: string | null
}

export interface NotifyOptions {
  title: string
  body?: string
  tag: string
  urgent?: boolean
  /** Knöpfe (soweit vom System unterstützt) */
  actions?: { text: string; run: () => void }[]
  onClick?: () => void
}

/** Was die Telefonlogik von Fenstern und System braucht. */
export interface PhoneUi {
  stateChanged(): void
  historyChanged(missed: boolean): void
  toast(text: string): void
  notify(opts: NotifyOptions): void
  withdraw(tag: string): void
  isMainActive(): boolean
  presentMain(): void
  showPopup(call: Call): void
  closePopup(callId: string): void
  showPage(page: string): void
  newEvent(prefill: Partial<CalEvent>): void
  showCalendarEvent(): void
  /** Gespräch angenommen (z. B. Anrufer im CRM öffnen) */
  established(call: Call): void
}

function lastLine(data: string): string {
  const lines = data.trim().split('\n')
  return lines[lines.length - 1] ?? ''
}

export class Phone {
  readonly engine = new Baresip(path.join(DIRS.runtime, 'engine'), path.join(DIRS.state, 'baresip.log'))
  calls = new Map<string, Call>()
  reg: { text: string; kind: RegKind } = { text: 'Startet …', kind: 'busy' }
  banner: Banner | null = null
  upcoming: CalEvent[] = [] // Termine der nächsten 7 Tage
  private restartAfterCall = false
  private pendingMini = false
  private reminded = new Set<string>()
  private engineRunning = false
  engineState: EngineState = 'starting'

  constructor(
    private store: Store,
    private calendar: CalendarManager,
    private ui: PhoneUi,
  ) {
    this.engine.on('event', (ev: BaresipEvent) => this.onEvent(ev))
    this.engine.on('state', (state: EngineState, message: string) => this.onEngineState(state, message))
    setInterval(() => this.checkReminders(), 30000).unref()
    setInterval(() => void this.refreshUpcoming(), 600000).unref()
    calendar.on('calendars-changed', () => void this.refreshUpcoming())
    calendar.on('events-changed', () => void this.refreshUpcoming())
  }

  get dnd(): boolean {
    return Boolean(this.store.settings.dnd)
  }

  private setReg(text: string, kind: RegKind): void {
    this.reg = { text, kind }
    this.ui.stateChanged()
  }

  private setBanner(banner: Banner | null): void {
    this.banner = banner
    this.ui.stateChanged()
  }

  prepareSounds(): string | null {
    try {
      return prepareSoundDir(
        path.join(DIRS.runtime, 'sounds'),
        findEngine()?.soundDir ?? null,
        this.store.settings.ringtone,
        RINGTONE_DIR,
      )
    } catch {
      return null // dann eben die Originaltöne von baresip
    }
  }

  restartEngine(): void {
    const acc = this.store.account
    const line = accountLine(acc, this.store.getPassword())
    if (line === null) {
      this.setReg('Kein Konto eingerichtet', 'off')
      this.setBanner({ text: 'Noch kein SIP-Konto eingerichtet', button: 'Einrichten', action: 'preferences' })
    } else {
      this.setBanner(null)
      this.setReg('Verbinde …', 'busy')
    }
    const audio: AudioConf = { ...this.store.settings.audio, soundDir: this.prepareSounds() }
    void this.engine.start(line, Number(acc.local_port) || 0, audio)
  }

  stop(): Promise<void> {
    return this.engine.stopAndWait()
  }

  // -- Für den Watchdog --------------------------------------------------------

  /** Soll eine Verbindung bestehen? (Konto eingerichtet und nicht abgemeldet) */
  connectionWanted(): boolean {
    return this.store.settings.registered && accountLine(this.store.account, '') !== null
  }

  /** Lebenszeichen: baresip beantwortet eine Abfrage innerhalb von 5 Sekunden. */
  ping(): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000)
      this.engine.send('reginfo', '', (ok) => {
        clearTimeout(timer)
        resolve(ok)
      })
    })
  }

  /** Neu anmelden, ohne baresip neu zu starten */
  reregister(): void {
    this.setReg('Verbinde …', 'busy')
    this.engine.send('uareg', String(Number(this.store.account.regint) || 600))
  }

  // -- Einstellungen mit Wirkung auf die Engine ------------------------------

  setRegistered(registered: boolean): void {
    this.store.settings.registered = registered
    this.store.saveSettings()
    if (registered) {
      this.restartEngine()
    } else {
      this.engine.send('uareg', '0')
      this.setReg('Abgemeldet – keine Anrufe', 'off')
    }
  }

  setRingtone(key: string): void {
    this.store.settings.ringtone = key
    this.store.saveSettings()
    this.prepareSounds() // baresip öffnet die Datei bei jedem Klingeln neu
    this.ui.stateChanged()
  }

  /** kind: Mikrofon ("source"), Lautsprecher ("sink"), Klingeln ("alert") */
  setAudio(kind: 'source' | 'sink' | 'alert', device: string): void {
    const audio = this.store.settings.audio
    if (audio[kind] === device) return
    audio[kind] = device
    this.store.saveSettings()
    this.ui.stateChanged()
    if (kind !== 'alert') this.engine.setDevice(kind, device) // wirkt sofort, auch im laufenden Gespräch
    if (kind === 'alert' || (kind === 'sink' && !audio.alert)) {
      // Das Klingel-Gerät kann baresip nur beim Start setzen
      if (this.calls.size) this.restartAfterCall = true
      else this.restartEngine()
    }
  }

  setDnd(active: boolean): void {
    if (active === this.dnd) return
    this.store.settings.dnd = active
    this.store.saveSettings()
    this.engine.send('dnd', active ? 'yes' : 'no')
    this.ui.stateChanged()
    this.ui.toast(active ? 'Nicht stören ist an – Anrufe werden abgewiesen' : 'Nicht stören ist aus')
  }

  // -- Engine-Ereignisse -----------------------------------------------------

  private onEngineState(state: EngineState, message: string): void {
    this.engineRunning = state === 'running'
    this.engineState = state
    if (state === 'error') {
      this.setReg('Fehler', 'error')
      this.setBanner({ text: message, button: 'Erneut versuchen', action: 'reconnect' })
      for (const id of [...this.calls.keys()]) this.endCall(id, '')
    } else if (state === 'running' && !this.store.account.domain) {
      this.setReg('Kein Konto eingerichtet', 'off')
    } else if (state === 'running') {
      // Die erste Anmeldung kann vor dem Verbindungsaufbau passiert sein
      this.engine.send('reginfo', '', (ok, data) => {
        // Zeilen wie "0 - sip:620@fritz.box   OK|ERR|zzz <Server-Info>"
        const plain = data.replace(/\x1b\[[0-9;]*m/g, '')
        if (!ok) return
        if (/\sOK\s/.test(plain)) this.onRegister('REGISTER_OK', '')
        else if (/\sERR\s/.test(plain)) this.onRegister('REGISTER_FAIL', 'vom Server abgelehnt')
      })
    }
    if (state === 'running' && this.dnd) this.engine.send('dnd', 'yes')
    if (state === 'running' && !this.store.settings.registered) {
      this.engine.send('uareg', '0')
      this.setReg('Abgemeldet – keine Anrufe', 'off')
    }
  }

  private onEvent(ev: BaresipEvent): void {
    const cls = ev.class
    const kind = ev.type ?? ''
    // baresip 4.x meldet Registrierungen in der Klasse "ua", ältere als "register"
    if (['REGISTERING', 'REGISTER_OK', 'REGISTER_FAIL', 'UNREGISTERING'].includes(kind)) {
      this.onRegister(kind, ev.param ?? '')
    } else if (cls === 'call') {
      this.onCallEvent(kind, ev)
    } else if (cls === 'sip' && (ev.param ?? '').startsWith('menu,rejected')) {
      this.onRejected(ev)
    }
  }

  /** Bei „Nicht stören“ abgewiesener Anruf: als verpasst eintragen. */
  private onRejected(ev: BaresipEvent): void {
    const number = numberFromUri(ev.from ?? '')
    const name = this.store.findContact(number)?.name ?? ''
    this.store.addHistory('in', number, name, 0, true)
    this.ui.historyChanged(true)
    this.ui.notify({
      title: `Abgewiesen (Nicht stören): ${name || number}`,
      body: name ? number : '',
      tag: `rejected-${Date.now()}`,
      actions: [{ text: 'Zurückrufen', run: () => this.dial(number, false) }],
      onClick: () => this.ui.presentMain(),
    })
  }

  private onRegister(kind: string, param: string): void {
    const acc = this.store.account
    if (kind === 'REGISTER_OK') {
      this.setReg(`Angemeldet als ${acc.user}@${acc.domain}`, 'ok')
      this.setBanner(null)
    } else if (kind === 'REGISTERING') {
      if (this.reg.kind !== 'ok') this.setReg('Verbinde …', 'busy')
    } else if (kind === 'REGISTER_FAIL') {
      this.setReg('Anmeldung fehlgeschlagen', 'error')
      this.setBanner({ text: `Anmeldung fehlgeschlagen: ${param}`, button: 'Einstellungen', action: 'preferences' })
    } else if (kind === 'UNREGISTERING' && !this.engine.stopping) {
      // Beim Neustart der Engine meldet die alte Instanz sich ab – das ist kein „Abgemeldet“
      this.setReg('Abgemeldet', 'off')
    }
  }

  private onCallEvent(kind: string, ev: BaresipEvent): void {
    const id = ev.id
    if (!id) return
    let call = this.calls.get(id)

    if ((kind === 'CALL_INCOMING' || kind === 'CALL_OUTGOING') && !call) {
      const number = numberFromUri(ev.peeruri ?? '')
      const contact = this.store.findContact(number)
      const direction = kind === 'CALL_INCOMING' ? 'in' : 'out'
      call = {
        id,
        direction,
        number,
        name: contact?.name ?? ev.peerdisplayname ?? '',
        company: contact?.company ?? '',
        state: direction === 'in' ? 'incoming' : 'calling',
        created: Date.now(),
        established: null,
        muted: false,
        held: false,
        remoteHeld: false,
        mini: false,
        transferredTo: null,
        declined: false,
        pendingTransfer: null,
      }
      this.calls.set(id, call)
      if (direction === 'in' && this.isPage(call)) {
        // Durchsage oder Gegensprechen: ohne Klingeln annehmen (die Anlage stellt den Namen voran)
        this.engine.callCommand(id, 'accept')
        this.ui.toast(call.name)
      } else if (direction === 'in') {
        this.ring(call)
      } else {
        call.mini = this.pendingMini
        this.pendingMini = false
        if (call.mini) this.ui.showPopup(call)
        else this.ui.presentMain()
      }
      this.ui.stateChanged()
      return
    }
    if (!call) return

    if ((kind === 'CALL_RINGING' || kind === 'CALL_PROGRESS') && call.state === 'calling') {
      call.state = 'ringing'
    } else if (kind === 'CALL_ESTABLISHED' && call.state !== 'established') {
      call.state = 'established'
      call.established = Date.now()
      this.ui.established(call)
      this.ui.withdraw(`call-${id}`)
      if (!call.mini) this.ui.closePopup(id)
      if (call.pendingTransfer) {
        const target = call.pendingTransfer
        call.pendingTransfer = null
        this.doTransfer(call, target)
      }
    } else if (kind === 'CALL_HOLD') {
      call.remoteHeld = true
    } else if (kind === 'CALL_RESUME') {
      call.remoteHeld = false
    } else if (kind === 'CALL_CLOSED') {
      this.endCall(id, ev.param ?? '')
      return
    } else if (kind === 'TRANSFER_FAILED' && call.transferredTo) {
      call.transferredTo = null
      this.notifyInfo('Weiterleiten fehlgeschlagen', ev.param ?? '')
    } else {
      return
    }
    this.ui.stateChanged()
  }

  /** Durchsage/Gegensprechen der Anlage, die von selbst angenommen werden soll */
  private isPage(call: Call): boolean {
    if (!this.store.settings.auto_answer_page || !/^(Durchsage|Gegensprechen) /.test(call.name)) return false
    return [...this.calls.values()].every((c) => c.id === call.id)
  }

  private ring(call: Call): void {
    this.ui.showPopup(call)
    this.ui.notify({
      title: `Anruf von ${call.name || call.number}`,
      body: call.name ? call.number : 'Eingehender Anruf',
      tag: `call-${call.id}`,
      urgent: true,
      actions: [
        { text: 'Ablehnen', run: () => this.hangup(call.id) },
        { text: 'Annehmen', run: () => this.accept(call.id, 'notification') },
      ],
      onClick: () => this.ui.showPopup(call),
    })
  }

  private endCall(id: string, reason: string): void {
    const call = this.calls.get(id)
    if (!call) return
    this.calls.delete(id)
    this.ui.closePopup(id)
    this.ui.withdraw(`call-${id}`)
    const missed = call.direction === 'in' && call.established === null
    const duration = call.established ? (Date.now() - call.established) / 1000 : 0
    this.store.addHistory(call.direction, call.number, call.name, duration, missed)
    this.ui.historyChanged(missed)

    if (call.transferredTo) {
      this.notifyInfo(`Weitergeleitet an ${call.transferredTo}`, call.name || call.number)
    } else if (missed && call.state === 'incoming' && !call.declined) {
      this.ui.notify({
        title: `Verpasster Anruf von ${call.name || call.number}`,
        body: call.name ? call.number : '',
        tag: `missed-${id}`,
        actions: [{ text: 'Zurückrufen', run: () => this.dial(call.number, false) }],
        onClick: () => this.ui.presentMain(),
      })
    } else if (call.direction === 'out' && call.established === null) {
      const text = CLOSE_REASONS.find(([k]) => reason.toLowerCase().includes(k))?.[1]
      if (text || reason) this.ui.toast(`Anruf beendet: ${text || reason}`)
    }

    if (!this.calls.size) this.pendingMini = false
    if (!this.calls.size && this.restartAfterCall) {
      this.restartAfterCall = false
      this.restartEngine()
    }
    this.ui.stateChanged()
  }

  private notifyInfo(title: string, body = ''): void {
    if (this.ui.isMainActive()) this.ui.toast(title)
    else this.ui.notify({ title, body, tag: `info-${Date.now()}` })
  }

  // -- Aktionen (von der Oberfläche) ---------------------------------------

  /** Das aktuelle Gespräch (nicht klingelnd), sonst ein klingelnder Anruf. */
  activeCall(exclude?: string): Call | null {
    const calls = [...this.calls.values()].filter((c) => c.id !== exclude)
    // Gehaltene Gespräche erst nach dem laufenden (Anklopfen, Makeln)
    calls.sort((a, b) => Number(a.state === 'incoming') - Number(b.state === 'incoming') || Number(a.held) - Number(b.held) || b.created - a.created)
    return calls[0] ?? null
  }

  /** present=false: ohne Hauptfenster wählen (z. B. „Zurückrufen“ aus einer Benachrichtigung). */
  dial(raw: string, present = true): boolean {
    const number = normalizeNumber(raw || '')
    if (!number) return false
    if (!this.engineRunning || this.reg.kind === 'off') {
      this.ui.presentMain()
      this.ui.toast('Keine Verbindung zur Telefonanlage')
      return false
    }
    // Während einer Rückfrage ist das erste Gespräch gehalten – dann darf gewählt werden
    if ([...this.calls.values()].some((c) => c.state !== 'established' || !c.held) || this.calls.size > 1) {
      this.ui.toast('Es läuft bereits ein Gespräch')
      return false
    }
    this.pendingMini = !present && this.store.settings.mini_call
    this.engine.send('dial', number, (ok, data) => {
      if (!ok) this.ui.toast(data.trim() ? 'Anruf fehlgeschlagen: ' + lastLine(data) : 'Anruf fehlgeschlagen')
    })
    if (!this.pendingMini) this.ui.presentMain()
    return true
  }

  /** via: "popup"/"notification" führen das Gespräch im Mini-Fenster (falls eingestellt). */
  accept(id: string, via: 'window' | 'popup' | 'notification' = 'window'): void {
    const call = this.calls.get(id)
    if (!call || call.state !== 'incoming') return
    // Anklopfen: laufende Gespräche halten statt auflegen
    for (const other of this.calls.values()) {
      if (other.id !== id && other.state === 'established' && !other.held) this.setHold(true, other.id)
    }
    this.engine.callCommand(id, 'accept')
    call.mini = via !== 'window' && this.store.settings.mini_call
    if (call.mini) {
      this.ui.showPopup(call)
    } else {
      this.ui.closePopup(id)
      this.ui.presentMain()
    }
    this.ui.stateChanged()
  }

  hangup(id?: string): void {
    const call = id ? this.calls.get(id) : this.activeCall()
    if (!call) return
    call.declined = call.state === 'incoming'
    // baresip: /hangup <call-id> [code reason] – ohne ID würde „486“ als ID gelesen
    this.engine.send('hangup', call.declined ? `${call.id} 486 Busy Here` : call.id)
  }

  private call(id?: string): Call | null {
    return id ? (this.calls.get(id) ?? null) : this.activeCall()
  }

  setMute(muted: boolean, id?: string): void {
    const call = this.call(id)
    if (call && call.muted !== muted) {
      call.muted = muted
      this.engine.callCommand(call.id, 'mute') // baresip schaltet um
      this.ui.stateChanged()
    }
  }

  setHold(held: boolean, id?: string): void {
    const call = this.call(id)
    if (call && call.held !== held) {
      call.held = held
      this.engine.callCommand(call.id, held ? 'hold' : 'resume')
      this.ui.stateChanged()
    }
  }

  /** Makeln: zum gehaltenen Gespräch wechseln, das bisherige wird gehalten */
  switchTo(id: string): void {
    const target = this.calls.get(id)
    if (!target || target.state !== 'established') return
    for (const other of this.calls.values()) {
      if (other.id !== id && other.state === 'established' && !other.held) this.setHold(true, other.id)
    }
    this.setHold(false, id)
  }

  sendDtmf(digit: string, id?: string): void {
    const call = this.call(id)
    if (call && /^[0-9*#]$/.test(digit)) this.engine.callCommand(call.id, 'sndcode', digit)
  }

  stopRinging(): void {
    this.engine.send('stopringing')
  }

  /** Gespräch aus dem Mini-Fenster ins Hauptfenster holen. */
  openInWindow(id: string): void {
    const call = this.calls.get(id)
    if (!call) return
    call.mini = false
    if (call.state !== 'incoming') this.ui.closePopup(id)
    this.ui.presentMain()
    this.ui.stateChanged()
  }

  /** Rückfrage: das Gespräch halten und `target` anrufen */
  consult(id: string, rawTarget: string): boolean {
    const call = this.calls.get(id)
    if (!call || call.state !== 'established' || this.calls.size > 1) return false
    this.setHold(true, id)
    return this.dial(rawTarget)
  }

  /** Nach dem Zusammenführen durch die Anlage (Verbinden oder Dreierkonferenz) */
  afterJoin(mode: 'transfer' | 'conference'): void {
    if (mode === 'transfer') {
      // Die Gegenüber sprechen jetzt miteinander, die eigenen Gespräche sind übrig
      for (const c of this.calls.values()) this.engine.send('hangup', c.id)
      this.notifyInfo('Gespräche verbunden')
      return
    }
    // Das zweite eigene Gespräch legt die Anlage auf, das gehaltene ist jetzt die Konferenz
    setTimeout(() => {
      for (const c of this.calls.values()) if (c.held) this.setHold(false, c.id)
    }, 1500)
  }

  /** Anruf an `target` weiterleiten. Klingelnde Anrufe werden dafür kurz angenommen. */
  transfer(id: string, rawTarget: string): void {
    const call = this.calls.get(id)
    const target = normalizeNumber(rawTarget || '')
    if (!call || !target) return
    if (call.state === 'incoming') {
      call.pendingTransfer = target
      this.accept(id, 'popup')
    } else {
      this.doTransfer(call, target)
    }
  }

  private doTransfer(call: Call, target: string): void {
    call.transferredTo = target
    this.engine.callCommand(call.id, 'transfer', target, (ok, data) => {
      if (ok) {
        // Blind-Weiterleitung: Nach Erfolg beendet die Gegenstelle das Gespräch selbst. Ein
        // Fehlschlag (TRANSFER_FAILED) setzt transferredTo zurück – dann bleibt der Anrufer dran.
        // Kommt gar nichts, den eigenen Teil nach einer Weile selbst beenden.
        setTimeout(() => {
          if (this.calls.has(call.id) && call.transferredTo === target) this.engine.send('hangup', call.id)
        }, 8000)
      } else {
        call.transferredTo = null
        this.notifyInfo('Weiterleiten fehlgeschlagen', data.trim() ? lastLine(data) : '')
      }
    })
  }

  // -- Kalender ----------------------------------------------------------------

  /** Rückruf-Termin für die nächste volle Stunde vorschlagen. */
  scheduleCallback(number: string, name = ''): void {
    const start = new Date()
    start.setHours(start.getHours() + 1, 0, 0, 0)
    this.ui.newEvent({
      summary: `Rückruf: ${name || number}`,
      description: `Telefon: ${number}`,
      start: start.getTime(),
      end: start.getTime() + 15 * 60000,
    })
  }

  async refreshUpcoming(): Promise<void> {
    if (!this.calendar.enabledCalendars().length) {
      this.upcoming = []
    } else {
      const now = Date.now()
      const { events } = await this.calendar.fetch(now - 3600000, now + 7 * 86400000)
      this.upcoming = events
    }
    this.checkReminders()
    this.ui.stateChanged()
  }

  checkReminders(): void {
    const minutes = Number(this.store.settings.calendar.reminder_minutes ?? 10)
    if (minutes <= 0) return
    const now = Date.now()
    for (const ev of this.upcoming) {
      if (ev.allDay) continue
      const key = `${ev.uid}@${ev.start}`
      if (this.reminded.has(key) || !(now <= ev.start && ev.start <= now + minutes * 60000)) continue
      this.reminded.add(key)
      const mins = Math.max(1, Math.round((ev.start - now) / 60000))
      const start = new Date(ev.start)
      const time = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
      const numbers = findNumbers(ev.summary, ev.location, ev.description)
      this.ui.notify({
        title: `In ${mins} Min.: ${ev.summary}`,
        body: time + (ev.location ? ` · ${ev.location}` : ''),
        tag: `reminder-${key}`,
        actions: numbers.length ? [{ text: `${numbers[0]} anrufen`, run: () => this.dial(numbers[0], false) }] : [],
        onClick: () => this.ui.showCalendarEvent(),
      })
    }
  }
}
