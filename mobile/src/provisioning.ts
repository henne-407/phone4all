/**
 * Einrichtung durch die Phone4all-Telefonanlage: Profil mit Konto, Kontakten, Kalendern
 * und dem Zugang für unterwegs (SIP über WebSocket, WebRTC) holen und aktuell halten.
 * Schnittstelle siehe pbx/README.md („Schnittstelle für die App“).
 */

export type AppPage = 'home' | 'dial' | 'contacts' | 'calendar' | 'history'
export type AppHomeCard = 'status' | 'today' | 'favorites' | 'recent' | 'events' | 'team'

export interface AppPolicy {
  pages: AppPage[]
  start_tab: AppPage
  home_cards: AppHomeCard[]
  lock_layout: boolean
  lock_account: boolean
}

export interface IceServer {
  urls: string[]
  username?: string
  credential?: string
}

export interface RemoteAccount {
  websocket: string
  user: string
  domain: string
  ice_servers: IceServer[]
}

export interface PhonebookEntry {
  name: string
  company: string
  phone: string
  mobile: string
}

export interface Profile {
  format: 'phone4all-provisioning'
  version: number
  pbx: { name: string; version: string }
  extension: string
  account: { display_name: string; user: string; domain: string }
  password: string
  url: string
  phonebook: PhonebookEntry[]
  features: Record<string, string>
  app: AppPolicy | null
  calendars: { id: string; name: string; color: string; writable: boolean }[]
  remote: RemoteAccount | null
  revision: string
  /** Rechte in der App (ältere Anlagen: fehlt) */
  permissions?: string[]
  /** Parken: Weiterleiten an number parkt (null = aus) */
  parking?: { number: string; slots: string[] } | null
  /** Anrufer im CRM öffnen: Adresse mit {nummer}, {e164}, {name} */
  crm?: { url: string; auto: boolean } | null
  /** Voicemail der Nebenstelle in der App */
  voicemail?: boolean
  /** Türsprechstellen: im Gespräch öffnet dtmf die Tür */
  doors?: { number: string; name: string; dtmf: string }[]
}

export interface TeamMember {
  number: string
  name: string
  state: 'idle' | 'ringing' | 'busy' | 'offline'
  dnd: boolean
  /** Umleitung: interne Nummer oder „extern“ */
  forward: string
  /** Status aus dem Kalender („Urlaub bis Fr“) */
  note?: string
}

export interface PbxGroup {
  id: string
  number: string
  name: string
  /** angemeldet (klingelt mit) */
  active: boolean
}

export interface GroupMissed {
  id: string
  group: string
  group_name: string
  time: number
  number: string
  name: string
  claimed_by: string
  done_by: string
  done_how: '' | 'callback' | 'answered' | 'manual'
}

export interface ForwardInfo {
  cfu: string
  active: string
  permissions: string[]
  mobile?: { enabled: boolean; number: string } | null
}

export interface ParkedCall {
  slot: string
  number: string
  name: string
  by: string
  since: number
  until: number
}

export interface Presence {
  revision: string
  extensions: TeamMember[]
  parked: ParkedCall[]
  voicemail: { revision: string; unread: number } | null
  /** Eigene Gruppen (ältere Anlagen: fehlt) */
  groups?: PbxGroup[]
  /** Verpasste Gruppenanrufe (null = keine Gruppe mit gemeinsamer Liste) */
  missed?: { open: number; revision: string } | null
  /** Chef und Sekretariat, an denen die Nebenstelle beteiligt ist */
  boss?: BossPair[]
  /** Offene Rückrufe bei besetzt */
  callbacks?: PendingCallback[]
  /** Rückruf bei besetzt auf der Anlage eingeschaltet */
  callback_enabled?: boolean
  /** SMS senden erlaubt */
  sms?: boolean
}

export interface BossPair {
  id: string
  name: string
  role: 'boss' | 'secretary'
  partner: string
  /** eingeschaltet: Anrufe für den Chef gehen ans Sekretariat */
  active: boolean
}

export interface PendingCallback {
  id: string
  to: string
  name: string
  expires: number
}

export interface VoicemailMessage {
  id: string
  folder: 'INBOX' | 'Old'
  unread: boolean
  time: number
  number: string
  name: string
  duration: number
  /** Voicemail als Text */
  text?: string
  transcribing?: boolean
}

export interface CalendarEvent {
  uid: string
  calendar: string
  summary: string
  start: string
  end: string
  allDay: boolean
  location?: string
  description?: string
}

export type SetupTarget = { kind: 'profile'; url: string } | { kind: 'server'; base: string }

/** Basisadresse ohne Pfad und Schrägstrich; ohne Schema wird https angenommen */
export function normalizeBase(input: string): string {
  let s = input.trim()
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  const u = new URL(s)
  return `${u.protocol}//${u.host}`
}

/**
 * Erkennt, was eingegeben oder gescannt wurde:
 * - sip-telefon://provision?url=…            (Link aus E-Mail und Weboberfläche)
 * - https://anlage/setup/<token>             (QR-Code, Einladungslink)
 * - https://anlage/provision/<token>         (Einrichtungslink)
 * - anlage.example.de / https://anlage:8080  (nur Server: weiter mit Nebenstelle + PIN)
 */
export function parseSetupInput(input: string): SetupTarget | null {
  const text = input.trim()
  if (!text) return null
  const app = /^sip-telefon:\/\/provision\?(.*)$/i.exec(text)
  if (app) {
    const url = new URLSearchParams(app[1]).get('url')
    return url ? parseSetupInput(url) : null
  }
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if (!u.hostname || /\s/.test(text)) return null
  const m = /^\/(setup|provision)\/([A-Za-z0-9]+)\/?$/.exec(u.pathname)
  if (m) return { kind: 'profile', url: `${u.protocol}//${u.host}/provision/${m[2]}` }
  if (u.pathname === '/' || u.pathname === '') return { kind: 'server', base: `${u.protocol}//${u.host}` }
  return null
}

export class SetupError extends Error {}

/** Name für die Geräteliste der Anlage (setzt die App beim Start) */
let deviceName = ''

export function setDeviceName(name: string): void {
  deviceName = encodeURIComponent(name.slice(0, 40))
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(deviceName ? { 'X-Device-Name': deviceName } : {}), ...(init?.headers ?? {}) } })
  } catch {
    throw new SetupError('Die Telefonanlage ist nicht erreichbar. Adresse und Internetverbindung prüfen.')
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) {
    if (res.status === 404) throw new SetupError(body?.error || 'Der Einrichtungslink ist ungültig, wurde erneuert oder das Gerät wurde abgemeldet.')
    throw new SetupError(body?.error || `Fehler ${res.status} von der Telefonanlage.`)
  }
  if (!body) throw new SetupError('Unerwartete Antwort – ist das wirklich eine Phone4all-Telefonanlage?')
  return body
}

export function checkProfile(p: Profile): Profile {
  if (p?.format !== 'phone4all-provisioning') throw new SetupError('Unerwartete Antwort – ist das wirklich eine Phone4all-Telefonanlage?')
  if (!p.remote) {
    throw new SetupError(
      'Die Telefonanlage erlaubt keine Mobil-App. In der Weboberfläche unter System → Fernzugriff einschalten (ab Version 0.6).',
    )
  }
  return p
}

export async function fetchProfile(url: string): Promise<Profile> {
  return checkProfile(await getJson<Profile>(url))
}

/** Einrichtung mit Nebenstelle und Einrichtungs-PIN */
export async function setupWithPin(base: string, extension: string, pin: string): Promise<Profile> {
  return checkProfile(
    await getJson<Profile>(`${normalizeBase(base)}/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extension: extension.trim(), pin: pin.trim() }),
    }),
  )
}

export async function fetchRevision(p: Profile): Promise<{ profile: string; events: string }> {
  return getJson(`${p.url}/revision`)
}

export async function fetchEvents(p: Profile, start: Date, end: Date): Promise<CalendarEvent[]> {
  const q = `start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`
  return getJson<CalendarEvent[]>(`${p.url}/events?${q}`)
}

export async function saveEvent(p: Profile, ev: CalendarEvent): Promise<void> {
  await getJson(`${p.url}/events/${encodeURIComponent(ev.calendar)}/${encodeURIComponent(ev.uid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ev),
  })
}

export async function deleteEvent(p: Profile, ev: CalendarEvent): Promise<void> {
  await getJson(`${p.url}/events/${encodeURIComponent(ev.calendar)}/${encodeURIComponent(ev.uid)}`, { method: 'DELETE' })
}

/** Besetztanzeige, geparkte Gespräche und Stand der Voicemail; null = ältere Anlage */
export async function fetchPresence(p: Profile): Promise<Presence | null> {
  const res = await fetch(`${p.url}/presence`, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  const r = (await res.json().catch(() => null)) as Presence | null
  return r && Array.isArray(r.extensions) && Array.isArray(r.parked) ? r : null
}

export async function fetchVoicemail(p: Profile): Promise<VoicemailMessage[]> {
  return getJson<VoicemailMessage[]>(`${p.url}/voicemail`)
}

export async function markVoicemail(p: Profile, id: string): Promise<VoicemailMessage[]> {
  return getJson<VoicemailMessage[]>(`${p.url}/voicemail/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })
}

export async function deleteVoicemail(p: Profile, id: string): Promise<VoicemailMessage[]> {
  return getJson<VoicemailMessage[]>(`${p.url}/voicemail/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Anrufer für die ganze Anlage sperren (Recht „Rufnummern sperren“) */
export async function blockNumber(p: Profile, number: string, note: string): Promise<void> {
  await getJson(`${p.url}/blocklist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number, note }) })
}

/** In einer Gruppe an- oder abmelden */
export async function setGroup(p: Profile, id: string, active: boolean): Promise<PbxGroup[]> {
  return getJson<PbxGroup[]>(`${p.url}/groups/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }) })
}

export async function fetchGroupMissed(p: Profile): Promise<GroupMissed[]> {
  return getJson<GroupMissed[]>(`${p.url}/missed`)
}

export async function actGroupMissed(p: Profile, e: GroupMissed, action: 'claim' | 'release' | 'done' | 'reopen'): Promise<GroupMissed[]> {
  return getJson<GroupMissed[]>(`${p.url}/missed/${encodeURIComponent(e.group)}/${encodeURIComponent(e.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** Chef und Sekretariat ein- oder ausschalten (wie *83) */
export async function setBoss(p: Profile, id: string, active: boolean): Promise<BossPair[]> {
  return getJson<BossPair[]>(`${p.url}/boss/${encodeURIComponent(id)}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ active }) })
}

/** Rückruf, sobald die Nebenstelle frei ist (wie *37) */
export async function requestCallback(p: Profile, to: string): Promise<PendingCallback[]> {
  return getJson<PendingCallback[]>(`${p.url}/callback`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ to }) })
}

export async function cancelCallback(p: Profile, id: string): Promise<PendingCallback[]> {
  return getJson<PendingCallback[]>(`${p.url}/callback/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** SMS über die Anlage senden; liefert die Nummer, an die gesendet wurde */
export async function sendSms(p: Profile, to: string, text: string): Promise<string> {
  const r = await getJson<{ to: string }>(`${p.url}/sms`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ to, text }) })
  return r.to
}

/** Herkunft eines Anrufs aus dem Kopf Alert-Info der Anlage (info=alert-internal …) */
export type CallOrigin = '' | 'internal' | 'external' | 'group'

export function callOrigin(alertInfo: string): CallOrigin {
  const m = /alert-(internal|external|group)\b/.exec(alertInfo) ?? /\/ring\/(internal|external|group)\b/.exec(alertInfo)
  return (m?.[1] as CallOrigin | undefined) ?? ''
}

/** Rückfrage abschließen: verbinden oder Dreierkonferenz */
export async function joinCalls(p: Profile, mode: 'transfer' | 'conference'): Promise<void> {
  await getJson(`${p.url}/calls/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) })
}

export async function fetchForward(p: Profile): Promise<ForwardInfo> {
  return getJson<ForwardInfo>(`${p.url}/forward`)
}

/** Handy klingelt mit (Recht „forward“) */
export async function setMobileRing(p: Profile, enabled: boolean): Promise<ForwardInfo> {
  return getJson<ForwardInfo>(`${p.url}/forward`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile: enabled }) })
}

/** Platzhalter der CRM-Adresse füllen: {nummer}, {e164}, {name} */
export function crmUrl(template: string, number: string, name: string, countryCode = '49'): string {
  const digits = number.replace(/[^\d+]/g, '')
  const e164 = digits.startsWith('+') ? digits : digits.startsWith('00') ? `+${digits.slice(2)}` : digits.startsWith('0') ? `+${countryCode}${digits.slice(1)}` : digits
  return template
    .replace(/\{nummer\}/g, encodeURIComponent(digits))
    .replace(/\{e164\}/g, encodeURIComponent(e164))
    .replace(/\{name\}/g, encodeURIComponent(name))
}

/** Seiten, die die App zeigt (Vorgabe der Anlage oder alle) */
export function visiblePages(p: Profile | null): AppPage[] {
  const all: AppPage[] = ['home', 'dial', 'contacts', 'calendar', 'history']
  const pages = p?.app?.pages.filter((x) => all.includes(x)) ?? []
  return pages.length ? pages : all
}
