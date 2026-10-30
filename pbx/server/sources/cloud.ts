/**
 * Kontakte und Kalender aus Microsoft 365 (Microsoft Graph) und Google Workspace lesen.
 * Microsoft: App-Registrierung mit Anwendungsberechtigungen Contacts.Read und Calendars.Read,
 * Anmeldung mit Clientschlüssel. Google: Dienstkonto mit domänenweiter Delegierung,
 * Anmeldung per signiertem JWT im Namen des Postfachs.
 */

import crypto from 'node:crypto'
import { DavError } from './dav'
import type { RawEvent } from './ical'
import type { Contact } from './shared'

type Found = Omit<Contact, 'id'>

export interface CloudAccount {
  type: 'm365' | 'google'
  /** Postfach (E-Mail-Adresse) */
  user: string
  /** Microsoft: Clientschlüssel · Google: Schlüsseldatei des Dienstkontos (JSON) */
  password: string
  tenant?: string
  client_id?: string
  /** Google-Kalender: Kalender-ID (leer = Hauptkalender) */
  url?: string
}

const GRAPH = 'https://graph.microsoft.com/v1.0'
const PEOPLE = 'https://people.googleapis.com/v1'
const GCAL = 'https://www.googleapis.com/calendar/v3'
const MAX_PAGES = 50

/** Zugriffsschlüssel je Konto und Bereich, bis kurz vor Ablauf wiederverwendet */
const tokens = new Map<string, { token: string; until: number }>()

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(30000) })
  } catch (e) {
    throw new DavError(`Server nicht erreichbar: ${(e as Error).message}`)
  }
}

async function errorOf(r: Response): Promise<string> {
  const body = (await r.json().catch(() => null)) as { error?: string | { message?: string }; error_description?: string } | null
  const err = body?.error
  return body?.error_description || (typeof err === 'string' ? err : err?.message) || `Serverfehler ${r.status}`
}

async function tokenRequest(url: string, form: Record<string, string>): Promise<{ token: string; until: number }> {
  const r = await call(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })
  if (!r.ok) throw new DavError(`Anmeldung fehlgeschlagen: ${(await errorOf(r)).split('\n')[0]}`)
  const j = (await r.json()) as { access_token?: string; expires_in?: number }
  if (!j.access_token) throw new DavError('Anmeldung fehlgeschlagen: keine Zugangsberechtigung erhalten')
  return { token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 120) * 1000 }
}

const b64url = (b: Buffer | string): string => Buffer.from(b).toString('base64url')

/** Signiertes JWT für ein Google-Dienstkonto (RS256) */
export function googleAssertion(key: { client_email: string; private_key: string; token_uri?: string }, scope: string, sub: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000)
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: key.client_email,
    scope,
    aud: key.token_uri || 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
    ...(sub ? { sub } : {}),
  }))
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(key.private_key)
  return `${head}.${claims}.${b64url(sig)}`
}

function googleKey(acc: CloudAccount): { client_email: string; private_key: string; token_uri?: string } {
  let key: { client_email?: string; private_key?: string; token_uri?: string }
  try {
    key = JSON.parse(acc.password)
  } catch {
    throw new DavError('Die Schlüsseldatei des Dienstkontos ist kein gültiges JSON')
  }
  if (!key.client_email || !key.private_key) throw new DavError('Die Schlüsseldatei enthält kein Dienstkonto (client_email/private_key fehlen)')
  return { client_email: key.client_email, private_key: key.private_key, token_uri: key.token_uri }
}

async function accessToken(acc: CloudAccount, scope: string): Promise<string> {
  const id = `${acc.type}|${acc.tenant}|${acc.client_id}|${acc.user}|${scope}|${crypto.createHash('sha256').update(acc.password).digest('hex')}`
  const cached = tokens.get(id)
  if (cached && cached.until > Date.now()) return cached.token
  let t: { token: string; until: number }
  if (acc.type === 'm365') {
    if (!acc.tenant || !acc.client_id || !acc.password) throw new DavError('Verzeichnis-ID, Anwendungs-ID und Clientschlüssel angeben')
    t = await tokenRequest(`https://login.microsoftonline.com/${encodeURIComponent(acc.tenant)}/oauth2/v2.0/token`, {
      client_id: acc.client_id,
      client_secret: acc.password,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    })
  } else {
    const key = googleKey(acc)
    t = await tokenRequest(key.token_uri || 'https://oauth2.googleapis.com/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: googleAssertion(key, scope, acc.user),
    })
  }
  tokens.set(id, t)
  return t.token
}

async function getJson<T>(url: string, token: string, extra: Record<string, string> = {}): Promise<T> {
  const r = await call(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...extra } })
  if (r.status === 401 || r.status === 403) throw new DavError(`Kein Zugriff: ${(await errorOf(r)).split('\n')[0]}`)
  if (r.status === 404) throw new DavError('Postfach oder Kalender nicht gefunden')
  if (!r.ok) throw new DavError((await errorOf(r)).split('\n')[0])
  return (await r.json()) as T
}

const clean = (list: (string | undefined | null)[]): string[] => [...new Set(list.map((n) => (n ?? '').trim()).filter(Boolean))]

function contact(name: string, company: string, work: string[], mobile: string[], other: string[]): Found | null {
  const all = clean([...work, ...mobile, ...other])
  if (!all.length || !(name || company)) return null
  const phone = clean(work)[0] ?? ''
  const mob = clean(mobile)[0] ?? ''
  return { name: name || company, company, phone, mobile: mob, other: all.filter((n) => n !== phone && n !== mob) }
}

interface GraphContact {
  displayName?: string
  companyName?: string
  businessPhones?: string[]
  homePhones?: string[]
  mobilePhone?: string
}

interface GooglePerson {
  names?: { displayName?: string }[]
  organizations?: { name?: string }[]
  phoneNumbers?: { value?: string; type?: string }[]
}

/** Kontakte eines Postfachs */
export async function cloudContacts(acc: CloudAccount): Promise<Found[]> {
  if (!acc.user) throw new DavError('Postfach (E-Mail-Adresse) angeben')
  const result: Found[] = []
  if (acc.type === 'm365') {
    const token = await accessToken(acc, 'graph')
    let url = `${GRAPH}/users/${encodeURIComponent(acc.user)}/contacts?$top=500&$select=displayName,companyName,businessPhones,homePhones,mobilePhone`
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const j = await getJson<{ value?: GraphContact[]; '@odata.nextLink'?: string }>(url, token)
      for (const c of j.value ?? []) {
        const f = contact(c.displayName ?? '', c.companyName ?? '', c.businessPhones ?? [], [c.mobilePhone ?? ''], c.homePhones ?? [])
        if (f) result.push(f)
      }
      url = j['@odata.nextLink'] ?? ''
    }
    return result
  }
  const token = await accessToken(acc, 'https://www.googleapis.com/auth/contacts.readonly')
  let pageToken = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ personFields: 'names,organizations,phoneNumbers', pageSize: '1000' })
    if (pageToken) q.set('pageToken', pageToken)
    const j = await getJson<{ connections?: GooglePerson[]; nextPageToken?: string }>(`${PEOPLE}/people/me/connections?${q}`, token)
    for (const p of j.connections ?? []) {
      const nums = p.phoneNumbers ?? []
      const of = (t: string): string[] => nums.filter((n) => (n.type ?? '').toLowerCase() === t).map((n) => n.value ?? '')
      const f = contact(p.names?.[0]?.displayName ?? '', p.organizations?.[0]?.name ?? '', of('work'), of('mobile'), nums.map((n) => n.value ?? ''))
      if (f) result.push(f)
    }
    pageToken = j.nextPageToken ?? ''
    if (!pageToken) break
  }
  return result
}

interface GraphEvent {
  id?: string
  iCalUId?: string
  subject?: string
  isAllDay?: boolean
  start?: { dateTime?: string }
  end?: { dateTime?: string }
  location?: { displayName?: string }
  bodyPreview?: string
  type?: string
}

interface GoogleEvent {
  id?: string
  iCalUID?: string
  status?: string
  summary?: string
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
  location?: string
  description?: string
  recurringEventId?: string
}

/** Ganztägiges Datum (JJJJ-MM-TT) als lokale Mitternacht */
function localDay(d: string): number {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day).getTime()
}

/** Graph liefert mit Prefer outlook.timezone="UTC" Zeiten ohne Zonenangabe in UTC */
const graphTime = (s: string): number => Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`)

/** Termine eines Postfachs im Zeitraum (Serien bereits einzeln) */
export async function cloudEvents(acc: CloudAccount, start: number, end: number): Promise<RawEvent[]> {
  if (!acc.user) throw new DavError('Postfach (E-Mail-Adresse) angeben')
  const result: RawEvent[] = []
  if (acc.type === 'm365') {
    const token = await accessToken(acc, 'graph')
    const q = new URLSearchParams({
      startDateTime: new Date(start).toISOString(),
      endDateTime: new Date(end).toISOString(),
      $top: '500',
      $select: 'id,iCalUId,subject,isAllDay,start,end,location,bodyPreview,type',
    })
    let url = `${GRAPH}/users/${encodeURIComponent(acc.user)}/calendarView?${q}`
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const j = await getJson<{ value?: GraphEvent[]; '@odata.nextLink'?: string }>(url, token, { Prefer: 'outlook.timezone="UTC"' })
      for (const e of j.value ?? []) {
        const s = e.start?.dateTime ?? ''
        const en = e.end?.dateTime ?? ''
        if (!s) continue
        result.push({
          uid: `${e.iCalUId || e.id}${e.type === 'occurrence' || e.type === 'exception' ? `-${s.slice(0, 19)}` : ''}`,
          summary: e.subject ?? '',
          start: e.isAllDay ? localDay(s) : graphTime(s),
          end: e.isAllDay ? localDay(en || s) : graphTime(en || s),
          allDay: !!e.isAllDay,
          location: e.location?.displayName ?? '',
          description: e.bodyPreview ?? '',
          recurring: e.type === 'occurrence' || e.type === 'exception',
        })
      }
      url = j['@odata.nextLink'] ?? ''
    }
    return result
  }
  const token = await accessToken(acc, 'https://www.googleapis.com/auth/calendar.readonly')
  const cal = encodeURIComponent(acc.url?.trim() || 'primary')
  let pageToken = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      singleEvents: 'true',
      maxResults: '2500',
    })
    if (pageToken) q.set('pageToken', pageToken)
    const j = await getJson<{ items?: GoogleEvent[]; nextPageToken?: string }>(`${GCAL}/calendars/${cal}/events?${q}`, token)
    for (const e of j.items ?? []) {
      if (e.status === 'cancelled') continue
      const allDay = !!e.start?.date
      const s = allDay ? localDay(e.start!.date!) : Date.parse(e.start?.dateTime ?? '')
      const en = allDay ? localDay(e.end?.date ?? e.start!.date!) : Date.parse(e.end?.dateTime ?? e.start?.dateTime ?? '')
      if (!Number.isFinite(s)) continue
      result.push({
        uid: e.recurringEventId ? `${e.iCalUID || e.recurringEventId}-${e.id}` : e.iCalUID || e.id || '',
        summary: e.summary ?? '',
        start: s,
        end: Number.isFinite(en) ? en : s,
        allDay,
        location: e.location ?? '',
        description: e.description ?? '',
        recurring: !!e.recurringEventId,
      })
    }
    pageToken = j.nextPageToken ?? ''
    if (!pageToken) break
  }
  return result
}
