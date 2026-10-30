/**
 * Telefonie im Browser: SIP über WebSocket (JsSIP) mit WebRTC, als Gerät „<nummer>-app“
 * der Anlage wie die Mobil-App. Gleiche Schnittstelle wie src/main/phone.ts (baresip),
 * damit die Oberfläche der Desktop-App unverändert bleibt: mehrere Gespräche, Halten,
 * Makeln, Rückfrage, Weiterleiten, Durchsagen, Nicht stören, Verlauf.
 */

import JsSIP from 'jssip'
import type { RTCSession } from 'jssip/lib/RTCSession'
import type { IncomingRTCSessionEvent, RTCSessionEvent } from 'jssip/lib/UA'
import { findNumbers, normalizeNumber, numberFromUri } from '../shared/numbers'
import type { Banner, CalEvent, RegKind, VideoAccount } from '../shared/types'
import type { Call, PhoneUi } from '../main/phone'
import type { Store } from '../main/store'
import { TonePlayer } from './sound'

/** Gründe von JsSIP auf Deutsch */
const CAUSES: Record<string, string> = {
  Busy: 'Besetzt',
  Rejected: 'Abgelehnt',
  'Not Found': 'Nummer nicht gefunden',
  Unavailable: 'Nicht erreichbar',
  'No Answer': 'Keine Antwort',
  'Request Timeout': 'Keine Antwort',
  'Connection Error': 'Keine Verbindung zur Anlage',
  'User Denied Media Access': 'Kein Zugriff auf das Mikrofon',
  'Authentication Error': 'Anmeldung abgelehnt',
  'Address Incomplete': 'Nummer unvollständig',
  'Incompatible SDP': 'Gegenstelle nicht kompatibel',
  'Bad Media Description': 'Gegenstelle nicht kompatibel',
}

/** Was der Browser für Anrufe braucht; '' = alles da */
export function browserProblem(): string {
  if (!window.isSecureContext) return 'Für Anrufe muss die Seite über HTTPS geöffnet sein – sonst gibt der Browser das Mikrofon nicht frei.'
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') return 'Dieser Browser kann nicht telefonieren (WebRTC fehlt).'
  return ''
}

/** SIP über WebSocket immer über die Adresse dieser Seite (gleicher Ursprung, auch hinter dem Proxy) */
export function sameOriginWebsocket(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
}

/** Adresse des Web-Clients über HTTPS, wenn die Anlage eine öffentliche Adresse hat */
function httpsUrl(remote: VideoAccount | null | undefined): string {
  if (!remote || !/^wss:\/\//.test(remote.websocket)) return ''
  return remote.websocket.replace(/^wss:/, 'https:').replace(/\/ws$/, '/web/')
}

interface Line {
  session: RTCSession
  audio: HTMLAudioElement
  /** Die Gegenstelle spielt selbst einen Ton (183 mit SDP) */
  early: boolean
}

export class WebPhone {
  calls = new Map<string, Call>()
  reg: { text: string; kind: RegKind } = { text: 'Startet …', kind: 'busy' }
  banner: Banner | null = null
  upcoming: CalEvent[] = []
  private ua: JsSIP.UA | null = null
  private lines = new Map<string, Line>()
  private ring = new TonePlayer()
  private tone = new TonePlayer()
  private reminded = new Set<string>()
  private counter = 0
  /** Ein anderer Tab dieses Browsers telefoniert (nur einer meldet sich an) */
  standby = false

  constructor(
    private store: Store,
    private ui: PhoneUi,
  ) {
    setInterval(() => this.checkReminders(), 30000)
  }

  get dnd(): boolean {
    return Boolean(this.store.settings.dnd)
  }

  private get remote(): VideoAccount | null {
    return this.store.settings.provisioning.remote ?? null
  }

  private setReg(text: string, kind: RegKind): void {
    this.reg = { text, kind }
    this.ui.stateChanged()
  }

  private setBanner(banner: Banner | null): void {
    this.banner = banner
    this.ui.stateChanged()
  }

  // -- Verbindung ----------------------------------------------------------------

  /** Mit den aktuellen Zugangsdaten neu verbinden (nach Profiländerungen, „Neu verbinden“) */
  restartEngine(): void {
    this.stopUa()
    const remote = this.remote
    const password = this.store.getPassword()
    const problem = browserProblem()
    if (!this.store.settings.provisioning.pbx || !password) {
      this.setBanner(null)
      return this.setReg('Kein Konto eingerichtet', 'off')
    }
    if (!remote) {
      this.setBanner({
        text: 'Telefonieren im Browser braucht den Zugang für Apps der Telefonanlage (Verwaltung → System → Fernzugriff). Alles andere funktioniert auch so.',
        button: 'Neu verbinden',
        action: 'reconnect',
      })
      return this.setReg('Telefonieren im Browser ist auf der Anlage nicht freigegeben', 'off')
    }
    if (problem) {
      const url = httpsUrl(remote)
      this.setBanner({ text: problem, button: url ? 'Mit HTTPS öffnen' : 'Neu verbinden', action: 'reconnect', ...(url ? { url } : {}) })
      return this.setReg('Telefonieren nur über HTTPS', 'off')
    }
    this.setBanner(null)
    if (this.standby) {
      this.setBanner({ text: 'Phone4All telefoniert schon in einem anderen Tab dieses Browsers.', button: 'Hier telefonieren', action: 'reconnect' })
      return this.setReg('Telefoniert in einem anderen Tab', 'off')
    }
    if (!this.store.settings.registered) return this.setReg('Abgemeldet – keine Anrufe', 'off')
    this.setReg('Verbinde …', 'busy')
    const ua = new JsSIP.UA({
      sockets: [new JsSIP.WebSocketInterface(sameOriginWebsocket())],
      uri: `sip:${remote.user}@${remote.domain}`,
      authorization_user: remote.user,
      password,
      display_name: this.store.account.display_name,
      register: true,
      register_expires: 300,
      session_timers: false,
      user_agent: 'Phone4All Web',
      connection_recovery_min_interval: 2,
      connection_recovery_max_interval: 30,
    })
    this.ua = ua
    const acc = this.store.account
    ua.on('registered', () => {
      if (this.ua !== ua) return
      this.setReg(`Angemeldet als ${acc.user || remote.user}@${acc.domain || remote.domain}`, 'ok')
      this.setBanner(null)
    })
    ua.on('unregistered', () => this.ua === ua && this.setReg('Abgemeldet', 'off'))
    ua.on('disconnected', () => this.ua === ua && this.setReg('Keine Verbindung zur Telefonanlage – verbinde neu …', 'busy'))
    ua.on('connecting', () => this.ua === ua && this.reg.kind !== 'ok' && this.setReg('Verbinde …', 'busy'))
    ua.on('registrationFailed', (e: { cause?: string }) => {
      if (this.ua !== ua) return
      const cause = CAUSES[e.cause ?? ''] ?? e.cause ?? ''
      this.setReg('Anmeldung fehlgeschlagen', 'error')
      this.setBanner({ text: `Anmeldung fehlgeschlagen: ${cause}`, button: 'Erneut versuchen', action: 'reconnect' })
    })
    ua.on('newRTCSession', (e: RTCSessionEvent) => {
      if (this.ua === ua && e.originator === 'remote') this.incoming(e as IncomingRTCSessionEvent)
    })
    ua.start()
  }

  private stopUa(): void {
    for (const id of [...this.lines.keys()]) this.endCall(id, '')
    const ua = this.ua
    this.ua = null
    ua?.stop()
  }

  stop(): void {
    this.stopUa()
    this.ring.stop()
    this.tone.stop()
  }

  /** Nach Netzwechsel oder Ruhezustand: Verbindung prüfen */
  wake(): void {
    const ua = this.ua
    if (!ua) return
    if (!ua.isConnected()) ua.start()
    else if (!ua.isRegistered() && this.store.settings.registered) ua.register()
  }

  // -- Einstellungen ---------------------------------------------------------------

  setRegistered(registered: boolean): void {
    this.store.settings.registered = registered
    this.store.saveSettings()
    if (registered) this.restartEngine()
    else {
      this.stopUa()
      this.setReg('Abgemeldet – keine Anrufe', 'off')
    }
  }

  setRingtone(key: string): void {
    this.store.settings.ringtone = key
    this.store.saveSettings()
    this.ui.stateChanged()
  }

  /** kind: Mikrofon ("source"), Lautsprecher ("sink"), Klingeln ("alert") */
  setAudio(kind: 'source' | 'sink' | 'alert', device: string): void {
    const audio = this.store.settings.audio
    if (audio[kind] === device) return
    audio[kind] = device
    this.store.saveSettings()
    // Lautsprecher wirkt sofort, auch im laufenden Gespräch
    if (kind === 'sink') for (const line of this.lines.values()) void this.applySink(line.audio)
    this.ui.stateChanged()
  }

  setDnd(active: boolean): void {
    if (active === this.dnd) return
    this.store.settings.dnd = active
    this.store.saveSettings()
    this.ui.stateChanged()
    this.ui.toast(active ? 'Nicht stören ist an – Anrufe werden abgewiesen' : 'Nicht stören ist aus')
  }

  private async applySink(audio: HTMLAudioElement): Promise<void> {
    const sink = this.store.settings.audio.sink
    if ('setSinkId' in audio) await audio.setSinkId(sink || '').catch(() => undefined)
  }

  // -- Medien -------------------------------------------------------------------------

  private mediaConstraints(): MediaStreamConstraints {
    const source = this.store.settings.audio.source
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    return { audio: source ? { ...audio, deviceId: source } : audio, video: false }
  }

  private pcConfig(): RTCConfiguration {
    return { iceServers: this.remote?.ice_servers ?? [], bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' }
  }

  /**
   * JsSIP wartet sonst, bis alle Kandidaten gesammelt sind – mit TURN über TCP kann das
   * viele Sekunden dauern. Ein Weg über TURN reicht; sonst nach kurzer Zeit weiter.
   */
  private fastIce(session: RTCSession): void {
    let timer: ReturnType<typeof setTimeout> | null = null
    session.on('icecandidate', (e) => {
      if (/ typ relay /.test(e.candidate.candidate)) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => e.ready(), 150)
      } else if (!timer) {
        timer = setTimeout(() => e.ready(), 2000)
      }
    })
  }

  /** Ton der Gegenstelle an das Audio-Element des Gesprächs hängen */
  private attach(pc: RTCPeerConnection, line: Line): void {
    const show = (): void => {
      const tracks = pc.getReceivers().map((r) => r.track).filter((t) => t?.kind === 'audio')
      if (!tracks.length) return
      line.audio.srcObject = new MediaStream(tracks)
      void line.audio.play().catch(() => undefined)
    }
    pc.addEventListener('track', show)
    show()
  }

  /** Klingeln, Freizeichen oder Anklopfton passend zu allen Gesprächen */
  private updateTones(): void {
    const calls = [...this.calls.values()]
    const talking = calls.some((c) => c.state === 'established' && !c.held)
    const ringing = calls.some((c) => c.state === 'incoming')
    const { alert, sink } = this.store.settings.audio
    if (ringing && !talking) void this.ring.play(this.store.settings.ringtone, alert || sink)
    else this.ring.stop()
    const waiting = ringing && talking
    const calling = calls.find((c) => c.direction === 'out' && (c.state === 'calling' || c.state === 'ringing') && !this.lines.get(c.id)?.early)
    if (waiting) void this.tone.play('waiting', sink)
    else if (calling?.state === 'ringing') void this.tone.play('ringback', sink)
    else this.tone.stop()
  }

  private changed(): void {
    this.updateTones()
    this.ui.stateChanged()
  }

  // -- Gespräche ------------------------------------------------------------------------

  private newCall(direction: 'in' | 'out', number: string, displayName: string): Call {
    const contact = this.store.findContact(number)
    return {
      id: `web-${Date.now()}-${++this.counter}`,
      direction,
      number,
      name: contact?.name ?? displayName,
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
  }

  private track(call: Call, session: RTCSession): Line {
    const audio = new Audio()
    audio.autoplay = true
    void this.applySink(audio)
    const line: Line = { session, audio, early: false }
    this.calls.set(call.id, call)
    this.lines.set(call.id, line)
    this.fastIce(session)
    session.on('peerconnection', (e) => this.attach(e.peerconnection, line))
    session.on('progress', (e: { originator: string; response?: { body?: string } }) => {
      if (call.state === 'calling') call.state = 'ringing'
      // 183 mit SDP: Die Anlage spielt selbst Freizeichen oder Ansage
      if (e.originator === 'remote' && e.response?.body) line.early = true
      this.changed()
    })
    const established = (): void => {
      if (call.state === 'established') return
      call.state = 'established'
      call.established = Date.now()
      this.ui.established(call)
      this.ui.withdraw(`call-${call.id}`)
      if (call.pendingTransfer) {
        const target = call.pendingTransfer
        call.pendingTransfer = null
        this.doTransfer(call, target)
      }
      this.changed()
    }
    session.on('accepted', established)
    session.on('confirmed', established)
    session.on('hold', (e) => {
      if (e.originator === 'remote') call.remoteHeld = true
      this.changed()
    })
    session.on('unhold', (e) => {
      if (e.originator === 'remote') call.remoteHeld = false
      this.changed()
    })
    session.on('ended', (e) => this.endCall(call.id, e.cause))
    session.on('failed', (e) => this.endCall(call.id, e.cause))
    return line
  }

  private incoming(e: IncomingRTCSessionEvent): void {
    const session = e.session
    const number = numberFromUri(session.remote_identity.uri.toString())
    const display = session.remote_identity.display_name ?? ''
    if (this.dnd) {
      session.terminate({ status_code: 486, reason_phrase: 'Busy Here' })
      const name = this.store.findContact(number)?.name ?? display
      this.store.addHistory('in', number, name, 0, true)
      this.ui.historyChanged(true)
      this.ui.notify({ title: `Abgewiesen (Nicht stören): ${name || number}`, body: name ? number : '', tag: `rejected-${Date.now()}` })
      return
    }
    const call = this.newCall('in', number, display)
    this.track(call, session)
    // Durchsage/Gegensprechen der Anlage (Call-Info oder Name mit Präfix)
    const page = /answer-after=0/.test(e.request.getHeader('Call-Info') ?? '') || /^(Durchsage|Gegensprechen) /.test(display)
    if (page && this.store.settings.auto_answer_page && this.calls.size === 1) {
      this.answer(call)
      this.ui.toast(call.name || display)
    } else {
      this.ui.presentMain()
      this.ui.notify({
        title: `Anruf von ${call.name || call.number}`,
        body: call.name ? call.number : 'Eingehender Anruf',
        tag: `call-${call.id}`,
        urgent: true,
        onClick: () => this.ui.presentMain(),
      })
    }
    this.changed()
  }

  private endCall(id: string, reason: string): void {
    const call = this.calls.get(id)
    const line = this.lines.get(id)
    if (!call) return
    this.calls.delete(id)
    this.lines.delete(id)
    if (line) {
      line.audio.srcObject = null
      if (!line.session.isEnded()) {
        try {
          line.session.terminate()
        } catch {
          // schon beendet
        }
      }
    }
    this.ui.withdraw(`call-${id}`)
    const missed = call.direction === 'in' && call.established === null
    const duration = call.established ? (Date.now() - call.established) / 1000 : 0
    this.store.addHistory(call.direction, call.number, call.name, duration, missed)
    this.ui.historyChanged(missed)
    if (call.transferredTo) {
      this.notifyInfo(`Weitergeleitet an ${call.transferredTo}`, call.name || call.number)
    } else if (missed && call.state === 'incoming' && !call.declined) {
      this.ui.notify({ title: `Verpasster Anruf von ${call.name || call.number}`, body: call.name ? call.number : '', tag: `missed-${id}` })
    } else if (call.direction === 'out' && call.established === null && reason && reason !== 'Canceled') {
      this.ui.toast(`Anruf beendet: ${CAUSES[reason] ?? reason}`)
    }
    this.changed()
  }

  private notifyInfo(title: string, body = ''): void {
    if (this.ui.isMainActive()) this.ui.toast(title)
    else this.ui.notify({ title, body, tag: `info-${Date.now()}` })
  }

  /** Das aktuelle Gespräch (nicht klingelnd), sonst ein klingelnder Anruf. */
  activeCall(exclude?: string): Call | null {
    const calls = [...this.calls.values()].filter((c) => c.id !== exclude)
    calls.sort((a, b) => Number(a.state === 'incoming') - Number(b.state === 'incoming') || Number(a.held) - Number(b.held) || b.created - a.created)
    return calls[0] ?? null
  }

  private target(number: string): string {
    const domain = this.remote?.domain ?? ''
    if (number.startsWith('sip:')) return number
    if (number.includes('@')) return `sip:${number}`
    return `sip:${encodeURIComponent(number).replace(/%2B/g, '+').replace(/%2A/g, '*')}@${domain}`
  }

  dial(raw: string): boolean {
    const number = normalizeNumber(raw || '')
    if (!number) return false
    const ua = this.ua
    if (!ua || this.reg.kind === 'off' || this.reg.kind === 'error') {
      this.ui.presentMain()
      this.ui.toast(this.banner?.text ?? 'Keine Verbindung zur Telefonanlage')
      return false
    }
    // Während einer Rückfrage ist das erste Gespräch gehalten – dann darf gewählt werden
    if ([...this.calls.values()].some((c) => c.state !== 'established' || !c.held) || this.calls.size > 1) {
      this.ui.toast('Es läuft bereits ein Gespräch')
      return false
    }
    const call = this.newCall('out', number, '')
    try {
      const session = ua.call(this.target(number), { mediaConstraints: this.mediaConstraints(), pcConfig: this.pcConfig() })
      const line = this.track(call, session)
      // call() legt die Verbindung sofort an (das Ereignis „peerconnection“ ist dann schon vorbei)
      if (session.connection) this.attach(session.connection, line)
    } catch (e) {
      this.ui.toast(`Anruf fehlgeschlagen: ${(e as Error).message}`)
      return false
    }
    this.ui.presentMain()
    this.changed()
    return true
  }

  private answer(call: Call): void {
    const line = this.lines.get(call.id)
    if (!line) return
    line.session.answer({ mediaConstraints: this.mediaConstraints(), pcConfig: this.pcConfig() })
  }

  accept(id: string): void {
    const call = this.calls.get(id)
    if (!call || call.state !== 'incoming') return
    // Anklopfen: laufende Gespräche halten statt auflegen
    for (const other of this.calls.values()) {
      if (other.id !== id && other.state === 'established' && !other.held) this.setHold(true, other.id)
    }
    this.answer(call)
    this.ui.withdraw(`call-${id}`)
    this.ring.stop()
    this.ui.presentMain()
    this.changed()
  }

  hangup(id?: string): void {
    const call = id ? this.calls.get(id) : this.activeCall()
    const line = call && this.lines.get(call.id)
    if (!call || !line) return
    call.declined = call.state === 'incoming'
    try {
      if (call.declined) line.session.terminate({ status_code: 486, reason_phrase: 'Busy Here' })
      else line.session.terminate()
    } catch {
      this.endCall(call.id, '')
    }
  }

  private call(id?: string): Call | null {
    return id ? (this.calls.get(id) ?? null) : this.activeCall()
  }

  setMute(muted: boolean, id?: string): void {
    const call = this.call(id)
    const line = call && this.lines.get(call.id)
    if (!call || !line || call.muted === muted) return
    call.muted = muted
    if (muted) line.session.mute({ audio: true })
    else line.session.unmute({ audio: true })
    this.changed()
  }

  setHold(held: boolean, id?: string): void {
    const call = this.call(id)
    const line = call && this.lines.get(call.id)
    if (!call || !line || call.held === held || call.state !== 'established') return
    call.held = held
    if (held) line.session.hold()
    else line.session.unhold()
    this.changed()
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
    const line = call && this.lines.get(call.id)
    if (!line || !/^[0-9*#]$/.test(digit)) return
    try {
      line.session.sendDTMF(digit, { duration: 120 })
    } catch {
      // Gespräch noch nicht verbunden
    }
  }

  stopRinging(): void {
    this.ring.stop()
  }

  /** Im Browser gibt es nur ein Fenster */
  openInWindow(id: string): void {
    const call = this.calls.get(id)
    if (call) call.mini = false
    this.ui.presentMain()
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
      for (const id of [...this.calls.keys()]) this.hangup(id)
      this.notifyInfo('Gespräche verbunden')
      return
    }
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
      this.accept(id)
    } else {
      this.doTransfer(call, target)
    }
  }

  private doTransfer(call: Call, target: string): void {
    const line = this.lines.get(call.id)
    if (!line) return
    call.transferredTo = target
    const fail = (): void => {
      if (call.transferredTo !== target) return
      call.transferredTo = null
      this.notifyInfo('Weiterleiten fehlgeschlagen', call.name || call.number)
      this.changed()
    }
    try {
      line.session.refer(this.target(target), {
        eventHandlers: {
          requestFailed: fail,
          failed: fail,
          // Die Anlage hat übernommen: den eigenen Teil beenden
          accepted: () => setTimeout(() => this.calls.has(call.id) && call.transferredTo === target && this.hangup(call.id), 500),
        },
      })
    } catch {
      fail()
      return
    }
    // Kommt gar nichts, den eigenen Teil nach einer Weile selbst beenden
    setTimeout(() => {
      if (this.calls.has(call.id) && call.transferredTo === target) this.hangup(call.id)
    }, 8000)
    this.changed()
  }

  // -- Kalender ---------------------------------------------------------------------------

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

  setUpcoming(events: CalEvent[]): void {
    this.upcoming = events
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
        body: time + (ev.location ? ` · ${ev.location}` : '') + (numbers.length ? ` · ${numbers[0]}` : ''),
        tag: `reminder-${key}`,
        onClick: () => this.ui.showCalendarEvent(),
      })
    }
  }
}
