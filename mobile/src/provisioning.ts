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
}

export interface TeamMember {
  number: string
  name: string
  state: 'idle' | 'ringing' | 'busy' | 'offline'
  dnd: boolean
  /** Umleitung: interne Nummer oder „extern“ */
  forward: string
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
}

export interface VoicemailMessage {
  id: string
  folder: 'INBOX' | 'Old'
  unread: boolean
  time: number
  number: string
  name: string
  duration: number
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

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } })
  } catch {
    throw new SetupError('Die Telefonanlage ist nicht erreichbar. Adresse und Internetverbindung prüfen.')
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) {
    if (res.status === 404) throw new SetupError(body?.error || 'Der Einrichtungslink ist ungültig oder wurde erneuert.')
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
