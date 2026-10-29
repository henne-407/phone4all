/**
 * Telefonie: SIP über WebSocket (JsSIP) mit WebRTC (react-native-webrtc). Die Anlage
 * stellt dafür je Nebenstelle das Gerät „<nummer>-app“ bereit; die Sprache läuft
 * verschlüsselt (DTLS-SRTP), bei Bedarf über den TURN-Server der Anlage.
 */

import JsSIP from 'jssip'
import type { RTCSession } from 'jssip/lib/RTCSession'
import type { IncomingRTCSessionEvent, RTCSessionEvent } from 'jssip/lib/UA'
import InCallManager from 'react-native-incall-manager'
import { registerGlobals } from 'react-native-webrtc'
import { cleanNumber, numberFromUri } from './numbers'
import { type Profile, joinCalls } from './provisioning'

registerGlobals()

export type Registration = 'off' | 'connecting' | 'registered' | 'failed'
export type CallStatus = 'incoming' | 'calling' | 'ringing' | 'active' | 'ended'

export interface Call {
  id: string
  direction: 'in' | 'out'
  number: string
  name: string
  status: CallStatus
  started: number
  answered: number
  muted: boolean
  held: boolean
  speaker: boolean
  /** Grund, falls das Gespräch nicht zustande kam */
  reason: string
}

export interface PhoneState {
  registration: Registration
  error: string
  call: Call | null
  /** Gehaltenes Gespräch während einer Rückfrage */
  other: Call | null
}

export interface CallEnd {
  call: Call
  missed: boolean
}

type Listener = (s: PhoneState) => void

/** Gründe von JsSIP auf Deutsch */
const CAUSES: Record<string, string> = {
  Busy: 'Besetzt',
  Rejected: 'Abgelehnt',
  'Not Found': 'Nummer nicht erreichbar',
  Unavailable: 'Nicht erreichbar',
  'No Answer': 'Keine Antwort',
  Canceled: 'Abgebrochen',
  'Request Timeout': 'Zeitüberschreitung',
  'Connection Error': 'Keine Verbindung zur Anlage',
  'User Denied Media Access': 'Kein Zugriff auf das Mikrofon',
  'Authentication Error': 'Anmeldung abgelehnt',
  'Address Incomplete': 'Nummer unvollständig',
  'Incompatible SDP': 'Gegenstelle nicht kompatibel',
  'Bad Media Description': 'Gegenstelle nicht kompatibel',
}

export function causeText(cause: string): string {
  return CAUSES[cause] ?? cause
}

export class Phone {
  private ua: JsSIP.UA | null = null
  private session: RTCSession | null = null
  /** Gehaltenes Gespräch (Rückfrage) */
  private second: RTCSession | null = null
  /** Nach der Dreierkonferenz das gehaltene Gespräch wieder aufnehmen */
  private joining = false
  private listeners = new Set<Listener>()
  private profile: Profile | null = null
  state: PhoneState = { registration: 'off', error: '', call: null, other: null }
  /** Durchsagen und Gegensprechen ohne Klingeln annehmen (Einstellung) */
  autoAnswerPages = true
  /** Für Anrufernamen; setzt die App */
  lookup: (number: string) => string = () => ''
  onIncoming: (call: Call) => void = () => undefined
  onEnded: (end: CallEnd) => void = () => undefined
  /** Gespräch angenommen (z. B. Anrufer im CRM öffnen) */
  onAnswered: (call: Call) => void = () => undefined

  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    l(this.state)
    return () => this.listeners.delete(l)
  }

  private set(patch: Partial<PhoneState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l(this.state)
  }

  private setCall(patch: Partial<Call>): void {
    if (this.state.call) this.set({ call: { ...this.state.call, ...patch } })
  }

  /** Gespräch anhand der Kennung ändern (laufendes oder gehaltenes) */
  private patch(id: string, patch: Partial<Call>): void {
    if (this.state.call?.id === id) this.set({ call: { ...this.state.call, ...patch } })
    else if (this.state.other?.id === id) this.set({ other: { ...this.state.other, ...patch } })
  }

  /** Neue TURN-Zugangsdaten usw. ohne neue Anmeldung übernehmen */
  setProfile(profile: Profile): void {
    if (this.ua) this.profile = profile
  }

  start(profile: Profile): void {
    this.stop()
    const r = profile.remote
    if (!r) return
    this.profile = profile
    const socket = new JsSIP.WebSocketInterface(r.websocket)
    const ua = new JsSIP.UA({
      sockets: [socket],
      uri: `sip:${r.user}@${r.domain}`,
      authorization_user: r.user,
      password: profile.password,
      display_name: profile.account.display_name,
      register: true,
      register_expires: 300,
      session_timers: false,
      user_agent: 'SIP-Telefon Mobil',
      connection_recovery_min_interval: 2,
      connection_recovery_max_interval: 30,
    })
    this.ua = ua
    this.set({ registration: 'connecting', error: '' })
    ua.on('connecting', () => this.ua === ua && this.state.registration !== 'registered' && this.set({ registration: 'connecting' }))
    ua.on('disconnected', () => this.ua === ua && this.set({ registration: 'connecting', error: 'Keine Verbindung zur Anlage' }))
    ua.on('registered', () => this.ua === ua && this.set({ registration: 'registered', error: '' }))
    ua.on('unregistered', () => this.ua === ua && this.set({ registration: 'off' }))
    ua.on('registrationFailed', (e: { cause?: string }) => {
      if (this.ua === ua) this.set({ registration: 'failed', error: causeText(e.cause ?? 'Anmeldung fehlgeschlagen') })
    })
    ua.on('newRTCSession', (e: RTCSessionEvent) => {
      if (e.originator === 'remote') this.incoming(e as IncomingRTCSessionEvent)
    })
    ua.start()
  }

  stop(): void {
    this.session?.terminate()
    this.second?.terminate()
    this.session = null
    this.second = null
    const ua = this.ua
    this.ua = null
    ua?.stop()
    this.set({ registration: 'off', error: '', call: null, other: null })
  }

  /** Nach Rückkehr in den Vordergrund: Verbindung prüfen und neu anmelden */
  refresh(): void {
    const ua = this.ua
    if (!ua) return
    if (!ua.isConnected()) ua.start()
    else if (!ua.isRegistered()) ua.register()
  }

  private pcConfig(): RTCConfiguration {
    return { iceServers: this.profile?.remote?.ice_servers ?? [], bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' } as RTCConfiguration
  }

  /**
   * JsSIP wartet sonst, bis alle Kandidaten gesammelt sind – mit TURN über TCP kann das
   * viele Sekunden dauern. Ein Weg über TURN reicht; sonst nach kurzer Zeit weiter.
   */
  private fastIce(session: RTCSession): void {
    let timer: ReturnType<typeof setTimeout> | null = null
    session.on('icecandidate', (e) => {
      const relay = / typ relay /.test(e.candidate.candidate)
      if (relay) {
        if (timer) clearTimeout(timer)
        // Kurz warten, damit UDP- und TCP-Relais beide dabei sind
        timer = setTimeout(() => e.ready(), 150)
      } else if (!timer) {
        timer = setTimeout(() => e.ready(), 2500)
      }
    })
  }

  private track(session: RTCSession, call: Call): void {
    this.session = session
    this.set({ call })
    this.fastIce(session)
    session.on('progress', () => {
      if (call.direction === 'out') this.patch(call.id, { status: 'ringing' })
    })
    session.on('accepted', () => {
      InCallManager.stopRingback()
      InCallManager.stopRingtone()
      this.patch(call.id, { status: 'active', answered: Date.now() })
      if (this.state.call?.id === call.id) this.onAnswered(this.state.call)
    })
    session.on('confirmed', () => {
      if (this.state.call?.id === call.id && this.state.call.status !== 'active') this.patch(call.id, { status: 'active', answered: Date.now() })
    })
    session.on('hold', () => this.patch(call.id, { held: true }))
    session.on('unhold', () => this.patch(call.id, { held: false }))
    const end = (cause: string): void => {
      if (this.second === session) {
        // Das gehaltene Gespräch ist beendet (Gegenüber hat aufgelegt)
        this.second = null
        const o = this.state.other
        this.set({ other: null })
        if (o) this.onEnded({ call: { ...o, status: 'ended' }, missed: false })
        return
      }
      if (this.session !== session) return
      this.session = null
      InCallManager.stopRingtone()
      const c = this.state.call
      if (this.second) {
        // Rückfrage beendet: zurück zum gehaltenen Gespräch
        this.session = this.second
        this.second = null
        this.set({ call: this.state.other, other: null })
        if (this.joining) {
          this.joining = false
          this.session.unhold()
        }
        if (c) this.onEnded({ call: { ...c, status: 'ended' }, missed: c.direction === 'in' && !c.answered })
        return
      }
      InCallManager.stop()
      if (!c) return
      const missed = c.direction === 'in' && !c.answered
      const ended: Call = { ...c, status: 'ended', reason: c.answered ? '' : causeText(cause) }
      this.set({ call: ended })
      this.onEnded({ call: ended, missed })
      // Ende kurz anzeigen
      setTimeout(() => {
        if (this.state.call?.id === c.id) this.set({ call: null })
      }, 1500)
    }
    session.on('ended', (e) => end(e.cause))
    session.on('failed', (e) => end(e.cause))
  }

  dial(input: string): void {
    const number = cleanNumber(input)
    const ua = this.ua
    const r = this.profile?.remote
    if (!number || !ua || !r || this.session) return
    if (!this.second) InCallManager.start({ media: 'audio', ringback: '_DEFAULT_' })
    const call: Call = {
      id: `${Date.now()}`,
      direction: 'out',
      number,
      name: this.lookup(number),
      status: 'calling',
      started: Date.now(),
      answered: 0,
      muted: false,
      held: false,
      speaker: false,
      reason: '',
    }
    try {
      const session = ua.call(`sip:${encodeURIComponent(number).replace(/%2B/g, '+')}@${r.domain}`, {
        mediaConstraints: { audio: true, video: false },
        pcConfig: this.pcConfig(),
      })
      this.track(session, call)
    } catch (e) {
      if (this.second) {
        // Rückfrage kam nicht zustande: gehaltenes Gespräch bleibt
        this.session = this.second
        this.second = null
        this.set({ call: this.state.other, other: null })
        return
      }
      InCallManager.stop()
      this.set({ call: { ...call, status: 'ended', reason: (e as Error).message } })
    }
  }

  /** Rückfrage: laufendes Gespräch halten und `input` anrufen */
  consult(input: string): void {
    const s = this.session
    const c = this.state.call
    if (!s || !c || c.status !== 'active' || this.second || !cleanNumber(input)) return
    if (!c.held) s.hold()
    this.second = s
    this.session = null
    this.set({ other: { ...c, held: true } })
    this.dial(input)
    if (!this.session && this.second === s) {
      // Wählen ging nicht (keine Verbindung): beim gehaltenen Gespräch bleiben
      this.session = s
      this.second = null
      this.set({ other: null })
    }
  }

  /** Makeln: zwischen Rückfrage und gehaltenem Gespräch wechseln */
  swap(): void {
    const s = this.session
    const o = this.second
    if (!s || !o || this.state.call?.status !== 'active') return
    s.hold()
    o.unhold()
    this.session = o
    this.second = s
    this.set({ call: this.state.other, other: this.state.call })
  }

  /** Rückfrage abschließen: Gegenüber verbinden oder Dreierkonferenz (macht die Anlage) */
  async join(mode: 'transfer' | 'conference'): Promise<void> {
    const p = this.profile
    if (!p || !this.session || !this.second) return
    this.joining = mode === 'conference'
    try {
      await joinCalls(p, mode)
    } catch (e) {
      this.joining = false
      throw e
    }
    if (mode === 'transfer') {
      // Die beiden Gegenüber sprechen jetzt miteinander, die eigenen Gespräche sind übrig
      this.second?.terminate()
      this.session?.terminate()
    }
  }

  private incoming(e: IncomingRTCSessionEvent): void {
    const session = e.session
    if (this.session || this.second) {
      // Ein Gespräch zur Zeit: Zweitanruf ablehnen, die Anlage leitet dann z. B. zur Voicemail
      session.terminate({ status_code: 486, reason_phrase: 'Busy Here' })
      return
    }
    const number = numberFromUri(session.remote_identity.uri.toString())
    const call: Call = {
      id: `${Date.now()}`,
      direction: 'in',
      number,
      name: this.lookup(number) || session.remote_identity.display_name || '',
      status: 'incoming',
      started: Date.now(),
      answered: 0,
      muted: false,
      held: false,
      speaker: false,
      reason: '',
    }
    this.track(session, call)
    // Durchsage/Gegensprechen der Anlage (Call-Info, Name von außen filtert die Anlage)
    const page = /answer-after=0/.test(e.request.getHeader('Call-Info') ?? '') || /^(Durchsage|Gegensprechen) /.test(session.remote_identity.display_name ?? '')
    if (page && this.autoAnswerPages) {
      this.answer()
      InCallManager.setForceSpeakerphoneOn(true)
      this.setCall({ speaker: true })
      return
    }
    InCallManager.startRingtone('_DEFAULT_', [0, 1000, 1000], 'playback', 30)
    this.onIncoming(call)
  }

  answer(): void {
    const s = this.session
    if (!s || this.state.call?.status !== 'incoming') return
    InCallManager.stopRingtone()
    InCallManager.start({ media: 'audio' })
    s.answer({ mediaConstraints: { audio: true, video: false }, pcConfig: this.pcConfig() })
  }

  hangup(): void {
    const s = this.session
    if (!s) return
    if (this.state.call?.status === 'incoming') s.terminate({ status_code: 486, reason_phrase: 'Busy Here' })
    else s.terminate()
  }

  toggleMute(): void {
    const s = this.session
    const c = this.state.call
    if (!s || !c) return
    if (c.muted) s.unmute({ audio: true })
    else s.mute({ audio: true })
    this.setCall({ muted: !c.muted })
  }

  toggleHold(): void {
    const s = this.session
    const c = this.state.call
    if (!s || !c || c.status !== 'active') return
    if (c.held) s.unhold()
    else s.hold()
  }

  toggleSpeaker(): void {
    const c = this.state.call
    if (!c) return
    InCallManager.setForceSpeakerphoneOn(!c.speaker)
    this.setCall({ speaker: !c.speaker })
  }

  dtmf(tone: string): void {
    // Die Anlage nimmt Tasten auch als SIP INFO an; react-native-webrtc kann kein RFC 4733
    this.session?.sendDTMF(tone, { transportType: JsSIP.C.DTMF_TRANSPORT.INFO, duration: 120 })
  }

  /** Gespräch an eine andere Nummer übergeben (blind) */
  transfer(input: string): void {
    const number = cleanNumber(input)
    const r = this.profile?.remote
    if (!number || !r || !this.session) return
    this.session.refer(`sip:${number}@${r.domain}`)
  }
}

export const phone = new Phone()
