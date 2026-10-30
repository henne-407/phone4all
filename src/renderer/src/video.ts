/**
 * Videoanrufe im Messenger: JsSIP und WebRTC direkt in der Oberfläche. Die App ruft als
 * „<nummer>-video“ die Raum-ID des Chats an; die Anlage legt alle in eine Konferenz und
 * leitet jedes Bild einzeln weiter (SFU). Neue Teilnehmer kommen per Re-INVITE als
 * zusätzliche Videoströme dazu. Ton mischt die Anlage zu einem Strom. Beim Teilen des
 * Bildschirms ersetzt das Bild des Bildschirms das der Kamera (ohne neue Verhandlung).
 */

import JsSIP from 'jssip'
import type { RTCSession } from 'jssip/lib/RTCSession'
import { useSyncExternalStore } from 'react'
import { api } from './api'

export interface RemoteVideo {
  /** mid der Übertragung, bleibt für einen Teilnehmer gleich */
  id: string
  stream: MediaStream
}

export interface VideoState {
  room: string | null
  status: 'idle' | 'connecting' | 'active'
  /** Letzter Fehler oder Grund für das Ende (wird beim nächsten Anruf gelöscht) */
  notice: string
  local: MediaStream | null
  remotes: RemoteVideo[]
  /** gemischter Ton aller anderen */
  audio: MediaStream | null
  muted: boolean
  camera: boolean
  /** Geteilter Bildschirm (null = keiner) */
  screen: MediaStream | null
  /** Anrufansicht klein (Chat bleibt bedienbar) */
  minimized: boolean
  since: number
}

const IDLE: VideoState = {
  room: null,
  status: 'idle',
  notice: '',
  local: null,
  remotes: [],
  audio: null,
  muted: false,
  camera: true,
  screen: null,
  minimized: false,
  since: 0,
}

let state: VideoState = IDLE
const listeners = new Set<() => void>()
let ua: JsSIP.UA | null = null
let session: RTCSession | null = null

function set(patch: Partial<VideoState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function useVideo(): VideoState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

export function videoState(): VideoState {
  return state
}

/**
 * Empfangene Ströme aus den Übertragungen der Verbindung neu bestimmen. Ein Bild zeigen
 * wir nur, solange es Daten bekommt: Die eigene Video-Übertragung bleibt leer, und wer
 * geht, hinterlässt eine Übertragung ohne Daten, bis die Anlage neu verhandelt.
 */
function collect(pc: RTCPeerConnection): void {
  if (session?.connection !== pc) return
  const remotes: RemoteVideo[] = []
  const audio: MediaStreamTrack[] = []
  for (const t of pc.getTransceivers()) {
    const dir = t.currentDirection
    if (!t.mid || (dir !== 'recvonly' && dir !== 'sendrecv')) continue
    const track = t.receiver.track
    if (track.kind === 'audio') audio.push(track)
    else if (!track.muted) {
      const old = state.remotes.find((r) => r.id === t.mid && r.stream.getTracks()[0] === track)
      remotes.push(old ?? { id: t.mid, stream: new MediaStream([track]) })
    }
  }
  const same = audio.length && state.audio?.getTracks()[0] === audio[0]
  set({ remotes, audio: same ? state.audio : audio.length ? new MediaStream(audio) : null })
}

function cleanup(notice = ''): void {
  for (const t of state.local?.getTracks() ?? []) t.stop()
  for (const t of state.screen?.getTracks() ?? []) t.stop()
  const s = session
  session = null
  if (s && !s.isEnded()) {
    try {
      s.terminate()
    } catch {
      // schon beendet
    }
  }
  ua?.stop()
  ua = null
  void api.messengerInCall(null)
  set({ ...IDLE, notice })
}

function reason(cause: string): string {
  switch (cause) {
    case JsSIP.C.causes.REJECTED:
    case JsSIP.C.causes.NOT_FOUND:
      return 'Die Anlage hat den Videoanruf abgewiesen.'
    case JsSIP.C.causes.USER_DENIED_MEDIA_ACCESS:
      return 'Kein Zugriff auf Kamera oder Mikrofon.'
    case JsSIP.C.causes.CONNECTION_ERROR:
    case JsSIP.C.causes.REQUEST_TIMEOUT:
    case JsSIP.C.causes.SIP_FAILURE_CODE:
      return 'Keine Verbindung zur Telefonanlage für Videoanrufe.'
    case JsSIP.C.causes.AUTHENTICATION_ERROR:
      return 'Die Anlage hat die Anmeldung für Videoanrufe abgelehnt.'
    default:
      return `Videoanruf beendet (${cause}).`
  }
}

/** Kamera und Mikrofon holen; ohne Kamera nur mit Ton */
async function media(camera: boolean): Promise<MediaStream> {
  await api.messengerMediaAccess(camera)
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  if (!camera) return navigator.mediaDevices.getUserMedia({ audio })
  try {
    return await navigator.mediaDevices.getUserMedia({ audio, video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } } })
  } catch {
    return navigator.mediaDevices.getUserMedia({ audio })
  }
}

/** Dem Videoanruf eines Chats beitreten (startet ihn, wenn noch keiner läuft) */
export async function joinVideo(room: string, camera = true): Promise<void> {
  if (state.room === room && state.status !== 'idle') return set({ minimized: false })
  if (state.status !== 'idle') cleanup()
  set({ ...IDLE, room, status: 'connecting', camera })
  const account = await api.messengerVideoAccount()
  if (!account) return cleanup('Videoanrufe sind auf der Telefonanlage nicht freigegeben.')
  let local: MediaStream
  try {
    local = await media(camera)
  } catch {
    return cleanup('Kein Zugriff auf Kamera oder Mikrofon.')
  }
  if (state.room !== room) {
    for (const t of local.getTracks()) t.stop()
    return
  }
  const hasVideo = local.getVideoTracks().length > 0
  set({ local, camera: hasVideo })
  const host = account.domain || new URL(account.websocket).hostname
  const agent = new JsSIP.UA({
    sockets: [new JsSIP.WebSocketInterface(account.websocket)],
    uri: `sip:${account.user}@${host}`,
    password: account.password,
    register: false,
    session_timers: true,
    user_agent: 'Phone4All',
  })
  ua = agent
  agent.on('disconnected', () => {
    if (ua === agent && state.status === 'connecting') cleanup('Keine Verbindung zur Telefonanlage für Videoanrufe.')
  })
  agent.start()
  const s = agent.call(`sip:${room}@${host}`, {
    mediaStream: local,
    pcConfig: { iceServers: account.ice_servers, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' },
    rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: true },
  })
  session = s
  // JsSIP wartet sonst auf alle ICE-Kandidaten (mit TURN mehrere Sekunden)
  s.on('icecandidate', (e) => {
    const type = e.candidate.type
    if (type === 'srflx' || type === 'relay') e.ready()
    else setTimeout(() => e.ready(), 600)
  })
  // call() legt die Verbindung sofort an (das Ereignis „peerconnection“ ist dann schon vorbei)
  const pc = s.connection
  // Ein Bild kommt erst Augenblicke nach der Verhandlung (unmute); die Richtung der
  // Übertragung steht erst nach der Antwort fest
  pc.addEventListener('track', (e) => {
    e.track.addEventListener('mute', () => collect(pc))
    e.track.addEventListener('unmute', () => collect(pc))
    collect(pc)
  })
  pc.addEventListener('signalingstatechange', () => {
    if (pc.signalingState === 'stable') setTimeout(() => collect(pc), 0)
  })
  s.on('confirmed', () => {
    if (session !== s) return
    collect(s.connection)
    set({ status: 'active', since: Date.now() })
    void api.messengerInCall(room)
  })
  s.on('ended', () => session === s && cleanup())
  s.on('failed', (e) => session === s && cleanup(reason(e.cause)))
}

export function leaveVideo(notice = ''): void {
  if (state.status !== 'idle') cleanup(notice)
}

export function setMuted(muted: boolean): void {
  if (!session) return
  if (muted) session.mute({ audio: true })
  else session.unmute({ audio: true })
  set({ muted })
}

export function setCamera(on: boolean): void {
  const track = state.local?.getVideoTracks()[0]
  if (!track) return
  track.enabled = on
  set({ camera: on })
}

export function setMinimized(minimized: boolean): void {
  set({ minimized })
}

export function clearNotice(): void {
  set({ notice: '' })
}

/** Übertragung des eigenen Bildes (Kamera oder Bildschirm) */
function videoSender(): RTCRtpSender | undefined {
  return session?.connection?.getSenders().find((x) => x.track?.kind === 'video')
}

/**
 * Bildschirm oder Fenster teilen (id aus api.screenSources). Liefert einen Hinweis, wenn
 * es nicht geht, sonst ''.
 */
export async function startScreenShare(id: string): Promise<string> {
  const sender = videoSender()
  if (!sender || state.status !== 'active') return 'Bildschirm teilen geht nur in einem Videoanruf, der mit Kamera begonnen wurde.'
  await api.chooseScreen(id)
  let display: MediaStream
  try {
    display = await navigator.mediaDevices.getDisplayMedia({ video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: 10, max: 15 } }, audio: false })
  } catch {
    return 'Der Bildschirm konnte nicht geteilt werden (unter macOS: Bildschirmaufnahme in den Systemeinstellungen erlauben).'
  }
  const track = display.getVideoTracks()[0]
  if (!track || videoSender() !== sender) {
    for (const t of display.getTracks()) t.stop()
    return ''
  }
  // Text bleibt scharf, dafür weniger Bilder pro Sekunde
  track.contentHint = 'detail'
  for (const t of state.screen?.getTracks() ?? []) t.stop()
  await sender.replaceTrack(track)
  // Über die Leiste des Systems beendet („Freigabe beenden“)
  track.addEventListener('ended', () => void stopScreenShare())
  set({ screen: display })
  return ''
}

export async function stopScreenShare(): Promise<void> {
  const screen = state.screen
  if (!screen) return
  set({ screen: null })
  for (const t of screen.getTracks()) t.stop()
  const camera = state.local?.getVideoTracks()[0] ?? null
  await videoSender()?.replaceTrack(camera).catch(() => undefined)
}
