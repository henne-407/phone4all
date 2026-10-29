/** Verwaltungsdienst der Telefonanlage: Weboberfläche, API, Anruflogik für Asterisk. */

import { timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import https from 'node:https'
import type { Duplex } from 'node:stream'
import path from 'node:path'
import { Asterisk } from './asterisk'
import { CalendarStore } from './calendars'
import { external } from './directory'
import { AuditLog, auditText } from './audit'
import { Auth, SESSION_COOKIE, SESSION_MAX_AGE } from './auth'
import { PASSWORD_MIN, ROLES, type Role, UserError, UserStore, forbidden } from './users'
import { readAllCalls, readCalls, readQueueLog, tailLog } from './cdr'
import { describeAgent, gigasetFile, requestMac } from './dect'
import { agentMac, describeDesk, deskRequestMac, isYealinkCommon, snomFile, yealinkFile } from './deskphone'
import { type DoorRing, EmergencyLog, emergencyCall, emergencyText, isEmergency } from './emergency'
import { CallTracker, type GroupMissedCall, type PbxEvent, Webhooks } from './events'
import { JoinError, callLegs, joinActions, joinRoom } from './join'
import { type FaxRecord, FaxStore, MAX_ATTEMPTS, RETRY_MS, faxErrorText, faxRoute, pdfToTiff, tiffPages, tiffToPdf } from './fax'
import { loadJson, saveJson } from './files'
import { type ForwardChange, ForwardError, applyCfu, applyMobile, applyRules, check as checkForward, forwardInfo } from './forwarding'
import { localTime } from './holidays'
import { type MissedAction, MissedList } from './missed'
import { integrationReport, validToken } from './integration'
import { LdapServer } from './ldap'
import { HttpError, type Request, Router, clientIp, makeRequest, proxyHints, sendFile, sendJson, sendText, serveStatic, setTrustedProxies, socketIp } from './http'
import { type MailAttachment, sendMail } from './mail'
import { PORTAL_COOKIE, PORTAL_JS, PORTAL_MAX_AGE, PortalSessions, portalPage } from './portal'
import { ChatError, MessengerHub, MessengerStore, messengerUsers } from './messenger'
import { BUNDESLAENDER, COLLECTIONS, type CollectionName, type Extension, type PhonebookEntry, SECTIONS, type SectionName, type TranscriptionSettings, WEBHOOK_EVENTS } from './model'
import { cleanNumber } from './numbers'
import { type OffsiteStatus, OffsiteError, download as offsiteDownload, target as offsiteTarget, upload as offsiteUpload } from './offsite'
import { PATHS, SETTINGS } from './paths'
import { Presence } from './presence'
import { PROVIDERS } from './providers'
import { appLink, baseUrl, expiredPage, landingPage, linkBase, profile, startDiscovery, visibleCalendars } from './provisioning'
import { Turn, WsProxy, appEndpoint, webrtcEnabled } from './remote'
import {
  BLOCKED_TARGET,
  appPermissions,
  calendarStatus,
  extensionPlan,
  feature,
  groupPlan,
  inboundName,
  isAvailable,
  isInternational,
  isLocalNumber,
  memberGroups,
  mobilePlan,
  pagePlan,
  ringPlan,
  routeInbound,
  routeOutbound,
  setAway,
  timeConditionTarget,
} from './routing'
import { Guard, inList } from './security'
import { SourceSync } from './sources/sync'
import { listSounds, saveSound, soundDir, soundFile, type SoundKind, toTelephoneWav } from './sounds'
import { expire, moveMailbox, recordingFile, removeMailbox, report as storageReport } from './storage'
import {
  ConfigStore,
  type EncryptedExport,
  type ExportFile,
  ValidationError,
  addDevice,
  consumePin,
  decryptExport,
  emailList,
  encryptExport,
  fillSecrets,
  findDevice,
  linkValid,
  newPin,
  newSecret,
  stripSecrets,
  pinValid,
  renewLink,
  renewPin,
} from './store'
import { Tts, TtsError, VOICES } from './tts'
import { TranscribeError, type Transcript, Transcriber, WHISPER_MODELS } from './transcribe'
import { callsCsv, computeStats, parseQueueLog } from './stats'
import type { DectBase, DeskPhone, PbxConfig } from './model'
import { Updater } from './updates'
import { VoicemailBox, type VoicemailMessage } from './voicemail'
import { type WatchEvent, Watchdog } from './watchdog'
import { reject, upgrade } from './websocket'

const store = new ConfigStore()
setTrustedProxies(() => store.config.security.trusted_proxies)
const auth = new Auth()
const users = new UserStore(PATHS.users)
const asterisk = new Asterisk()
const turn = new Turn()
const ws = new WsProxy(() => webrtcEnabled(store.config), (ip) => guard.isBanned(ip))
// Fehlanmeldungen über den WebSocket-Proxy der echten Adresse des Telefons zuordnen
const guard = new Guard(() => store.config.security, (port) => ws.clientOf(port))
const updater = new Updater()
const calendars = new CalendarStore(() => store.config)
calendarStatus.find = (id, keyword, now) => calendars.current(id, keyword, now)
const sources = new SourceSync(
  () => store.config,
  (id, events) => calendars.replace(id, events),
)
external.entries = () => sources.entries()
const audit = new AuditLog(PATHS.audit)
external.revision = () => sources.revision
const ldap = new LdapServer(() => store.config)
ldap.isBlocked = (ip) => isBlocked(ip)
ldap.onFailure = (ip) => auth.failed(ip, 'Falsches Kennwort am LDAP-Telefonbuch')
const messenger = new MessengerHub(new MessengerStore(PATHS.messenger), () => store.config)
const presence = new Presence()
const tracker = new CallTracker()
const webhooks = new Webhooks(() => store.config)
const voicemail = new VoicemailBox(PATHS.spool)
const emergencies = new EmergencyLog()
const doorRings = new EmergencyLog<DoorRing>()
const tts = new Tts(PATHS.tts)
const missed = new MissedList(PATHS.missed)
const faxes = new FaxStore(PATHS.fax)
const transcriber = new Transcriber(PATHS.whisper, PATHS.transcripts, SETTINGS.whisper)
let offsiteStatus: OffsiteStatus = { time: 0, ok: true, file: '', error: '' }
auth.init()
store.hooks = {
  renumbered: (from, to) => {
    messenger.store.renumber(from, to)
    moveMailbox(from, to)
    missed.renumber(from, to)
    moveTranscripts(from, to)
    portal.logoutExt(from)
  },
  removed: (number) => {
    messenger.forgotten(number)
    removeMailbox(number)
    fs.rmSync(path.join(PATHS.transcripts, number), { recursive: true, force: true })
    portal.logoutExt(number)
  },
}

tracker.on('event', (e: PbxEvent) => {
  void Promise.all(webhooks.dispatch(e))
  if (e.event === 'voicemail.new') setTimeout(() => scanVoicemail(String((e.data as { extension: string }).extension)), 1000).unref()
  // Türsprechstelle ruft an: für Home Assistant und als eigenes Ereignis
  if (e.event === 'call.ringing') {
    const d = e.data as { call: string; from: string }
    const door = store.config.extensions.find((x) => x.door.enabled && x.number === d.from)
    if (door && !doorRings.calls.some((r) => r.id === d.call)) {
      doorRings.add({ id: d.call, time: e.time, extension: door.number, name: door.name })
      tracker.report('door.ring', { extension: door.number, name: door.name })
    }
  }
  // Rückruf oder neuer angenommener Anruf: verpasste Gruppenanrufe dieser Nummer abhaken
  if (e.event !== 'call.answered') return
  const d = e.data as { direction: string; from: string; to?: string; extension?: string }
  if (d.direction === 'out' && d.to) missed.resolve(store.config, d.to, d.from, 'callback')
  if (d.direction === 'in') missed.resolve(store.config, d.from, d.extension ?? '', 'answered')
})
tracker.on('group-missed', (m: GroupMissedCall) => missed.add(store.config, m.call, m.groups, m.from, m.from_name))

// -- Fax per E-Mail ----------------------------------------------------------------------

const FAX_SPOOL = path.join(PATHS.spool, 'fax')

function faxMail(rec: FaxRecord, subject: string, text: string, pdf: boolean): void {
  const cfg = store.config
  const box = cfg.faxes.find((f) => f.id === rec.box)
  if (!box || !cfg.mail.host) return
  const file = faxes.pdf(rec.id)
  const attachments: MailAttachment[] = pdf && fs.existsSync(file) ? [{ name: `Fax-${rec.number || 'unbekannt'}-${new Date(rec.time).toISOString().slice(0, 10)}.pdf`, type: 'application/pdf', data: fs.readFileSync(file) }] : []
  for (const to of emailList(box.email, `Fax ${box.name}`)) {
    sendMail(cfg.mail, to, subject, `${text}\n\n${box.name} – ${cfg.system.name}`, attachments).catch((e: Error) => console.error('Fax-E-Mail:', e.message))
  }
}

/** Fax empfangen: TIFF aus dem Spool → PDF → E-Mail */
async function faxReceived(q: URLSearchParams): Promise<void> {
  const box = store.config.faxes.find((f) => f.id === q.get('box'))
  const tif = q.get('file') ?? ''
  const ok = q.get('status') === 'SUCCESS'
  const pages = Number(q.get('pages')) || 0
  const from = q.get('from') ?? ''
  // Nur Dateien, die der Wählplan selbst anlegt
  const valid = path.dirname(tif) === FAX_SPOOL && /^in-[\d.]+\.tif$/.test(path.basename(tif)) && fs.existsSync(tif)
  if (!box) return
  const rec = faxes.add({ box: box.id, direction: 'in', time: Date.now(), number: from, station: q.get('remote') ?? '', pages, status: ok ? 'ok' : 'failed', error: ok ? '' : faxErrorText(q.get('status') ?? '', q.get('error') ?? ''), by: '', attempts: 1 })
  try {
    if (valid && pages > 0) await tiffToPdf(tif, faxes.pdf(rec.id))
  } catch (e) {
    faxes.update(rec.id, { status: 'failed', error: (e as Error).message })
  } finally {
    if (valid) fs.rmSync(tif, { force: true })
  }
  const who = [from, rec.station].filter(Boolean).join(' / ') || 'unbekannt'
  if (pages > 0) faxMail(rec, `Fax von ${who} (${pages} ${pages === 1 ? 'Seite' : 'Seiten'})`, `Ein Fax von ${who} ist angekommen${ok ? '' : ' – unvollständig: ' + rec.error}.`, true)
  else if (!ok) watchdog.log('warning', 'asterisk', `Fax an ${box.name} von ${who} nicht empfangen: ${rec.error}`)
}

async function sendFax(boxId: string, number: string, pdf: Buffer, by: string): Promise<FaxRecord> {
  const box = store.config.faxes.find((f) => f.id === boxId)
  if (!box) throw new HttpError(404, 'Unbekanntes Fax.')
  const num = cleanNumber(number)
  if (!/^\+?\d{3,20}$/.test(num)) throw new HttpError(400, 'Ungültige Faxnummer.')
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'Bitte eine PDF-Datei senden.')
  if (!faxRoute(store.config, box, num).length) throw new HttpError(400, 'Diese Nummer ist über keine Leitung erreichbar (Wahlregeln prüfen).')
  const rec = faxes.add({ box: box.id, direction: 'out', time: Date.now(), number: num, station: '', pages: 0, status: 'queued', error: '', by, attempts: 0 })
  fs.mkdirSync(FAX_SPOOL, { recursive: true })
  fs.writeFileSync(faxes.pdf(rec.id), pdf)
  const tif = path.join(FAX_SPOOL, `out-${rec.id}.tif`)
  try {
    await pdfToTiff(faxes.pdf(rec.id), tif)
  } catch (e) {
    faxes.remove(rec.id)
    throw new HttpError(400, `Das PDF lässt sich nicht umwandeln: ${(e as Error).message}`)
  }
  faxes.update(rec.id, { pages: tiffPages(tif) })
  void faxAttempt(rec.id)
  return faxes.get(rec.id)!
}

/** Ein Sendeversuch: über die erste Leitung wählen, nach dem Abheben sendet der Wählplan */
async function faxAttempt(id: string): Promise<void> {
  const rec = faxes.get(id)
  const box = store.config.faxes.find((f) => f.id === rec?.box)
  if (!rec || !box) return
  const leg = faxRoute(store.config, box, rec.number)[0]
  if (!leg) return faxFinished(rec, 'failed', 'Keine Leitung nach außen (Wahlregeln prüfen)')
  faxes.update(id, { status: 'sending', attempts: rec.attempts + 1 })
  let answered = false
  try {
    const [res] = await asterisk.ami.action(
      {
        Action: 'Originate',
        Channel: `PJSIP/${leg.number}@${leg.endpoint}`,
        Context: 'p4a-fax-send',
        Exten: 's',
        Priority: '1',
        CallerID: `"${box.name.replace(/["<>]/g, '')}" <${leg.cid}>`,
        // Bei ausgehenden Kanälen zeigt der Anbieter die „verbundene“ Nummer als Absender
        Variable: `P4A_FAXJOB=${id},CONNECTEDLINE(num)=${leg.cid},CONNECTEDLINE(name)=${box.name.replace(/[",<>|]/g, ' ')}`,
        Timeout: '60000',
      },
      75000,
    )
    answered = res?.Response === 'Success'
  } catch {
    answered = false
  }
  if (answered) {
    // Ergebnis meldet der Wählplan (/internal/fax-sent); kommt nichts, gilt es nach 30 Minuten als fehlgeschlagen
    setTimeout(() => {
      const r = faxes.get(id)
      if (r?.status === 'sending') faxFinished(r, 'failed', 'Keine Rückmeldung vom Sendevorgang')
    }, 30 * 60000).unref()
    return
  }
  faxRetry(id, 'Keine Antwort oder besetzt')
}

function faxRetry(id: string, error: string): void {
  const rec = faxes.get(id)
  if (!rec) return
  if (rec.attempts >= MAX_ATTEMPTS) return faxFinished(rec, 'failed', error)
  faxes.update(id, { status: 'queued', error })
  setTimeout(() => void faxAttempt(id), RETRY_MS).unref()
}

function faxFinished(rec: FaxRecord, status: 'ok' | 'failed', error: string): void {
  faxes.update(rec.id, { status, error })
  fs.rmSync(path.join(FAX_SPOOL, `out-${rec.id}.tif`), { force: true })
  const done = faxes.get(rec.id)!
  const pages = `${done.pages} ${done.pages === 1 ? 'Seite' : 'Seiten'}`
  if (status === 'ok') faxMail(done, `Sendebericht: Fax an ${done.number} gesendet`, `Das Fax an ${done.number}${done.station ? ` (${done.station})` : ''} wurde vollständig übertragen (${pages}).`, true)
  else faxMail(done, `Sendebericht: Fax an ${done.number} fehlgeschlagen`, `Das Fax an ${done.number} (${pages}) konnte nach ${done.attempts} Versuchen nicht gesendet werden: ${error}.`, true)
}

// -- Voicemail als Text -------------------------------------------------------------------

/** Ab hier verschickt die Anlage die Voicemail-E-Mails selbst (vorher kamen sie von Asterisk) */
let transcriptMailSince = Date.now()
let transcriptMailOn = false

function moveTranscripts(from: string, to: string): void {
  const src = path.join(PATHS.transcripts, from)
  if (!fs.existsSync(src)) return
  fs.rmSync(path.join(PATHS.transcripts, to), { recursive: true, force: true })
  fs.renameSync(src, path.join(PATHS.transcripts, to))
}

/** Neue Nachrichten einreihen (nur die der letzten 3 Tage), Texte gelöschter Nachrichten entfernen */
function scanVoicemail(only?: string): void {
  const cfg = store.config
  if (!cfg.transcription.enabled) return
  const since = Date.now() - 3 * 86400000
  for (const ext of cfg.extensions.filter((e) => e.voicemail.enabled && (!only || e.number === only))) {
    const list = voicemail.list(ext.number)
    transcriber.prune(ext.number, new Set(list.map((m) => m.id)))
    for (const m of list) {
      if (m.time < since || transcriber.get(ext.number, m.id) || transcriber.pending(ext.number, m.id)) continue
      const file = voicemail.file(ext.number, m.id)
      if (!file) continue
      const mail = m.time >= transcriptMailSince
      transcriber.enqueue(() => store.config.transcription, ext.number, m.id, file, (t) => {
        tracker.report('voicemail.transcribed', { extension: ext.number, from: m.number, from_name: m.name, text: t.text, error: t.error })
        if (mail) transcriptMail(ext.number, m.id, t)
      })
    }
  }
}

function transcriptMail(mailbox: string, id: string, t: Transcript): void {
  const cfg = store.config
  const ext = cfg.extensions.find((e) => e.number === mailbox)
  const m = voicemail.find(mailbox, id)
  if (!ext?.email || !m || !cfg.transcription.email || !cfg.mail.host) return
  const caller = m.name && m.number ? `${m.name} (${m.number})` : m.name || m.number || 'Unbekannt'
  const when = new Date(m.time).toLocaleString('de-DE', { timeZone: cfg.system.timezone, dateStyle: 'medium', timeStyle: 'short' })
  const length = `${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, '0')}`
  const text = t.error ? `(Die Nachricht konnte nicht in Text umgewandelt werden: ${t.error})` : t.text ? `„${t.text}“` : '(Kein gesprochener Text erkannt.)'
  const attachments: MailAttachment[] = []
  const wav = voicemail.file(mailbox, id)
  if (ext.voicemail.attach && wav) attachments.push({ name: `Nachricht-${m.number || 'unbekannt'}.wav`, type: 'audio/wav', data: fs.readFileSync(wav) })
  const body = `Hallo ${ext.name},\n\n${caller} hat am ${when} eine Nachricht hinterlassen (Länge ${length}):\n\n${text}\n\nAbhören: *97 am Telefon oder in der App.\n\n${mailbox} – ${cfg.system.name}`
  for (const to of emailList(ext.email, 'Voicemail'))
    sendMail(cfg.mail, to, `Neue Sprachnachricht von ${caller}`, body, attachments).catch((e: Error) => console.error('Voicemail-E-Mail:', e.message))
}

/** Einstellungen geändert: E-Mail-Versand übernimmt ab jetzt die Anlage bzw. wieder Asterisk */
function transcriptionChanged(): void {
  const on = store.config.transcription.enabled && store.config.transcription.email
  if (on && !transcriptMailOn) transcriptMailSince = Date.now()
  transcriptMailOn = on
  const tr = store.config.transcription
  if (tr.enabled && tr.engine === 'local' && !transcriber.status().models.includes(tr.model) && !transcriber.downloading) {
    transcriber.install(tr.model).catch((e: Error) => console.error('Spracherkennung laden:', e.message))
  }
  // Gerade eingeschaltet: Nachrichten der letzten Tage gleich umwandeln
  if (tr.enabled) scanVoicemail()
}

function freeBytes(): number | null {
  try {
    const st = fs.statfsSync(PATHS.data)
    return st.bavail * st.bsize
  } catch {
    return null
  }
}

/** Kontingent überschritten oder Platte knapp: älteste Chatnachrichten löschen */
function messengerCleanup(): void {
  const m = store.config.messenger
  const removed = messenger.store.cleanup({ freeBytes, minFree: m.min_free_mb * 1024 * 1024, maxUsage: m.max_storage_mb * 1024 * 1024 })
  if (!removed) return
  watchdog.log('warning', 'disk', `Messenger aufgeräumt: ${removed} alte Chatnachrichten gelöscht`)
  messenger.reloadAll()
}

// -- Watchdog: Überwachung und Selbstheilung ------------------------------------------

const watchdog = new Watchdog(
  {
    state: () => asterisk.state,
    processRunning: () => asterisk.processRunning,
    amiConnected: () => asterisk.ami.connected,
    ping: () => asterisk.ping(),
    reconnectAmi: () => asterisk.reconnectAmi(),
    restart: (reason) => asterisk.kill(`Vom Watchdog neu gestartet: ${reason}`),
    trunks: () => store.config.trunks.filter((t) => t.enabled && t.register && !t.ip_auth && t.username.trim()),
    registrations: () => asterisk.registrations(),
    register: (id) => asterisk.register(id),
    reloadPjsip: () => asterisk.reloadPjsip(),
    freeBytes,
  },
  () => store.config.watchdog,
)
watchdog.events = loadJson<WatchEvent[]>(PATHS.watchdog, [])

let saveEventsTimer: NodeJS.Timeout | null = null
const mailed = new Map<string, number>() // Prüfung → Zeit der letzten Störungsmeldung
watchdog.on('event', (e: WatchEvent) => {
  saveEventsTimer ??= setTimeout(() => {
    saveEventsTimer = null
    saveJson(PATHS.watchdog, watchdog.events, 0o644)
  }, 2000)
  // Störungen per E-Mail: höchstens alle 30 Minuten je Prüfung, Entwarnung nach einer Meldung
  const to = store.config.watchdog.notify_email
  if (!to || (e.level !== 'error' && e.level !== 'ok')) return
  const last = mailed.get(e.check)
  if (e.level === 'ok' && last === undefined) return
  if (e.level === 'error' && last !== undefined && e.time - last < 30 * 60000) return
  if (e.level === 'ok') mailed.delete(e.check)
  else mailed.set(e.check, e.time)
  const subject = `${store.config.system.name}: ${e.level === 'ok' ? 'Störung behoben' : 'Störung'}`
  sendMail(store.config.mail, to, subject, `${new Date(e.time).toLocaleString('de-DE')}\n\n${e.text}\n\nDetails in der Weboberfläche unter System → Diagnose.`).catch(
    (err: Error) => console.error('Störungsmeldung per E-Mail:', err.message),
  )
})

// -- Konfiguration übernehmen (gebündelt, damit viele Änderungen nur ein Reload sind)

let applyTimer: NodeJS.Timeout | null = null
function applySoon(): void {
  if (applyTimer) clearTimeout(applyTimer)
  applyTimer = setTimeout(() => {
    applyTimer = null
    ldap.apply()
    messenger.refresh()
    transcriptionChanged()
    asterisk
      .apply(store.config, guard.banned())
      .then(() => setTimeout(() => void loadPresence(), 2000))
      .catch((e) => console.error('Konfiguration:', e))
    turn.apply(store.config)
  }, 300)
}

/** Zustand der Nebenstellen und geparkte Gespräche aus Asterisk lesen (nach Start und Änderungen) */
async function loadPresence(): Promise<void> {
  if (!asterisk.ami.connected) return
  try {
    const [states, parked] = await Promise.all([
      asterisk.ami.list({ Action: 'ExtensionStateList' }),
      store.config.parking.enabled ? asterisk.ami.list({ Action: 'ParkedCalls' }) : Promise.resolve([]),
    ])
    presence.load(states, parked)
    for (const e of store.config.extensions) tracker.setMailbox(e.number, voicemail.unread(e.number))
  } catch (e) {
    console.error('Besetztanzeige:', (e as Error).message)
  }
}

guard.on('changed', () => {
  for (const ip of guard.banned()) ws.kick(ip)
  applySoon()
})
asterisk.on('ami', (e) => {
  guard.onAmiEvent(e)
  messenger.onAmi(e)
  presence.onAmi(e)
  tracker.onAmi(e)
})
asterisk.ami.on('connected', () => void loadPresence())
asterisk.ami.on('disconnected', () => {
  messenger.resetCalls()
  presence.reset()
  tracker.reset()
})

/** Notruf gewählt: E-Mail, Messenger, Home Assistant, Webhooks */
function emergencyNotify(ext: string, number: string): void {
  const cfg = store.config
  const call = emergencyCall(cfg, ext, number)
  emergencies.add(call)
  const text = emergencyText(cfg, call)
  console.log(text)
  watchdog.log('warning', 'asterisk', text)
  tracker.report('emergency', { ...call })
  for (const to of cfg.emergency.notify_exts) messenger.notice(to, ext, text)
  const mails = emailList(cfg.emergency.notify_email, 'Notrufe')
  for (const to of mails) {
    sendMail(cfg.mail, to, `${cfg.system.name}: Notruf von ${call.name || call.extension}`, `${text}\n\nDiese Nachricht hat die Telefonanlage automatisch verschickt.`).catch((e: Error) =>
      console.error('Notruf-E-Mail:', e.message),
    )
  }
}

// -- Sicherheitsmeldungen: Ereignisprotokoll und E-Mail (höchstens alle 30 Min. je Anlass)

const alerted = new Map<string, number>()
function securityAlert(key: string, text: string, level: 'info' | 'warning' | 'error' = 'warning'): void {
  watchdog.log(level, 'security', text)
  const to = store.config.watchdog.notify_email
  const now = Date.now()
  if (!to || now - (alerted.get(key) ?? 0) < 30 * 60000) return
  alerted.set(key, now)
  if (alerted.size > 500) alerted.delete(alerted.keys().next().value!)
  const body = `${new Date(now).toLocaleString('de-DE')}\n\n${text}\n\nDetails in der Weboberfläche unter System → Sicherheit und System → Diagnose.`
  sendMail(store.config.mail, to, `${store.config.system.name}: Sicherheitshinweis`, body).catch((err: Error) =>
    console.error('Sicherheitshinweis per E-Mail:', err.message),
  )
}

/** Umleitung nach außen gesetzt: melden (typischer Schritt bei Gebührenbetrug) */
function forwardAlert(ext: string, target: string): void {
  const n = cleanNumber(target)
  if (n && !isLocalNumber(store.config, n)) securityAlert(`fwd:${ext}`, `Nebenstelle ${ext} leitet jetzt nach außen um: ${n}`, 'info')
}

guard.on('ban', (ip: string, reason: string) => securityAlert(`ban:${ip}`, `Adresse ${ip} gesperrt: ${reason}`))

/** Adresse im eigenen Netz? (Dort bremst nur die Anmeldung, damit sich niemand aussperrt) */
function isLocal(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || inList(ip, store.config.system.local_nets)
}

// Zu viele Fehlversuche über HTTP (Anmeldung, PIN, Einrichtungslinks): von außen auf die
// gemeinsame Sperrliste – gilt dann auch für SIP
auth.onBlock = (ip, reason) => {
  if (!isLocal(ip)) guard.report(ip, `${reason} (Weboberfläche/Einrichtung)`)
  else securityAlert(`http:${ip}`, `Viele Fehlversuche von ${ip}: ${reason}. Die Adresse ist 15 Minuten gebremst.`)
}

/** Gebremst (zu viele Fehlversuche) oder gesperrt? */
function isBlocked(ip: string): boolean {
  return auth.blocked(ip) || guard.isBanned(ip)
}

const TOO_MANY = 'Zu viele Fehlversuche. Bitte 15 Minuten warten.'

// -- Interne Schnittstelle für den Wählplan (nur von localhost) ------------------

const internal = new Router()
internal.get('/internal/in', (r) => {
  const result = routeInbound(store.config, {
    trunk: r.query.get('trunk') ?? '',
    did: r.query.get('did') ?? '',
    to: r.query.get('to') ?? '',
    cid: r.query.get('cid') ?? '',
    name: inboundName(r.query.get('name') ?? ''),
  })
  const [target, name, from, to] = result.split('|')
  if (target === BLOCKED_TARGET) tracker.report('call.blocked', { from, from_name: name, to })
  return result
})
/** Auslandsgespräche heute (für die Tagesgrenze; nach einem Neustart wieder ab 0) */
let international = { day: '', count: 0 }

internal.get('/internal/out', (r) => {
  const ext = r.query.get('ext') ?? ''
  const fwd = r.query.get('fwd') ?? ''
  const num = r.query.get('num') ?? ''
  const result = routeOutbound(store.config, { ext, fwd, num, cid: r.query.get('cid') ?? '' })
  // Auch wenn der Notruf nicht rausgeht (kein Konto, gesperrt): gerade dann sollen es andere erfahren
  if (isEmergency(num, fwd)) setImmediate(() => emergencyNotify(ext, num))
  if (!result.startsWith('ok|') || !isInternational(store.config, num)) return result
  const day = new Date().toISOString().slice(0, 10)
  if (international.day !== day) international = { day, count: 0 }
  international.count++
  const who = fwd ? (fwd === 'flow' ? 'Rufabfolge' : `Umleitung von ${fwd}`) : `Nebenstelle ${ext}`
  const limit = store.config.security.international_per_day
  if (limit > 0 && international.count > limit) {
    store.update((draft) => void (draft.security.outbound_stop = true))
    securityAlert(
      'brake',
      `Notbremse ausgelöst: mehr als ${limit} Auslandsgespräche heute (zuletzt ${who} → ${num}). Gespräche nach außen sind gesperrt, Notrufe gehen weiter. Freigeben unter System → Sicherheit.`,
      'error',
    )
    return 'deny'
  }
  securityAlert(`intl:${who}`, `Auslandsgespräch: ${who} → ${num} (${international.count}. heute)`, 'info')
  return result
})
internal.get('/internal/alert', (r) => {
  if (r.query.get('kind') === 'limit') {
    const ext = r.query.get('ext') || 'Rufabfolge'
    securityAlert(`limit:${ext}`, `Grenze für gleichzeitige Gespräche nach außen erreicht (${ext}). Weitere Gespräche wurden abgewiesen.`)
  }
  return 'ok'
})
internal.get('/internal/ext', (r) => extensionPlan(store.config, store.state, r.query.get('num') ?? ''))
internal.get('/internal/group', (r) =>
  groupPlan(store.config, store.state, r.query.get('id') ?? '', r.query.get('name') ?? '', PATHS.sounds),
)
internal.get('/internal/video', (r) => (messenger.mayJoin(r.query.get('ext') ?? '', r.query.get('room') ?? '') ? '1' : '0'))
internal.get('/internal/tc', (r) => timeConditionTarget(store.config, r.query.get('id') ?? ''))
internal.get('/internal/available', (r) => (isAvailable(store.state, r.query.get('num') ?? '', store.config, r.query.get('gid') ?? '') ? '1' : '0'))
internal.get('/internal/fax', (r) => {
  void faxReceived(r.query).catch((e: Error) => console.error('Fax empfangen:', e.message))
  return 'ok'
})
internal.get('/internal/fax-job', (r) => {
  const rec = faxes.get(r.query.get('job') ?? '')
  const box = store.config.faxes.find((f) => f.id === rec?.box)
  if (!rec || !box || rec.direction !== 'out') return ''
  return [path.join(FAX_SPOOL, `out-${rec.id}.tif`), box.station || 'Phone4all', box.header.replace(/\|/g, ' ')].join('|')
})
internal.get('/internal/fax-sent', (r) => {
  const rec = faxes.get(r.query.get('job') ?? '')
  if (!rec || rec.status !== 'sending') return 'ok'
  const status = r.query.get('status') ?? ''
  faxes.update(rec.id, { station: r.query.get('remote') ?? '' })
  if (status === 'SUCCESS') faxFinished(rec, 'ok', '')
  else faxRetry(rec.id, faxErrorText(status, r.query.get('error') ?? ''))
  return 'ok'
})
internal.get('/internal/mobile', (r) => mobilePlan(store.config, r.query.get('num') ?? ''))
internal.get('/internal/page', (r) => pagePlan(store.config, store.state, r.query.get('ext') ?? '', r.query.get('target') ?? '', r.query.get('mode') ?? ''))
internal.get('/internal/ring', (r) => ringPlan(store.config, store.state, r.query.get('target') ?? ''))
internal.get('/internal/feature', (r) => {
  const ext = r.query.get('ext') ?? ''
  const result = feature(store.config, store.state, ext, r.query.get('code') ?? '', r.query.get('arg') ?? '')
  if (r.query.get('code') === 'cfu' && result.reply === 'on') forwardAlert(ext, store.state.cfu[ext] ?? '')
  if (result.stateChanged) store.saveState()
  if (result.configChanged) store.save()
  return result.reply
})

// -- Öffentlich: Anmeldung und Einrichtung der App ---------------------------------

const api = new Router()
const pub = new Router()

function requestBase(r: Request): string {
  const host = (r.raw.headers['x-forwarded-host'] as string | undefined) ?? r.raw.headers.host
  const direct = 'encrypted' in r.raw.socket ? 'https' : 'http'
  return baseUrl(host, store.config, (r.raw.headers['x-forwarded-proto'] as string | undefined) ?? direct)
}

// Jede App fragt minütlich nach der Profil-Revision. Das Profil hängt nur an Konfiguration,
// Kontaktquellen, Adresse, Geräte-Token und TURN-Zugang (wechselt täglich) – bis sich davon
// etwas ändert, reicht das zuletzt gebaute.
const profiles = new WeakMap<PbxConfig, Map<string, { key: string; profile: ReturnType<typeof profile> }>>()

/** Profil der Nebenstelle für ein Gerät, mit Zugangsdaten für den TURN-Server */
function extProfile(r: Request, ext: Extension, token: string) {
  const cfg = store.config
  const base = requestBase(r)
  const ice = turn.iceServers(cfg, linkBase(cfg, base), appEndpoint(ext.number))
  const key = `${base}|${sources.revision}|${JSON.stringify(ice)}`
  let cache = profiles.get(cfg)
  if (!cache) profiles.set(cfg, (cache = new Map()))
  const id = `${ext.id}|${token}`
  const hit = cache.get(id)
  if (hit?.key === key) return hit.profile
  const result = profile(cfg, ext, base, ice, token)
  cache.set(id, { key, profile: result })
  return result
}

/** Name eines neuen Geräts: von der App mitgeschickt, sonst aus der Kennung geraten */
function deviceName(r: Request): string {
  let sent = String(r.raw.headers['x-device-name'] ?? '')
  try {
    sent = decodeURIComponent(sent)
  } catch {
    // unverändert
  }
  sent = sent.replace(/[^\p{L}\p{N} ._()'-]/gu, '').trim().slice(0, 40)
  if (sent) return sent
  const ua = String(r.raw.headers['user-agent'] ?? '')
  if (/android|okhttp/i.test(ua)) return 'Android'
  if (/iphone|ipad|darwin|cfnetwork/i.test(ua)) return 'iPhone'
  return 'Desktop-App'
}

/** Neues Gerät für die Nebenstelle anlegen und sein Profil liefern */
function newDeviceProfile(r: Request, extId: string, how: string) {
  let token = ''
  let name = ''
  try {
    store.update((draft) => {
      const device = addDevice(draft.extensions.find((e) => e.id === extId)!, deviceName(r), r.ip)
      token = device.token
      name = device.name
    })
  } catch (e) {
    if (e instanceof ValidationError) throw new HttpError(409, e.message)
    throw e
  }
  const ext = store.config.extensions.find((e) => e.id === extId)!
  securityAlert(`device:${ext.number}:${token}`, `Neues Gerät „${name}“ für Nebenstelle ${ext.number} ${how} (von ${r.ip}).`, 'info')
  return extProfile(r, ext, token)
}

/** Zuletzt gesehen merken (höchstens alle 10 Minuten in die Konfiguration schreiben) */
function touchDevice(token: string, ip: string): void {
  const found = findDevice(store.config, token)
  if (!found || (Date.now() - found.device.seen < 600000 && found.device.ip === ip)) return
  store.update((draft) => {
    const d = findDevice(draft, token)?.device
    if (d) Object.assign(d, { seen: Date.now(), ip })
  })
}

/** Zugang zur Sitzung mit Rolle; null, wenn nicht (mehr) angemeldet */
function sessionUser(token: string | undefined): { login: string; name: string; role: Role } | null {
  const login = auth.user(token)
  if (!login) return null
  if (login === 'admin') return { login, name: 'Verwaltung', role: 'admin' }
  const u = users.find(login)
  return u ? { login, name: u.name, role: u.role } : null
}

pub.get('/api/session', (r) => {
  const user = sessionUser(r.cookies[SESSION_COOKIE])
  // Version nur nach Anmeldung (verrät sonst, welche Lücken offen sein könnten)
  return { authenticated: Boolean(user), name: store.config.system.name, ...(user ? { version: SETTINGS.version, user } : {}), users: users.list().length > 0 }
})

pub.post('/api/login', async (r) => {
  if (isBlocked(r.ip)) throw new HttpError(429, TOO_MANY)
  const body = await r.json<{ user?: string; password: string }>()
  const login = String(body.user ?? '').trim().toLowerCase() || 'admin'
  const password = String(body.password ?? '')
  const ok = login === 'admin' ? auth.check(password) : Boolean(users.check(login, password))
  if (!ok) {
    auth.failed(r.ip, 'Falsches Passwort der Weboberfläche')
    audit.add(r.ip, `Anmeldung fehlgeschlagen (${login.slice(0, 32)})`)
    throw new HttpError(401, login === 'admin' ? 'Das Passwort ist falsch.' : 'Anmeldename oder Passwort ist falsch.')
  }
  const token = auth.login(login)
  audit.add(r.ip, `Angemeldet (${login})`)
  r.res.setHeader('Set-Cookie', sessionCookie(r, token, SESSION_MAX_AGE))
  return { ok: true }
})

/** Sitzungs-Cookie; über HTTPS (auch hinter dem Proxy) mit Secure */
function sessionCookie(r: Request, token: string, maxAge: number): string {
  const https = r.raw.headers['x-forwarded-proto'] === 'https' || 'encrypted' in r.raw.socket
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${https ? '; Secure' : ''}`
}

pub.post('/api/logout', (r) => {
  auth.logout(r.cookies[SESSION_COOKIE] ?? '')
  r.res.setHeader('Set-Cookie', sessionCookie(r, '', 0))
  return { ok: true }
})

/** Zustand für Docker-Healthcheck, Home Assistant und Überwachung von außen (ohne Details) */
pub.get('/health', (r) => {
  const status = watchdog.status()
  const asteriskDown = status.checks.find((c) => c.id === 'asterisk')?.level === 'error'
  sendJson(r.res, asteriskDown ? 503 : 200, {
    status: watchdog.overall(),
    checks: Object.fromEntries(status.checks.map((c) => [c.id, c.level])),
    checked: status.checked,
    version: SETTINGS.version,
  })
})

/**
 * Die App ruft ihr Profil ab (auch zum Auffrischen). Mit dem Token des Einladungslinks
 * bekommt sie ein eigenes Geräte-Token; danach fragt sie nur noch unter dieser Adresse.
 */
pub.get('/provision/:token', (r) => {
  const token = r.params.token
  if (findDevice(store.config, token)) {
    const ext = tokenExtension(token, r.ip)
    return extProfile(r, ext, token)
  }
  const invited = store.config.extensions.find((e) => e.provision_token && e.provision_token === token)
  if (!invited) throw new HttpError(404, 'Unbekannter Einrichtungslink.')
  if (!linkValid(invited)) throw new HttpError(410, 'Der Einrichtungslink ist abgelaufen. Bitte bei der Verwaltung eine neue Einladung anfordern.')
  return newDeviceProfile(r, invited.id, 'über den Einladungslink eingerichtet')
})

/** Nebenstelle zum Token eines eingerichteten Geräts */
function tokenExtension(token: string, ip = ''): Extension {
  const found = findDevice(store.config, token)
  if (!found) throw new HttpError(404, 'Unbekannter Einrichtungslink.')
  if (ip) touchDevice(token, ip)
  return found.ext
}

function range(r: Request): [number, number] {
  const start = Date.parse(r.query.get('start') ?? '')
  const end = Date.parse(r.query.get('end') ?? '')
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start || end - start > 400 * 86400000) {
    throw new HttpError(400, 'Zeitraum fehlt oder ist zu groß (start/end als ISO-Datum, höchstens 400 Tage).')
  }
  return [start, end]
}

/** Die App fragt regelmäßig, ob sich Profil oder Termine geändert haben. */
pub.get('/provision/:token/revision', (r) => {
  const ext = tokenExtension(r.params.token, r.ip)
  return { profile: extProfile(r, ext, r.params.token).revision, events: String(calendars.revision) }
})

/** Termine der zentralen Kalender, die diese Nebenstelle sieht */
pub.get('/provision/:token/events', (r) => {
  const ext = tokenExtension(r.params.token)
  const [start, end] = range(r)
  const only = r.query.get('calendar')
  return visibleCalendars(store.config, ext)
    .filter((c) => !only || c.id === only)
    .flatMap((c) => calendars.events(c.id, start, end).map((e) => ({ ...e, calendar: c.id })))
})

function writableFor(token: string, id: string): void {
  const cal = visibleCalendars(store.config, tokenExtension(token)).find((c) => c.id === id)
  if (!cal) throw new HttpError(404, 'Kalender nicht gefunden.')
  if (!cal.writable || cal.kind !== 'events') throw new HttpError(403, 'Dieser Kalender ist schreibgeschützt.')
  if (!appPermissions(store.config, tokenExtension(token).number).includes('calendar_edit')) {
    throw new HttpError(403, 'Termine bearbeiten ist für diese Nebenstelle nicht freigegeben.')
  }
}

pub.put('/provision/:token/events/:calendar/:uid', async (r) => {
  writableFor(r.params.token, r.params.calendar)
  return calendars.upsert(r.params.calendar, await r.json(), r.params.uid)
})

pub.delete('/provision/:token/events/:calendar/:uid', (r) => {
  writableFor(r.params.token, r.params.calendar)
  calendars.remove(r.params.calendar, r.params.uid)
  return { ok: true }
})

// -- Messenger: Verbindung per WebSocket (siehe upgrade unten), Dateien per HTTP ---------

function chatUser(token: string): Extension {
  const ext = tokenExtension(token)
  if (!messengerUsers(store.config).some((e) => e.id === ext.id)) throw new HttpError(403, 'Der Messenger ist für diese Nebenstelle nicht freigegeben.')
  return ext
}

const CHAT_UPLOAD = /^\/provision\/[^/]+\/chat\/files$/

pub.post('/provision/:token/chat/files', async (r) => {
  const ext = chatUser(r.params.token)
  const name = r.query.get('name') ?? 'datei'
  const type = String(r.raw.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim()
  const data = await r.body()
  if (!data.length) throw new HttpError(400, 'Die Datei ist leer.')
  try {
    const message = messenger.postFile(ext.number, r.query.get('room') ?? '', name, type, data, r.query.get('text') ?? '')
    setImmediate(messengerCleanup)
    return message
  } catch (e) {
    if (e instanceof ChatError) throw new HttpError(400, e.message)
    throw e
  }
})

pub.get('/provision/:token/chat/files/:room/:id', (r) => {
  const ext = chatUser(r.params.token)
  try {
    messenger.store.room(r.params.room, ext.number)
    const file = messenger.store.filePath(r.params.room, r.params.id)
    if (!fs.existsSync(file)) throw new HttpError(404, 'Die Datei wurde gelöscht (Speicher war knapp).')
    r.res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': fs.statSync(file).size,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    })
    fs.createReadStream(file).pipe(r.res)
  } catch (e) {
    if (e instanceof ChatError) throw new HttpError(404, e.message)
    throw e
  }
})

/** Zentrales Telefonbuch aus der App bearbeiten (Recht phonebook_edit) */
function phonebookEditor(token: string): Extension {
  const ext = tokenExtension(token)
  if (!appPermissions(store.config, ext.number).includes('phonebook_edit')) {
    throw new HttpError(403, 'Das Telefonbuch der Anlage darf von dieser Nebenstelle nicht bearbeitet werden.')
  }
  return ext
}

function phonebookEntry(raw: Partial<PhonebookEntry>, id = ''): PhonebookEntry {
  const text = (v: unknown, max = 200): string => String(v ?? '').trim().slice(0, max)
  const entry = { id, name: text(raw.name), company: text(raw.company), phone: text(raw.phone, 40), mobile: text(raw.mobile, 40) }
  if (!entry.name) throw new HttpError(400, 'Der Kontakt braucht einen Namen.')
  if (!entry.phone && !entry.mobile) throw new HttpError(400, 'Der Kontakt braucht eine Telefonnummer.')
  return entry
}

pub.post('/provision/:token/phonebook', async (r) => {
  phonebookEditor(r.params.token)
  return store.upsert('phonebook', { ...phonebookEntry(await r.json()) })
})

pub.put('/provision/:token/phonebook/:id', async (r) => {
  phonebookEditor(r.params.token)
  if (!store.config.phonebook.some((p) => p.id === r.params.id)) throw new HttpError(404, 'Kontakt nicht gefunden.')
  return store.upsert('phonebook', { ...phonebookEntry(await r.json(), r.params.id) })
})

pub.delete('/provision/:token/phonebook/:id', (r) => {
  phonebookEditor(r.params.token)
  if (!store.config.phonebook.some((p) => p.id === r.params.id)) throw new HttpError(404, 'Kontakt nicht gefunden.')
  store.remove('phonebook', r.params.id)
  return { ok: true }
})

/** Umleitungen der Nebenstelle für die Statusleiste der App */
pub.get('/provision/:token/forward', (r) => forwardInfo(store.config, store.state, tokenExtension(r.params.token)))

pub.put('/provision/:token/forward', async (r) => {
  const ext = tokenExtension(r.params.token)
  changeForward(ext, await r.json<ForwardChange>())
  return forwardInfo(store.config, store.state, tokenExtension(r.params.token))
})

/** Umleitungen ändern (App und Selbstbedienung) */
function changeForward(ext: Extension, change: ForwardChange): void {
  const rules = change.busy !== undefined || change.noanswer !== undefined || change.rules !== undefined
  try {
    // Erst die Sofort-Umleitung prüfen – sonst wären bei einem Fehler die Regeln schon gespeichert
    if (change.cfu !== undefined) checkForward(store.config, ext.number, String(change.cfu))
    if (rules) store.update((draft) => applyRules(draft, draft.extensions.find((e) => e.id === ext.id)!, change))
    if (change.mobile !== undefined) store.update((draft) => applyMobile(draft, draft.extensions.find((e) => e.id === ext.id)!, Boolean(change.mobile)))
    if (change.cfu !== undefined) {
      applyCfu(store.config, store.state, ext.number, String(change.cfu))
      store.saveState()
      forwardAlert(ext.number, String(change.cfu))
    }
  } catch (e) {
    if (e instanceof ForwardError) throw new HttpError(403, e.message)
    throw e
  }
}

/** Fehlversuche mit der PIN je Nebenstelle; danach ist die PIN verbraucht */
const pinFailures = new Map<string, number>()
const PIN_MAX_FAILURES = 5

/** Besetztanzeige der Kollegen, geparkte Gespräche, Stand der eigenen Voicemail (die Apps fragen alle paar Sekunden) */
pub.get('/provision/:token/presence', (r) => {
  const ext = tokenExtension(r.params.token)
  const view = presence.view(store.config, store.state)
  const vm = ext.voicemail.enabled ? { revision: `${voicemail.revision(ext.number)}-${transcriber.count(ext.number)}`, unread: voicemail.unread(ext.number) } : null
  const groups = memberGroups(store.config, store.state, ext.number)
  const list = store.config.groups.some((g) => g.missed_list && g.members.includes(ext.number))
  return {
    ...view,
    voicemail: vm,
    groups,
    missed: list ? { open: missed.open(store.config, ext.number), revision: String(missed.revision) } : null,
  }
})

/** Gruppen der Nebenstelle: an- und abmelden (wie *45 am Telefon) */
pub.get('/provision/:token/groups', (r) => memberGroups(store.config, store.state, tokenExtension(r.params.token).number))

pub.put('/provision/:token/groups/:id', async (r) => {
  const ext = tokenExtension(r.params.token)
  const { active } = await r.json<{ active: boolean }>()
  if (!setAway(store.config, store.state, ext.number, r.params.id, !active)) throw new HttpError(404, 'Gruppe nicht gefunden.')
  store.saveState()
  return memberGroups(store.config, store.state, ext.number)
})

/** Verpasste Anrufe der eigenen Gruppen (gemeinsame Liste) */
function missedView(ext = '') {
  const names = new Map(store.config.groups.map((g) => [g.id, g.name]))
  return missed.visible(store.config, ext).map((e) => ({ ...e, group_name: names.get(e.group) ?? '' }))
}

const MISSED_ACTIONS: MissedAction[] = ['claim', 'release', 'done', 'reopen']

// Faxe aus den Apps senden (Recht „Faxe senden“): Faxgeräte, eigene gesendete Faxe, senden
const FAX_UPLOAD = /^\/provision\/[^/]+\/fax$/

function faxSender(token: string): Extension {
  const ext = tokenExtension(token)
  if (!appPermissions(store.config, ext.number).includes('fax_send')) throw new HttpError(403, 'Faxe senden ist für diese Nebenstelle nicht freigegeben.')
  return ext
}

pub.get('/provision/:token/fax', (r) => {
  const ext = faxSender(r.params.token)
  return {
    boxes: store.config.faxes.map((f) => ({ id: f.id, name: f.name })),
    sent: faxes.list().filter((f) => f.direction === 'out' && f.by === ext.number).slice(0, 50),
  }
})
pub.post('/provision/:token/fax', async (r) => {
  const ext = faxSender(r.params.token)
  return sendFax(r.query.get('box') ?? '', r.query.get('number') ?? '', await r.body(), ext.number)
})

pub.get('/provision/:token/missed', (r) => missedView(tokenExtension(r.params.token).number))

pub.put('/provision/:token/missed/:group/:id', async (r) => {
  const ext = tokenExtension(r.params.token)
  const { action } = await r.json<{ action: MissedAction }>()
  if (!MISSED_ACTIONS.includes(action)) throw new HttpError(400, 'Unbekannte Aktion.')
  if (!missed.act(store.config, r.params.id, r.params.group, action, ext.number, ext.number)) throw new HttpError(404, 'Eintrag nicht gefunden.')
  return missedView(ext.number)
})

function voicemailExtension(token: string): Extension {
  const ext = tokenExtension(token)
  if (!ext.voicemail.enabled) throw new HttpError(403, 'Für diese Nebenstelle ist keine Voicemail eingerichtet.')
  return ext
}

/** Nachrichten mit Text (falls Voicemail als Text eingeschaltet ist) */
function voicemailList(mailbox: string): (VoicemailMessage & { text?: string; transcribing?: boolean })[] {
  const on = store.config.transcription.enabled
  return voicemail.list(mailbox).map((m) => {
    if (!on) return m
    const t = transcriber.get(mailbox, m.id)
    return t ? { ...m, text: t.text } : { ...m, transcribing: transcriber.pending(mailbox, m.id) }
  })
}

pub.get('/provision/:token/voicemail', (r) => voicemailList(voicemailExtension(r.params.token).number))

pub.get('/provision/:token/voicemail/:id', (r) => {
  const ext = voicemailExtension(r.params.token)
  const file = voicemail.file(ext.number, r.params.id)
  if (!file) throw new HttpError(404, 'Nachricht nicht gefunden.')
  sendFile(r.res, file)
})

/** Als gehört markieren (INBOX → Old); Asterisk schaltet dabei die Anzeige an den Telefonen aus */
pub.put('/provision/:token/voicemail/:id', async (r) => {
  const ext = voicemailExtension(r.params.token)
  const msg = voicemail.find(ext.number, r.params.id)
  if (!msg) throw new HttpError(404, 'Nachricht nicht gefunden.')
  if (msg.folder === 'INBOX') {
    await voicemailAction({ Action: 'VoicemailMove', Context: 'default', Mailbox: ext.number, Folder: 'INBOX', ID: msg.id, ToFolder: 'Old' })
  }
  return voicemailList(ext.number)
})

pub.delete('/provision/:token/voicemail/:id', async (r) => {
  const ext = voicemailExtension(r.params.token)
  const msg = voicemail.find(ext.number, r.params.id)
  if (!msg) throw new HttpError(404, 'Nachricht nicht gefunden.')
  await voicemailAction({ Action: 'VoicemailRemove', Context: 'default', Mailbox: ext.number, Folder: msg.folder, ID: msg.id })
  return voicemailList(ext.number)
})

async function voicemailAction(fields: Record<string, string>): Promise<void> {
  const [res] = await asterisk.ami.action(fields).catch((e: Error) => {
    throw new HttpError(503, `Asterisk antwortet nicht: ${e.message}`)
  })
  if (res?.Response !== 'Success') throw new HttpError(500, res?.Message || 'Asterisk hat die Nachricht nicht geändert.')
}

/** Rückfrage abschließen: verbinden (Gegenüber miteinander) oder Dreierkonferenz */
pub.post('/provision/:token/calls/join', async (r) => {
  const ext = tokenExtension(r.params.token)
  const { mode } = await r.json<{ mode: 'transfer' | 'conference' }>()
  if (mode !== 'transfer' && mode !== 'conference') throw new HttpError(400, 'Unbekannte Art.')
  const channels = await asterisk.ami.list({ Action: 'CoreShowChannels' }).catch((e: Error) => {
    throw new HttpError(503, `Asterisk antwortet nicht: ${e.message}`)
  })
  let actions: Record<string, string>[]
  try {
    actions = joinActions(mode, callLegs(channels, ext.number), joinRoom(ext.number))
  } catch (e) {
    if (e instanceof JoinError) throw new HttpError(409, e.message)
    throw e
  }
  for (const a of actions) {
    const [res] = await asterisk.ami.action(a)
    if (res?.Response !== 'Success' && a.Action !== 'Hangup') throw new HttpError(500, res?.Message || 'Das Zusammenführen hat nicht geklappt.')
  }
  return { ok: true }
})

// -- Selbstbedienung unter /me (Nebenstelle und Voicemail-PIN) ----------------------------

const portal = new PortalSessions()

function portalGate(r: Request): void {
  const p = store.config.portal
  if (!p.enabled) throw new HttpError(404, 'Die Selbstbedienung ist ausgeschaltet.')
  if (!p.remote && !isLocal(r.ip)) throw new HttpError(403, 'Die Selbstbedienung ist nur im Netz der Anlage erreichbar.')
  // Schutz vor fremden Formularen wie bei der Verwaltung
  if (r.method !== 'GET' && r.raw.headers['x-phone4all'] !== '1') throw new HttpError(403, 'Anfrage abgelehnt.')
}

function portalExt(r: Request): Extension {
  portalGate(r)
  const num = portal.ext(r.cookies[PORTAL_COOKIE])
  const ext = store.config.extensions.find((e) => e.number === num)
  if (!ext) throw new HttpError(401, 'Bitte anmelden.')
  return ext
}

function portalCookie(r: Request, token: string, maxAge: number): string {
  const https = r.raw.headers['x-forwarded-proto'] === 'https' || 'encrypted' in r.raw.socket
  return `${PORTAL_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/me; Max-Age=${maxAge}${https ? '; Secure' : ''}`
}

function samePin(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

pub.get('/me', (r) => {
  portalGate(r)
  r.res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'")
  r.res.setHeader('Referrer-Policy', 'no-referrer')
  sendText(r.res, 200, portalPage(store.config), 'text/html; charset=utf-8')
})
pub.get('/me/app.js', (r) => {
  portalGate(r)
  sendText(r.res, 200, PORTAL_JS, 'text/javascript; charset=utf-8')
})

pub.post('/me/api/login', async (r) => {
  portalGate(r)
  if (isBlocked(r.ip)) throw new HttpError(429, TOO_MANY)
  const { number, pin } = await r.json<{ number: string; pin: string }>()
  const ext = store.config.extensions.find((e) => e.number === String(number ?? '').trim())
  if (ext && portal.locked(ext.number)) throw new HttpError(429, 'Zu viele falsche PINs – bitte in 15 Minuten noch einmal versuchen.')
  const stored = ext?.voicemail.pin.replace(/\D/g, '') ?? ''
  if (!ext || stored.length < 4 || !samePin(String(pin ?? ''), stored)) {
    auth.failed(r.ip, 'Falsche PIN der Selbstbedienung')
    if (ext) portal.failed(ext.number)
    throw new HttpError(401, 'Nebenstelle oder PIN ist falsch.')
  }
  portal.succeeded(ext.number)
  r.res.setHeader('Set-Cookie', portalCookie(r, portal.login(ext.number), PORTAL_MAX_AGE))
  audit.add(r.ip, `Selbstbedienung: ${ext.number} angemeldet`)
  return { ok: true }
})
pub.post('/me/api/logout', (r) => {
  portal.logout(r.cookies[PORTAL_COOKIE] ?? '')
  r.res.setHeader('Set-Cookie', portalCookie(r, '', 0))
  return { ok: true }
})
pub.get('/me/api/state', (r) => {
  const ext = portalExt(r)
  return {
    ext: { number: ext.number, name: ext.name },
    dnd: Boolean(store.state.dnd[ext.number]),
    forward: forwardInfo(store.config, store.state, ext),
    groups: memberGroups(store.config, store.state, ext.number),
    voicemail: ext.voicemail.enabled ? voicemailList(ext.number) : null,
  }
})
pub.put('/me/api/dnd', async (r) => {
  const ext = portalExt(r)
  const { enabled } = await r.json<{ enabled: boolean }>()
  if (enabled) store.state.dnd[ext.number] = true
  else delete store.state.dnd[ext.number]
  store.saveState()
  return { ok: true }
})
pub.put('/me/api/forward', async (r) => {
  const ext = portalExt(r)
  changeForward(ext, await r.json<ForwardChange>())
  return forwardInfo(store.config, store.state, store.config.extensions.find((e) => e.id === ext.id)!)
})
pub.put('/me/api/groups/:id', async (r) => {
  const ext = portalExt(r)
  const { active } = await r.json<{ active: boolean }>()
  if (!setAway(store.config, store.state, ext.number, r.params.id, !active)) throw new HttpError(404, 'Gruppe nicht gefunden.')
  store.saveState()
  return memberGroups(store.config, store.state, ext.number)
})
function portalMailbox(r: Request): Extension {
  const ext = portalExt(r)
  if (!ext.voicemail.enabled) throw new HttpError(403, 'Für diese Nebenstelle ist keine Voicemail eingerichtet.')
  return ext
}
pub.get('/me/api/voicemail/:id', (r) => {
  const ext = portalMailbox(r)
  const file = voicemail.file(ext.number, r.params.id)
  if (!file) throw new HttpError(404, 'Nachricht nicht gefunden.')
  sendFile(r.res, file)
})
pub.put('/me/api/voicemail/:id', async (r) => {
  const ext = portalMailbox(r)
  const msg = voicemail.find(ext.number, r.params.id)
  if (!msg) throw new HttpError(404, 'Nachricht nicht gefunden.')
  if (msg.folder === 'INBOX') await voicemailAction({ Action: 'VoicemailMove', Context: 'default', Mailbox: ext.number, Folder: 'INBOX', ID: msg.id, ToFolder: 'Old' })
  return voicemailList(ext.number)
})
pub.delete('/me/api/voicemail/:id', async (r) => {
  const ext = portalMailbox(r)
  const msg = voicemail.find(ext.number, r.params.id)
  if (!msg) throw new HttpError(404, 'Nachricht nicht gefunden.')
  await voicemailAction({ Action: 'VoicemailRemove', Context: 'default', Mailbox: ext.number, Folder: msg.folder, ID: msg.id })
  return voicemailList(ext.number)
})
pub.put('/me/api/pin', async (r) => {
  const ext = portalExt(r)
  const { old, pin } = await r.json<{ old: string; pin: string }>()
  if (!samePin(String(old ?? ''), ext.voicemail.pin.replace(/\D/g, ''))) {
    portal.failed(ext.number)
    throw new HttpError(403, 'Die bisherige PIN stimmt nicht.')
  }
  const next = String(pin ?? '')
  if (!/^\d{4,8}$/.test(next)) throw new HttpError(400, 'Die PIN hat 4 bis 8 Ziffern.')
  if (/^(\d)\1+$/.test(next) || '0123456789'.includes(next) || next === ext.number) throw new HttpError(400, 'Diese PIN ist zu leicht zu erraten.')
  store.update((draft) => void (draft.extensions.find((e) => e.id === ext.id)!.voicemail.pin = next))
  applySoon()
  portal.logoutExt(ext.number, r.cookies[PORTAL_COOKIE] ?? '')
  audit.add(r.ip, `Selbstbedienung: ${ext.number} hat die Voicemail-PIN geändert`)
  return { ok: true }
})

/** Anrufer aus der App heraus sperren (Recht „Rufnummern sperren“) */
pub.post('/provision/:token/blocklist', async (r) => {
  const ext = tokenExtension(r.params.token)
  if (!appPermissions(store.config, ext.number).includes('block_numbers')) throw new HttpError(403, 'Sperren ist für diese Nebenstelle nicht freigegeben.')
  const { number, note } = await r.json<{ number: string; note?: string }>()
  const clean = cleanNumber(String(number ?? ''))
  if (!clean || store.config.extensions.some((e) => e.number === clean)) throw new HttpError(400, 'Diese Nummer kann nicht gesperrt werden.')
  const existing = store.config.blocklist.find((b) => b.number === clean)
  if (existing) return existing
  return store.upsert('blocklist', { number: clean, note: String(note ?? '').slice(0, 200), created: '', by: ext.number })
})

pub.delete('/provision/:token/blocklist/:number', (r) => {
  const ext = tokenExtension(r.params.token)
  if (!appPermissions(store.config, ext.number).includes('block_numbers')) throw new HttpError(403, 'Sperren ist für diese Nebenstelle nicht freigegeben.')
  const entry = store.config.blocklist.find((b) => b.number === cleanNumber(r.params.number))
  if (entry) store.remove('blocklist', entry.id)
  return { ok: true }
})

/** Einrichtung mit Nebenstelle und Einrichtungs-PIN (gilt einmal und befristet) */
pub.post('/provision', async (r) => {
  if (isBlocked(r.ip)) throw new HttpError(429, TOO_MANY)
  if (!store.config.provisioning.pin_remote && !isLocal(r.ip)) {
    throw new HttpError(403, 'Die Einrichtung per PIN geht nur im Netz der Anlage. Bitte den Einrichtungslink aus der Einladung verwenden.')
  }
  const { extension, pin } = await r.json<{ extension: string; pin: string }>()
  const ext = store.config.extensions.find((e) => e.number === String(extension ?? '').trim())
  const ok = ext && pinValid(ext) && Boolean(pin) && String(pin).trim().length === ext.provision_pin.length &&
    timingSafeEqual(Buffer.from(String(pin).trim()), Buffer.from(ext.provision_pin))
  if (!ext || !ok) {
    auth.failed(r.ip, 'Falsche Einrichtungs-PIN')
    if (ext) {
      const n = (pinFailures.get(ext.id) ?? 0) + 1
      pinFailures.set(ext.id, n)
      if (n >= PIN_MAX_FAILURES && pinValid(ext)) {
        pinFailures.delete(ext.id)
        store.update((draft) => consumePin(draft.extensions.find((e) => e.id === ext.id)!))
        securityAlert(`pin:${ext.number}`, `Einrichtungs-PIN der Nebenstelle ${ext.number} nach ${n} Fehlversuchen ungültig gemacht (zuletzt von ${r.ip}).`)
      }
    }
    throw new HttpError(403, 'Nebenstelle oder Einrichtungs-PIN stimmen nicht, oder die PIN ist abgelaufen.')
  }
  pinFailures.delete(ext.id)
  // Einmal benutzt: Für das nächste Gerät erzeugt die Verwaltung eine neue PIN
  const result = newDeviceProfile(r, ext.id, 'per PIN eingerichtet')
  store.update((draft) => consumePin(draft.extensions.find((e) => e.id === ext.id)!))
  return result
})

/** Seite für den Link aus der Einladungs-E-Mail */
pub.get('/setup/:token', (r) => {
  const ext = store.config.extensions.find((e) => e.provision_token && e.provision_token === r.params.token)
  if (!ext) throw new HttpError(404, 'Unbekannter Einrichtungslink.')
  r.res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
  r.res.setHeader('Referrer-Policy', 'no-referrer')
  if (!linkValid(ext)) return sendText(r.res, 410, expiredPage(store.config), 'text/html; charset=utf-8')
  sendText(r.res, 200, landingPage(store.config, ext, linkBase(store.config, requestBase(r))), 'text/html; charset=utf-8')
})

// -- DECT-Basen holen ihre Einrichtung (Gigaset N610/N670/N870 IP PRO) ---------------

/** Letzter Abruf je Basis (nur im Speicher) */
const dectSeen = new Map<string, { time: number; ip: string; agent: string; mac: string }>()

/** SIP-Server für die Basis: eingestellte Adresse, sonst die, unter der sie uns erreicht */
function sipHostFor(base: string): string {
  return store.config.system.sip_host.trim() || new URL(base).hostname.replace(/^\[|\]$/g, '')
}

/** Adresse, unter der Geräte im LAN die Anlage erreichen (für Einrichtungslinks) */
function lanBase(r: Request): string {
  const host = store.config.system.sip_host.trim()
  return host ? `http://${host}:${SETTINGS.httpPort}` : requestBase(r)
}

function dectServer(base: string, b: DectBase): string {
  return `${base}/dect/${b.token}/`
}

function dectFile(r: Request): void {
  const b = store.config.dect.find((x) => x.token && x.token === r.params.token)
  if (!b) throw new HttpError(404, 'Unbekannte Basis.')
  const agent = String(r.raw.headers['user-agent'] ?? '')
  const mac = requestMac(r.params.file ?? '', agent)
  if (b.mac && mac && mac !== b.mac) throw new HttpError(404, 'Diese Einrichtung gehört zu einer anderen Basis.')
  dectSeen.set(b.id, { time: Date.now(), ip: r.ip, agent: describeAgent(agent), mac })
  const base = requestBase(r)
  const xml = gigasetFile(store.config, b, { server: dectServer(base, b), sipHost: sipHostFor(base), now: Math.floor(Date.now() / 1000) })
  sendText(r.res, 200, xml, 'application/xml; charset=utf-8')
}

pub.get('/dect/:token', dectFile)
pub.get('/dect/:token/:file', dectFile)

// -- Tischtelefone (Yealink, Snom) holen ihre Einrichtung -----------------------------

const deskSeen = new Map<string, { time: number; ip: string; agent: string; mac: string }>()

function deskServer(base: string, d: DeskPhone): string {
  return `${base}/desk/${d.token}/`
}

/** Datei für das Telefon (oder null, wenn es sie nicht gibt) */
function deskContent(d: DeskPhone, base: string): string {
  const sipHost = sipHostFor(base)
  const opts = { sipHost, ldapHost: sipHost }
  return d.vendor === 'snom' ? snomFile(store.config, d, opts) : yealinkFile(store.config, d, opts)
}

function deskFile(r: Request): void {
  const d = store.config.deskphones.find((x) => x.token && x.token === r.params.token)
  if (!d) throw new HttpError(404, 'Unbekanntes Telefon.')
  const file = r.params.file ?? ''
  // Yealink fragt zuerst eine allgemeine Datei je Modell an: leer lassen, alles steht in der eigenen
  if (d.vendor === 'yealink' && isYealinkCommon(file)) return sendText(r.res, 200, '#!version:1.0.0.1\n', 'text/plain; charset=utf-8')
  const agent = String(r.raw.headers['user-agent'] ?? '')
  const mac = deskRequestMac(file) || agentMac(agent)
  if (mac && mac !== d.mac) throw new HttpError(404, 'Diese Einrichtung gehört zu einem anderen Telefon.')
  // Nur die eigene Datei; „<mac>-local.cfg“ (Änderungen am Telefon) und Ähnliches gibt es nicht
  // (.boot-Dateien, ältere Namen): ohne als Fehlversuch zu zählen, der Link ist ja gültig
  if (d.vendor === 'yealink' && file && !/^[0-9a-f]{12}\.cfg$/i.test(file)) return sendText(r.res, 404, 'Nicht gefunden.')
  deskSeen.set(d.id, { time: Date.now(), ip: r.ip, agent: describeDesk(agent), mac })
  const text = deskContent(d, requestBase(r))
  sendText(r.res, 200, text, d.vendor === 'snom' ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8')
}

pub.get('/desk/:token', deskFile)
pub.get('/desk/:token/:file', deskFile)

/** Zugriffsschlüssel der Schnittstelle prüfen (Bearer-Token statt Anmeldung) */
function integrationAuth(r: Request, need: 'call_api' | 'control' | '' = ''): void {
  if (!validToken(store.config, r.raw.headers.authorization)) {
    r.res.setHeader('WWW-Authenticate', 'Bearer')
    throw new HttpError(401, 'Zugriffsschlüssel fehlt oder ist falsch.')
  }
  if (need === 'call_api' && !store.config.integration.call_api) throw new HttpError(403, 'Anrufe über die Schnittstelle sind ausgeschaltet.')
  if (need === 'control' && !store.config.integration.control) throw new HttpError(403, 'Schalten über die Schnittstelle ist ausgeschaltet.')
}

function integrationExtension(raw: unknown): Extension {
  const ext = store.config.extensions.find((e) => e.number === String(raw ?? '').trim())
  if (!ext) throw new HttpError(404, 'Unbekannte Nebenstelle.')
  return ext
}

/** Zustandsbericht für Home Assistant u. a. */
pub.get('/api/integration/status', async (r) => {
  integrationAuth(r)
  return integrationReport(store.config, store.state, await asterisk.status(), readCalls(500), updater.info, SETTINGS.version, guard.bans.length, new Date(), {
    emergency: emergencies.calls,
    door: doorRings.calls,
    problems: offsiteStatus.ok ? [] : [{ key: 'backup', message: `Externe Sicherung fehlgeschlagen: ${offsiteStatus.error}` }],
  })
})

/** Anruf auslösen (CRM, Hausautomation): erst klingelt die Nebenstelle, nach dem Abheben wird gewählt */
pub.post('/api/integration/call', async (r) => {
  integrationAuth(r, 'call_api')
  const body = await r.json<{ extension: string; number: string }>()
  const ext = integrationExtension(body.extension)
  const number = cleanNumber(String(body.number ?? ''))
  if (!/^\+?\d{2,20}$/.test(number)) throw new HttpError(400, 'Ungültige Rufnummer.')
  const [res] = await asterisk.ami
    .action({
      Action: 'Originate',
      Channel: `Local/${ext.number}@p4a-originate`,
      Context: 'p4a-from-ext',
      Exten: number,
      Priority: '1',
      CallerID: `"${ext.name.replace(/["<>]/g, '')}" <${ext.number}>`,
      Variable: `P4A_EXT=${ext.number},_P4A_DIAL=${number}`,
      Timeout: '35000',
      Async: 'true',
    })
    .catch((e: Error) => {
      throw new HttpError(503, `Asterisk antwortet nicht: ${e.message}`)
    })
  if (res?.Response !== 'Success') throw new HttpError(500, res?.Message || 'Der Anruf konnte nicht gestartet werden.')
  return { ok: true }
})

/** Ansage aus Text: Telefone einer Nebenstelle oder Gruppe klingeln, nach dem Abheben spricht die Anlage den Text (zweimal) */
pub.post('/api/integration/announce', async (r) => {
  integrationAuth(r, 'call_api')
  const body = await r.json<{ target: string; text: string; voice?: string }>()
  const target = cleanNumber(String(body.target ?? ''))
  if (!ringPlan(store.config, store.state, target)) throw new HttpError(404, 'Unbekannte Nebenstelle oder Gruppe, oder niemand erreichbar.')
  const voice = String(body.voice ?? '') || tts.status().voices[0] || ''
  let wav: Buffer
  try {
    wav = toTelephoneWav(await tts.speak(String(body.text ?? ''), voice))
  } catch (e) {
    if (e instanceof TtsError) throw new HttpError(400, `${e.message} (Sprachausgabe unter Ansagen und Musik → Aus Text sprechen laden)`)
    throw e
  }
  const dir = path.join(PATHS.tts, 'announce')
  fs.mkdirSync(dir, { recursive: true })
  const base = path.join(dir, `${Date.now()}-${target}`)
  fs.writeFileSync(`${base}.wav`, wav)
  setTimeout(() => fs.rmSync(`${base}.wav`, { force: true }), 10 * 60000).unref()
  const [res] = await asterisk.ami
    .action({
      Action: 'Originate',
      Channel: `Local/${target}@p4a-ring`,
      Application: 'Playback',
      Data: `silence/1&${base}&silence/1&${base}`,
      CallerID: `"Durchsage" <${target}>`,
      Timeout: '35000',
      Async: 'true',
    })
    .catch((e: Error) => {
      throw new HttpError(503, `Asterisk antwortet nicht: ${e.message}`)
    })
  if (res?.Response !== 'Success') throw new HttpError(500, res?.Message || 'Die Ansage konnte nicht gestartet werden.')
  return { ok: true }
})

/** Nicht stören schalten */
pub.post('/api/integration/dnd', async (r) => {
  integrationAuth(r, 'control')
  const body = await r.json<{ extension: string; enabled: boolean }>()
  const ext = integrationExtension(body.extension)
  if (body.enabled) store.state.dnd[ext.number] = true
  else delete store.state.dnd[ext.number]
  store.saveState()
  return { ok: true, dnd: Boolean(store.state.dnd[ext.number]) }
})

/** Sofort-Umleitung setzen ('' = aus); nach außen wird wie in der App gemeldet */
pub.post('/api/integration/forward', async (r) => {
  integrationAuth(r, 'control')
  const body = await r.json<{ extension: string; target: string }>()
  const ext = integrationExtension(body.extension)
  const target = cleanNumber(String(body.target ?? ''))
  if (target === ext.number) throw new HttpError(400, 'Die Umleitung kann nicht auf die eigene Nebenstelle zeigen.')
  if (target) store.state.cfu[ext.number] = target
  else delete store.state.cfu[ext.number]
  store.saveState()
  forwardAlert(ext.number, target)
  return { ok: true, forward: target }
})

/** Zeitsteuerung umschalten: auto, open (immer geöffnet), closed (immer geschlossen) */
pub.post('/api/integration/timecondition', async (r) => {
  integrationAuth(r, 'control')
  const body = await r.json<{ id: string; mode: string }>()
  const mode = String(body.mode ?? '')
  if (!['auto', 'open', 'closed'].includes(mode)) throw new HttpError(400, 'Modus auto, open oder closed.')
  if (!store.config.timeconditions.some((t) => t.id === body.id)) throw new HttpError(404, 'Unbekannte Zeitsteuerung.')
  store.update((draft) => {
    draft.timeconditions.find((t) => t.id === body.id)!.override = mode as 'auto' | 'open' | 'closed'
  })
  return { ok: true }
})

// -- Verwaltung (angemeldet) ----------------------------------------------------------

/** Konfiguration für die Rolle: „Nur ansehen“ ohne Passwörter, „Personen und Anrufe“ ohne die des Systems */
function configFor(role: Role): PbxConfig {
  if (role === 'admin') return store.config
  const c = role === 'viewer' ? stripSecrets(store.config) : structuredClone(store.config)
  for (const t of c.trunks) t.password = ''
  for (const w of c.webhooks) w.secret = ''
  for (const s of c.contactsources) s.password = ''
  for (const k of c.calendars) k.source.password = ''
  Object.assign(c.mail, { password: '' })
  Object.assign(c.integration, { token: '' })
  Object.assign(c.offsite, { password: '', passphrase: '' })
  Object.assign(c.transcription, { api_key: '' })
  return c
}

api.get('/api/config', (r) => ({
  config: configFor(r.user?.role ?? 'viewer'),
  user: sessionUser(r.cookies[SESSION_COOKIE]),
  providers: PROVIDERS,
  states: BUNDESLAENDER,
  version: SETTINGS.version,
}))

api.put('/api/config/:section', async (r) => {
  const section = r.params.section as SectionName
  if (!SECTIONS.includes(section)) throw new HttpError(404, 'Unbekannter Bereich.')
  const values = await r.json<Record<string, unknown>>()
  store.update((draft) => {
    const merged = { ...draft[section], ...values } as Record<string, unknown>
    if (section === 'mail' && !values.password) merged.password = draft.mail.password
    // Den Zugriffsschlüssel vergibt nur der Server
    if (section === 'integration') merged.token = draft.integration.token
    ;(draft as unknown as Record<string, unknown>)[section] = merged
  })
  applySoon()
  return configFor(r.user?.role ?? 'viewer')[section]
})

for (const kind of COLLECTIONS) {
  api.post(`/api/${kind}`, async (r) => {
    const item = await r.json<Record<string, unknown>>()
    const saved = store.upsert(kind as CollectionName, item)
    applySoon()
    // Geänderte Quelle gleich neu lesen
    if (kind === 'contactsources' || kind === 'calendars') void sources.syncNow(String(saved.id))
    return saved
  })
  api.delete(`/api/${kind}/:id`, (r) => {
    store.remove(kind as CollectionName, r.params.id)
    if (kind === 'calendars') calendars.cleanup()
    if (kind === 'contactsources' || kind === 'calendars') sources.cleanup()
    applySoon()
    return { ok: true }
  })
}

api.post('/api/extensions/:id/renew', (r) => {
  const what = r.query.get('what')
  store.update((draft) => {
    const ext = draft.extensions.find((e) => e.id === r.params.id)
    if (!ext) throw new HttpError(404, 'Nebenstelle nicht gefunden.')
    if (what === 'secret') ext.secret = newSecret()
    else if (what === 'pin') renewPin(ext)
    else if (what === 'devices') ext.devices = []
    else {
      // Neuer Einladungslink; eingerichtete Geräte bleiben angemeldet
      renewLink(ext)
      renewPin(ext)
    }
    fillSecrets(ext)
  })
  applySoon()
  return store.config.extensions.find((e) => e.id === r.params.id)
})

/** Eine eingerichtete App abmelden (verlorenes Handy, alter Rechner) */
api.delete('/api/extensions/:id/devices/:device', (r) => {
  store.update((draft) => {
    const ext = draft.extensions.find((e) => e.id === r.params.id)
    if (!ext) throw new HttpError(404, 'Nebenstelle nicht gefunden.')
    const before = ext.devices.length
    ext.devices = ext.devices.filter((d) => d.id !== r.params.device)
    if (ext.devices.length === before) throw new HttpError(404, 'Gerät nicht gefunden.')
  })
  applySoon()
  return store.config.extensions.find((e) => e.id === r.params.id)
})

api.get('/api/extensions/:id/provisioning', (r) => {
  const ext = store.config.extensions.find((e) => e.id === r.params.id)
  if (!ext) throw new HttpError(404, 'Nebenstelle nicht gefunden.')
  const base = linkBase(store.config, requestBase(r))
  return {
    base,
    setup: `${base}/setup/${ext.provision_token}`,
    app: appLink(base, ext),
    pin: ext.provision_pin,
    pin_expires: pinValid(ext) ? ext.provision_pin_expires : 0,
    link_expires: linkValid(ext) ? ext.provision_expires : 0,
    devices: ext.devices.map(({ id, name, created, seen, ip }) => ({ id, name, created, seen, ip })),
  }
})

api.post('/api/extensions/:id/invite', async (r) => {
  let ext = store.config.extensions.find((e) => e.id === r.params.id)
  if (!ext) throw new HttpError(404, 'Nebenstelle nicht gefunden.')
  if (!ext.email) throw new HttpError(400, 'Für diese Nebenstelle ist keine E-Mail-Adresse eingetragen.')
  // Abgelaufener Link oder benutzte PIN: für die Einladung neu erzeugen
  if (!pinValid(ext) || !linkValid(ext)) {
    store.update((draft) => {
      const e = draft.extensions.find((x) => x.id === r.params.id)!
      if (!pinValid(e)) renewPin(e)
      if (!linkValid(e)) renewLink(e)
    })
    ext = store.config.extensions.find((e) => e.id === r.params.id)!
  }
  const base = linkBase(store.config, requestBase(r))
  await sendMail(
    store.config.mail,
    ext.email,
    `Ihr Telefon an der Anlage ${store.config.system.name}`,
    [
      `Hallo ${ext.name},`,
      '',
      `Ihre Nebenstelle ${ext.number} an der Telefonanlage ${store.config.system.name} ist eingerichtet.`,
      '',
      'Mit der App Phone4All öffnen Sie einfach diesen Link – die App richtet sich selbst ein:',
      `${base}/setup/${ext.provision_token}`,
      `(gilt bis ${new Date(ext.provision_expires).toLocaleString('de-DE')}; jedes Gerät erhält dabei einen eigenen Zugang)`,
      '',
      'Oder in der App unter Einstellungen → Konto → „Von Telefonanlage einrichten“:',
      `  Anlage:          ${base}`,
      `  Nebenstelle:     ${ext.number}`,
      `  Einrichtungs-PIN: ${ext.provision_pin} (gilt einmal, bis ${new Date(ext.provision_pin_expires).toLocaleString('de-DE')}, nur im Netz der Anlage)`,
      '',
      'Funktionen am Telefon: *97 Voicemail, *76 Nicht stören, *21<Nummer> Weiterleitung (*21 aus), *8 Heranholen.',
    ].join('\n'),
  )
  return { ok: true }
})

// DECT-Basen und LDAP-Telefonbuch

api.get('/api/dect', (r) => {
  const base = lanBase(r)
  return {
    ldap: ldap.status,
    host: new URL(base).hostname,
    bases: store.config.dect.map((b) => ({ id: b.id, url: dectServer(base, b), seen: dectSeen.get(b.id) ?? null })),
  }
})

api.get('/api/dect/:id/file', (r) => {
  const b = store.config.dect.find((x) => x.id === r.params.id)
  if (!b) throw new HttpError(404, 'DECT-Basis nicht gefunden.')
  const base = lanBase(r)
  const xml = gigasetFile(store.config, b, { server: dectServer(base, b), sipHost: sipHostFor(base), now: Math.floor(Date.now() / 1000) })
  r.res.writeHead(200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Content-Disposition': `attachment; filename="${b.mac || 'gigaset'}.xml"`,
  })
  r.res.end(xml)
})

api.post('/api/dect/:id/renew', (r) => {
  store.update((draft) => {
    const b = draft.dect.find((x) => x.id === r.params.id)
    if (!b) throw new HttpError(404, 'DECT-Basis nicht gefunden.')
    b.token = newSecret(32)
    b.pin = newPin(4)
  })
  dectSeen.delete(r.params.id)
  return store.config.dect.find((x) => x.id === r.params.id)
})

// Tischtelefone

api.get('/api/deskphones', (r) => {
  const base = lanBase(r)
  return {
    host: new URL(base).hostname,
    phones: store.config.deskphones.map((d) => ({ id: d.id, url: deskServer(base, d), seen: deskSeen.get(d.id) ?? null })),
  }
})

api.get('/api/deskphones/:id/file', (r) => {
  const d = store.config.deskphones.find((x) => x.id === r.params.id)
  if (!d) throw new HttpError(404, 'Telefon nicht gefunden.')
  r.res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': `attachment; filename="${d.mac}.${d.vendor === 'snom' ? 'xml' : 'cfg'}"`,
  })
  r.res.end(deskContent(d, lanBase(r)))
})

api.post('/api/deskphones/:id/renew', (r) => {
  store.update((draft) => {
    const d = draft.deskphones.find((x) => x.id === r.params.id)
    if (!d) throw new HttpError(404, 'Telefon nicht gefunden.')
    d.token = newSecret(32)
  })
  deskSeen.delete(r.params.id)
  return store.config.deskphones.find((x) => x.id === r.params.id)
})

// Messenger (nur Überblick; Inhalte der Chats zeigt die Verwaltung nicht)

api.get('/api/messenger', () => {
  const names = new Map(store.config.extensions.map((e) => [e.number, e.name]))
  return {
    online: messenger.online(),
    connections: messenger.connections,
    calls: messenger.activeCalls,
    usage: messenger.store.usage(),
    free: freeBytes(),
    users: messengerUsers(store.config).length,
    rooms: [...messenger.store.rooms.values()].map((r) => {
      const last = messenger.store.messages(r.id).at(-1)
      return {
        id: r.id,
        kind: r.kind,
        name: r.kind === 'group' ? r.name : r.members.map((m) => names.get(m) || m).join(' und '),
        members: r.members,
        messages: messenger.store.messages(r.id).length,
        last: last?.time ?? r.created,
      }
    }),
  }
})

api.delete('/api/messenger/rooms/:id', (r) => {
  if (!messenger.store.rooms.has(r.params.id)) throw new HttpError(404, 'Unterhaltung nicht gefunden.')
  const members = messenger.store.rooms.get(r.params.id)!.members
  messenger.store.removeRoom(r.params.id)
  messenger.removed(r.params.id, members)
  return { ok: true }
})

// Zentrale Kalender

api.get('/api/calendars/:id/events', (r) => {
  const [start, end] = range(r)
  return calendars.events(r.params.id, start, end)
})
api.post('/api/calendars/:id/events', async (r) => {
  const ev = await r.json<{ uid?: string }>()
  return calendars.upsert(r.params.id, ev, ev.uid)
})
api.delete('/api/calendars/:id/events/:uid', (r) => {
  calendars.remove(r.params.id, r.params.uid)
  return { ok: true }
})

api.get('/api/status', async () => ({
  ...(await asterisk.status()),
  dnd: store.state.dnd,
  cfu: store.state.cfu,
  away: store.state.away,
  bans: guard.bans,
  update: updater.info,
  version: SETTINGS.version,
  remote: { enabled: store.config.remote.enabled, turn: turn.state, connections: ws.count },
  proxy_hints: [...proxyHints].map(([ip, time]) => ({ ip, time })),
  watchdog: watchdog.status(),
}))

/** Stand der externen Kontakt- und Kalenderquellen */
api.get('/api/sources', () => sources.status)
api.post('/api/sources/:id/sync', (r) => sources.syncNow(r.params.id))

api.get('/api/watchdog', () => ({ ...watchdog.status(), events: [...watchdog.events].reverse() }))
api.post('/api/watchdog/check', async () => {
  await watchdog.tick()
  return { ...watchdog.status(), events: [...watchdog.events].reverse() }
})
api.delete('/api/watchdog/events', () => {
  watchdog.events = []
  saveJson(PATHS.watchdog, [], 0o644)
  return { ok: true }
})

api.put('/api/state/:ext', async (r) => {
  const { dnd, cfu } = await r.json<{ dnd?: unknown; cfu?: unknown }>()
  const n = r.params.ext
  if ((dnd !== undefined && typeof dnd !== 'boolean') || (cfu !== undefined && typeof cfu !== 'string')) {
    throw new HttpError(400, 'dnd muss true/false, cfu eine Rufnummer sein.')
  }
  if (!store.config.extensions.some((e) => e.number === n)) throw new HttpError(404, 'Nebenstelle nicht gefunden.')
  if (dnd !== undefined) {
    if (dnd) store.state.dnd[n] = true
    else delete store.state.dnd[n]
  }
  if (cfu !== undefined) {
    if (cfu.trim()) store.state.cfu[n] = cfu.trim()
    else delete store.state.cfu[n]
  }
  store.saveState()
  return { dnd: store.state.dnd, cfu: store.state.cfu }
})

api.post('/api/integration/token', () => {
  store.update((draft) => {
    draft.integration.token = newSecret(40)
  })
  return store.config.integration
})

api.post('/api/unban', async (r) => {
  const { ip } = await r.json<{ ip: string }>()
  guard.unban(ip)
  return { ok: true }
})

api.get('/api/calls', (r) => readCalls(Number(r.query.get('limit')) || 200))

/** Zeitraum für Auswertungen: from/to als Datum (to einschließlich), höchstens ein Jahr */
function statsRange(r: Request): [number, number] {
  const day = (v: string | null): number => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`).getTime() : NaN)
  const from = day(r.query.get('from'))
  const to = day(r.query.get('to')) + 86400000
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from || to - from > 367 * 86400000) {
    throw new HttpError(400, 'Zeitraum fehlt oder ist zu groß (from/to als JJJJ-MM-TT, höchstens ein Jahr).')
  }
  return [from, to]
}

api.get('/api/stats', (r) => {
  const [from, to] = statsRange(r)
  return computeStats(store.config, readAllCalls(), parseQueueLog(readQueueLog()), from, to)
})

api.get('/api/stats/csv', (r) => {
  const [from, to] = statsRange(r)
  r.res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="anrufe-${r.query.get('from')}-bis-${r.query.get('to')}.csv"`,
  })
  // BOM, damit Excel die Umlaute erkennt
  r.res.end('\ufeff' + callsCsv(readAllCalls(), from, to))
})

api.get('/api/faxes', () => faxes.list())
api.get('/api/faxes/:id/pdf', (r) => {
  const rec = faxes.get(r.params.id)
  if (!rec) throw new HttpError(404, 'Fax nicht gefunden.')
  sendFile(r.res, faxes.pdf(rec.id), `Fax-${rec.number || 'unbekannt'}-${new Date(rec.time).toISOString().slice(0, 10)}.pdf`)
})
api.delete('/api/faxes/:id', (r) => {
  const rec = faxes.get(r.params.id)
  if (rec?.status === 'sending') throw new HttpError(409, 'Das Fax wird gerade gesendet.')
  faxes.remove(r.params.id)
  return faxes.list()
})
api.post('/api/faxes/send', async (r) => sendFax(r.query.get('box') ?? '', r.query.get('number') ?? '', await r.body(), 'Verwaltung'))

api.get('/api/missed', () => missedView())
api.put('/api/missed/:group/:id', async (r) => {
  const { action } = await r.json<{ action: MissedAction }>()
  if (!MISSED_ACTIONS.includes(action)) throw new HttpError(400, 'Unbekannte Aktion.')
  if (!missed.act(store.config, r.params.id, r.params.group, action, 'Verwaltung')) throw new HttpError(404, 'Eintrag nicht gefunden.')
  return missedView()
})

/** Mitglied einer Gruppe an- oder abmelden (Verwaltung) */
api.put('/api/groups/:id/members/:ext', async (r) => {
  const { active } = await r.json<{ active: boolean }>()
  if (!setAway(store.config, store.state, r.params.ext, r.params.id, !active)) throw new HttpError(404, 'Kein Mitglied dieser Gruppe.')
  store.saveState()
  return { away: store.state.away }
})

function recording(name: string): string {
  const file = recordingFile(name)
  if (!file) throw new HttpError(400, 'Ungültiger Name.')
  if (!fs.existsSync(file)) throw new HttpError(404, 'Aufnahme nicht gefunden.')
  return file
}

api.get('/api/recordings/:name', (r) => sendFile(r.res, recording(r.params.name), r.query.has('download') ? r.params.name : undefined))
api.delete('/api/recordings/:name', (r) => {
  fs.rmSync(recording(r.params.name))
  return { ok: true }
})

/** Belegung je Bereich und alle Aufnahmen (System → Speicher) */
api.get('/api/storage', () => storageReport(freeBytes()))
api.post('/api/storage/cleanup', () => {
  const result = expire(store.config.storage)
  messengerCleanup()
  return { ...result, report: storageReport(freeBytes()) }
})

api.get('/api/log', () => tailLog())

api.post('/api/asterisk/restart', async () => {
  await asterisk.restart()
  return { ok: true }
})

api.post('/api/password', async (r) => {
  const { old, password } = await r.json<{ old: string; password: string }>()
  const login = r.user?.login ?? 'admin'
  const okOld = login === 'admin' ? auth.check(old ?? '') : Boolean(users.check(login, old ?? ''))
  if (!okOld) throw new HttpError(403, 'Das bisherige Passwort stimmt nicht.')
  if (!password || password.length < PASSWORD_MIN) throw new HttpError(400, `Das neue Passwort braucht mindestens ${PASSWORD_MIN} Zeichen.`)
  if (login === 'admin') auth.setPassword(password)
  else {
    users.update(users.find(login)!.id, { password })
    auth.logoutUser(login)
  }
  const token = auth.login(login)
  r.res.setHeader('Set-Cookie', sessionCookie(r, token, SESSION_MAX_AGE))
  return { ok: true }
})

api.post('/api/mail/test', async (r) => {
  const { to } = await r.json<{ to: string }>()
  await sendMail(store.config.mail, to, `Test von ${store.config.system.name}`, 'Der E-Mail-Versand der Telefonanlage funktioniert.')
  return { ok: true }
})

// Weitere Zugänge zur Weboberfläche (nur Verwaltung)

api.get('/api/users', () => ({ users: users.list(), roles: ROLES }))
api.post('/api/users', async (r) => {
  const b = await r.json<{ login: string; name: string; role: Role; password: string }>()
  try {
    return users.add(String(b.login ?? ''), String(b.name ?? ''), b.role, String(b.password ?? ''))
  } catch (e) {
    if (e instanceof UserError) throw new HttpError(400, e.message)
    throw e
  }
})
api.put('/api/users/:id', async (r) => {
  const b = await r.json<{ login?: string; name?: string; role?: Role; password?: string }>()
  const before = users.get(r.params.id)
  try {
    const u = users.update(r.params.id, b)
    // Neues Passwort, andere Rolle oder anderer Name: neu anmelden
    if (before && (b.password || b.role !== before.role || u.login !== before.login)) auth.logoutUser(before.login)
    return u
  } catch (e) {
    if (e instanceof UserError) throw new HttpError(400, e.message)
    throw e
  }
})
api.delete('/api/users/:id', (r) => {
  const u = users.get(r.params.id)
  if (u) auth.logoutUser(u.login)
  users.remove(r.params.id)
  return { ok: true }
})

// Sicherung, Export, Import

api.get('/api/export', (r) => {
  // Mit Passwörtern nur verschlüsselt (POST mit Passwort)
  if (r.query.get('secrets') === '1') throw new HttpError(400, 'Export mit Passwörtern nur verschlüsselt: bitte ein Passwort angeben.')
  const data = store.exportData(false, r.query.get('files') === '1', SETTINGS.version)
  const date = new Date().toISOString().slice(0, 10)
  r.res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="phone4all-pbx-${date}.json"`,
  })
  r.res.end(JSON.stringify(data, null, 2))
})

/** Export mit allen Passwörtern, mit einem eigenen Passwort verschlüsselt */
api.post('/api/export', async (r) => {
  const { files, password } = await r.json<{ files?: boolean; password?: string }>()
  return encryptExport(store.exportData(true, Boolean(files), SETTINGS.version), String(password ?? ''))
})

api.post('/api/import', async (r) => {
  const raw = await r.json<(ExportFile | EncryptedExport) & { password?: string }>()
  const data = raw.format === 'phone4all-pbx-encrypted' ? decryptExport(raw, String(raw.password ?? '')) : (raw as ExportFile)
  store.importData(data)
  calendars.revision++
  applySoon()
  return { ok: true }
})

api.get('/api/audit', () => audit.list())

api.get('/api/backups', () => store.backups())
api.post('/api/backups', () => ({ name: store.backup('manuell') }))
api.post('/api/backups/:name/restore', (r) => {
  store.restoreBackup(r.params.name)
  calendars.revision++
  applySoon()
  return { ok: true }
})
api.get('/api/backups/:name', (r) => {
  const name = r.params.name
  if (!/^[\w.-]+\.json$/.test(name)) throw new HttpError(400, 'Ungültiger Name.')
  sendFile(r.res, path.join(PATHS.backups, name), name)
})

// Externe Sicherung (WebDAV, S3)

async function runOffsite(): Promise<OffsiteStatus> {
  const s = store.config.offsite
  if (!s.enabled) throw new HttpError(400, 'Die externe Sicherung ist ausgeschaltet.')
  const json = JSON.stringify(store.exportData(true, false, SETTINGS.version))
  try {
    const file = await offsiteUpload(s, json)
    if (!offsiteStatus.ok) watchdog.log('ok', 'backup', `Externe Sicherung wieder erfolgreich (${file})`)
    offsiteStatus = { time: Date.now(), ok: true, file, error: '' }
  } catch (e) {
    const error = (e as Error).message
    if (offsiteStatus.ok) watchdog.log('error', 'backup', `Externe Sicherung fehlgeschlagen: ${error}`)
    offsiteStatus = { time: Date.now(), ok: false, file: '', error }
  }
  return offsiteStatus
}

api.get('/api/offsite', () => offsiteStatus)
api.post('/api/offsite/run', () => runOffsite())
api.get('/api/offsite/files', async () => {
  if (!store.config.offsite.enabled) return []
  try {
    return await offsiteTarget(store.config.offsite).list()
  } catch (e) {
    throw new HttpError(502, (e as Error).message)
  }
})
api.post('/api/offsite/restore', async (r) => {
  const { name } = await r.json<{ name: string }>()
  let data: ExportFile
  try {
    data = JSON.parse(await offsiteDownload(store.config.offsite, String(name ?? ''))) as ExportFile
  } catch (e) {
    if (e instanceof OffsiteError) throw new HttpError(400, e.message)
    throw new HttpError(502, (e as Error).message)
  }
  store.importData(data)
  calendars.revision++
  applySoon()
  return { ok: true }
})

// Webhooks

api.get('/api/webhooks/status', () => ({ events: WEBHOOK_EVENTS, status: Object.fromEntries(webhooks.status) }))
api.post('/api/webhooks/:id/test', async (r) => {
  const w = store.config.webhooks.find((x) => x.id === r.params.id)
  if (!w) throw new HttpError(404, 'Webhook nicht gefunden.')
  const body = JSON.stringify({ event: 'test', time: new Date().toISOString(), data: {}, pbx: store.config.system.name })
  await webhooks.deliver(w, 'test', body)
  return webhooks.status.get(w.id)
})

// Ansagen aus Text (Piper)

api.get('/api/transcription', () => ({ ...transcriber.status(), all: WHISPER_MODELS }))
api.post('/api/transcription/install', async (r) => {
  const { model } = await r.json<{ model: string }>()
  if (!WHISPER_MODELS.some((m) => m.id === model)) throw new HttpError(400, 'Unbekanntes Modell.')
  transcriber.install(String(model)).catch((e: Error) => console.error('Spracherkennung laden:', e.message))
  return transcriber.status()
})
/** Probe: kurzer Satz über die Sprachausgabe gesprochen und wieder erkannt (oder hochgeladene WAV) */
api.post('/api/transcription/test', async (r) => {
  // Ungespeicherte Einstellungen aus dem Formular; ohne Schlüssel gilt der gespeicherte
  const draft = await r.json<Partial<TranscriptionSettings>>().catch(() => ({}))
  const cfg: TranscriptionSettings = { ...store.config.transcription, ...draft }
  cfg.api_key ||= store.config.transcription.api_key
  cfg.api_url = cfg.api_url.trim().replace(/\/+$/, '')
  const voice = tts.status().voices[0]
  if (!voice) throw new HttpError(400, 'Für die Probe wird die Sprachausgabe gebraucht (Ansagen und Musik → Aus Text sprechen).')
  const file = path.join(os.tmpdir(), `p4a-stt-${Date.now()}.wav`)
  fs.writeFileSync(file, await tts.speak('Hallo, hier ist die Telefonanlage. Bitte rufen Sie mich morgen zurück.', voice))
  try {
    return { text: await transcriber.transcribe(cfg, file) }
  } catch (e) {
    if (e instanceof TranscribeError) throw new HttpError(400, e.message)
    throw e
  } finally {
    fs.rmSync(file, { force: true })
  }
})
api.get('/api/tts', () => ({ ...tts.status(), all: VOICES.map(({ id, name }) => ({ id, name })) }))
api.post('/api/tts/install', async (r) => {
  const { voice } = await r.json<{ voice: string }>()
  // Läuft im Hintergrund (Programm und Stimme sind zusammen etwa 90 MB)
  tts.install(String(voice ?? '')).catch((e: Error) => console.error('Sprachausgabe laden:', e.message))
  return tts.status()
})
api.post('/api/tts/speak', async (r) => {
  const { text, voice } = await r.json<{ text: string; voice: string }>()
  try {
    const wav = await tts.speak(String(text ?? ''), String(voice ?? ''))
    r.res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'no-store' })
    r.res.end(wav)
  } catch (e) {
    if (e instanceof TtsError) throw new HttpError(400, e.message)
    throw e
  }
})

// Ansagen und Wartemusik

api.get('/api/sounds', () => ({ custom: listSounds('custom'), moh: listSounds('moh') }))
api.post('/api/sounds/:kind', async (r) => {
  const kind = r.params.kind as SoundKind
  soundDir(kind)
  const name = saveSound(kind, r.query.get('name') ?? 'ansage', await r.body())
  if (kind === 'moh') applySoon()
  return { name }
})
api.get('/api/sounds/:kind/:name', (r) => sendFile(r.res, soundFile(r.params.kind, r.params.name)))
api.delete('/api/sounds/:kind/:name', (r) => {
  const file = soundFile(r.params.kind, r.params.name)
  const base = r.params.name.replace(/\.\w+$/, '')
  if (r.params.kind === 'custom' && store.config.announcements.some((a) => a.file === base)) {
    throw new HttpError(409, 'Die Datei wird noch von einer Ansage verwendet.')
  }
  fs.rmSync(file)
  return { ok: true }
})

// Aktualisierung

api.get('/api/updates', async (r) => (r.query.has('check') ? updater.check(store.config.updates.channel) : updater.info))
api.post('/api/updates/apply', async () => {
  store.backup('vor-update')
  await updater.apply(store.config.updates.channel)
  return { ok: true }
})

// -- Server ---------------------------------------------------------------------------

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1'
}

/** Pfade mit geheimem Token im zweiten Teil */
const SECRET_PATH = /^\/(?:provision|setup|dect|desk)\/([^/]+)/

async function handle(raw: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const isUpload = raw.url?.startsWith('/api/sounds') || raw.url?.startsWith('/api/import') || raw.url?.startsWith('/api/faxes/send') || FAX_UPLOAD.test((raw.url ?? '').split('?')[0])
  const isChatFile = CHAT_UPLOAD.test((raw.url ?? '').split('?')[0])
  const limit = isChatFile ? store.config.messenger.max_file_mb * 1024 * 1024 : isUpload ? 64 * 1024 * 1024 : 1024 * 1024
  const req = makeRequest(raw, res, limit)
  try {
    if (req.path.startsWith('/internal/')) {
      const m = internal.match(req.method, req.path)
      // Nur echte Verbindungen von 127.0.0.1 – Kopfzeilen wie X-Forwarded-For zählen hier nicht
      if (!isLoopback(socketIp(raw)) || !m) throw new HttpError(404, '')
      req.params = m.params
      sendText(res, 200, String(await m.handler(req)))
      return
    }
    const p = pub.match(req.method, req.path)
    if (p) {
      // Geheime Links (App, Einladung, DECT): Raten bremsen und sperren
      if (SECRET_PATH.test(req.path) && isBlocked(req.ip)) throw new HttpError(429, TOO_MANY)
      req.params = p.params
      const result = await p.handler(req)
      if (!res.headersSent) sendJson(res, 200, result)
      return
    }
    if (req.path.startsWith('/api/')) {
      const user = sessionUser(req.cookies[SESSION_COOKIE])
      if (!user) throw new HttpError(401, 'Bitte anmelden.')
      req.user = { login: user.login, role: user.role }
      const denied = forbidden(user.role, req.method, req.path)
      if (denied) throw new HttpError(403, denied)
      // Schutz vor fremden Formularen: Änderungen nur mit eigenem Kopfeintrag
      if (req.method !== 'GET' && raw.headers['x-phone4all'] !== '1') throw new HttpError(403, 'Anfrage abgelehnt.')
      const m = api.match(req.method, req.path)
      if (!m) throw new HttpError(404, 'Nicht gefunden.')
      req.params = m.params
      const result = await m.handler(req)
      if (req.method !== 'GET') audit.add(req.ip, auditText(req.method, req.path, result), Date.now(), user.login)
      if (!res.headersSent) {
        if (typeof result === 'string') sendText(res, 200, result)
        else sendJson(res, 200, result ?? { ok: true })
      }
      return
    }
    if (req.method !== 'GET') throw new HttpError(405, 'Nicht erlaubt.')
    serveStatic(PATHS.web, req.path, res)
  } catch (e) {
    const status = e instanceof HttpError ? e.status : e instanceof ValidationError ? 400 : 500
    // Unbekannter Link: jeder andere zählt als Fehlversuch, derselbe nur einmal
    const secret = SECRET_PATH.exec(req.path)
    if (status === 404 && secret) auth.failed(req.ip, 'Ungültige Einrichtungslinks', secret[1])
    if (status === 500) console.error(e)
    if (!res.headersSent) sendJson(res, status, { error: (e as Error).message || 'Fehler' })
    else res.end()
  }
}

async function main(): Promise<void> {
  console.log(`Phone4all PBX ${SETTINGS.version}`)
  asterisk.prepareDirs()
  await asterisk.apply(store.config, guard.banned())
  ldap.apply()
  transcriptionChanged()
  scanVoicemail()
  setInterval(() => scanVoicemail(), 5 * 60000).unref()
  const server = http.createServer((req, res) => void handle(req, res))
  // /ws: SIP über WebSocket (Mobil-App) · /provision/<token>/chat: Messenger der Apps
  const onUpgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer): void => {
    const m = /^\/provision\/([^/?]+)\/chat\/?(\?.*)?$/.exec(req.url ?? '')
    if (!m) return ws.upgrade(req, socket, head)
    const ip = clientIp(req)
    if (isBlocked(ip)) return reject(socket, 429, 'Too Many Requests')
    const found = findDevice(store.config, decodeURIComponent(m[1]))
    if (!found) {
      auth.failed(ip, 'Ungültige Einrichtungslinks', m[1])
      return reject(socket, 404, 'Not Found')
    }
    const { ext, device } = found
    if (!messengerUsers(store.config).some((e) => e.id === ext.id)) return reject(socket, 403, 'Forbidden')
    const conn = upgrade(req, socket)
    if (!conn) return reject(socket, 400, 'Bad Request')
    messenger.attach(ext.number, device.token, conn)
  }
  server.on('upgrade', onUpgrade)
  server.listen(SETTINGS.httpPort, () => console.log(`Weboberfläche auf Port ${SETTINGS.httpPort}`))
  // Dieselbe Oberfläche verschlüsselt, damit das Passwort im LAN nicht im Klartext läuft
  if (SETTINGS.httpsPort && asterisk.tls) {
    try {
      const secure = https.createServer(
        { cert: fs.readFileSync(asterisk.tls.cert), key: fs.readFileSync(asterisk.tls.key) },
        (req, res) => void handle(req, res),
      )
      secure.on('upgrade', onUpgrade)
      secure.on('error', (e) => console.error(`HTTPS auf Port ${SETTINGS.httpsPort} nicht verfügbar:`, e.message))
      secure.listen(SETTINGS.httpsPort, () => console.log(`Weboberfläche (HTTPS) auf Port ${SETTINGS.httpsPort}`))
    } catch (e) {
      console.error('HTTPS nicht verfügbar:', (e as Error).message)
    }
  }
  startDiscovery(() => store.config)
  asterisk.start()
  watchdog.log('info', 'asterisk', `Verwaltungsdienst gestartet (Version ${SETTINGS.version})`)
  if (store.recovered) watchdog.log('error', 'disk', store.recovered)
  watchdog.start()
  setTimeout(() => void watchdog.tick(), 15000).unref()
  sources.start()
  void updater.collect().then(() => {
    const last = updater.info.last
    if (last && Date.now() - last.time < 3600000) watchdog.log(last.ok ? 'info' : 'error', 'asterisk', last.text)
  })

  // Tägliche Sicherung, stündliche Update-Prüfung, automatisches Update im Zeitfenster
  let lastBackup = ''
  let lastAutoUpdate = ''
  const tick = async (): Promise<void> => {
    // Tag und Stunde in der Zeitzone der Anlage (der Container läuft meist in UTC)
    const local = localTime(new Date(), store.config.system.timezone)
    const today = local.date
    auth.prune()
    portal.prune()
    faxes.prune()
    if (lastBackup !== today) {
      lastBackup = today
      store.backup('taeglich')
      if (store.config.offsite.enabled) await runOffsite()
    }
    const expired = expire(store.config.storage)
    if (expired.recordings || expired.voicemail) {
      watchdog.log('info', 'disk', `Aufbewahrungsfrist: ${expired.recordings} Aufnahmen und ${expired.voicemail} Voicemails gelöscht`)
    }
    messengerCleanup()
    const u = store.config.updates
    const info = await updater.check(u.channel)
    if (u.auto && info.available && info.canApply && Math.floor(local.minutes / 60) === u.hour && lastAutoUpdate !== today) {
      if ((await asterisk.activeCalls()) === 0) {
        lastAutoUpdate = today
        store.backup('vor-update')
        await updater.apply(u.channel).catch((e) => console.error('Automatisches Update:', e))
      }
    }
  }
  setTimeout(() => void tick().catch(() => undefined), 10000)
  setInterval(() => void tick().catch(() => undefined), 3600000)
  // Der TURN-Server erlaubt nur die eigenen Adressen als Ziel – nach einem Adresswechsel
  // (DHCP, neues VLAN) die Konfiguration nachziehen, nicht erst bei der nächsten Änderung
  setInterval(() => turn.apply(store.config), 5 * 60000).unref()

  const shutdown = async (): Promise<void> => {
    watchdog.stop()
    saveJson(PATHS.watchdog, watchdog.events, 0o644)
    messenger.close()
    server.close()
    turn.stop()
    ldap.stop()
    await asterisk.stop()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

// Ein einzelner Fehler soll nicht die ganze Anlage (und laufende Gespräche) beenden
for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(event, (e: unknown) => {
    const text = e instanceof Error ? e.stack || e.message : String(e)
    console.error(`Unbehandelter Fehler: ${text}`)
    try {
      watchdog.log('error', 'asterisk', `Unbehandelter Fehler im Verwaltungsdienst: ${e instanceof Error ? e.message : String(e)}`)
    } catch {
      // Protokoll nicht verfügbar
    }
  })
}

void main()
