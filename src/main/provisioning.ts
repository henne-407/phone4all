/**
 * Automatische Einrichtung durch eine Phone4all-Telefonanlage: Die App sucht die
 * Anlage im LAN (UDP-Broadcast), holt mit Einrichtungslink oder Nebenstelle + PIN
 * ein Profil und übernimmt Konto, Passwort und Telefonbuch. Das Profil wird später
 * über denselben Link aufgefrischt, damit Änderungen an der Anlage ankommen. Die
 * Anlage kann außerdem Ansichten vorgeben (App-Profil) und zentrale Kalender liefern.
 */

import dgram from 'node:dgram'
import os from 'node:os'
import type {
  AccountSettings,
  AppPolicy,
  Contact,
  HomeCard,
  PageName,
  PbxCalendar,
  PbxForward,
  PbxForwardChange,
  PbxFound,
  PbxPermission,
  PbxPreview,
  VideoAccount,
} from '../shared/types'
import { loadJson, saveJson } from './files'
import type { Store } from './store'

export const DISCOVERY_PORT = 15060
export const LINK_SCHEME = 'sip-telefon'
const PROFILE_FORMAT = 'phone4all-provisioning'
const REFRESH_INTERVAL = 6 * 60 * 60 * 1000
/** So oft fragt die App, ob sich Profil oder zentrale Termine geändert haben */
const POLL_INTERVAL = 2 * 60 * 1000
const PAGES: PageName[] = ['home', 'dial', 'contacts', 'calendar', 'history', 'messenger']
const CARDS: HomeCard[] = ['status', 'today', 'favorites', 'recent', 'events']
const URL_SECRET = 'pbx:url'

export interface PbxProfile {
  format: typeof PROFILE_FORMAT
  version: number
  pbx: { name: string; version: string }
  extension: string
  account: AccountSettings
  password: string
  url: string
  phonebook: { name: string; company: string; phone: string; mobile: string; id?: string }[]
  app: AppPolicy | null
  calendars: PbxCalendar[]
  permissions: PbxPermission[]
  messenger: boolean
  video: VideoAccount | null
  revision: string
}

function parseVideo(data: unknown): VideoAccount | null {
  const v = data as Partial<VideoAccount> | null
  if (!v || typeof v.websocket !== 'string' || !/^wss?:\/\//.test(v.websocket) || typeof v.user !== 'string' || !v.user) return null
  return {
    websocket: v.websocket,
    user: v.user,
    domain: String(v.domain ?? ''),
    ice_servers: (Array.isArray(v.ice_servers) ? v.ice_servers : [])
      .filter((s) => s && Array.isArray(s.urls))
      .map((s) => ({
        urls: s.urls.map(String),
        ...(typeof s.username === 'string' ? { username: s.username } : {}),
        ...(typeof s.credential === 'string' ? { credential: s.credential } : {}),
      })),
  }
}

const PERMISSIONS: PbxPermission[] = ['forward', 'forward_external', 'forward_rules', 'calendar_edit', 'phonebook_edit']

/** Rechte aus dem Profil; ältere Anlagen kennen keine und erlauben alles wie bisher */
export function parsePermissions(data: unknown): PbxPermission[] {
  if (!Array.isArray(data)) return ['calendar_edit']
  return PERMISSIONS.filter((p) => data.includes(p))
}

/** Antwort von …/forward prüfen */
export function parseForward(data: unknown): PbxForward | null {
  const f = data as Partial<PbxForward> | null
  if (!f || typeof f !== 'object' || !Array.isArray(f.rules) || !Array.isArray(f.targets)) return null
  return {
    permissions: parsePermissions(f.permissions),
    cfu: String(f.cfu ?? ''),
    active: String(f.active ?? ''),
    busy: String(f.busy ?? ''),
    noanswer: String(f.noanswer ?? ''),
    rules: f.rules,
    targets: f.targets.filter((t) => t && typeof t.number === 'string'),
    timeconditions: Array.isArray(f.timeconditions) ? f.timeconditions : [],
  }
}

/** Vorgaben aus dem Profil prüfen; unbekannte Ansichten werden ignoriert. */
export function parsePolicy(data: unknown): AppPolicy | null {
  const a = data as Partial<AppPolicy> | null
  if (!a || typeof a !== 'object' || !Array.isArray(a.pages)) return null
  // Reihenfolge der Anlage übernehmen (= Reihenfolge der Navigation)
  const pages = a.pages.filter((p, i, l): p is PageName => PAGES.includes(p) && l.indexOf(p) === i)
  if (!pages.length) return null
  return {
    pages,
    start_tab: pages.includes(a.start_tab as PageName) ? (a.start_tab as PageName) : pages[0],
    home_cards: Array.isArray(a.home_cards) ? a.home_cards.filter((c, i, l): c is HomeCard => CARDS.includes(c) && l.indexOf(c) === i) : [],
    lock_layout: Boolean(a.lock_layout),
    lock_account: Boolean(a.lock_account),
  }
}

function parseCalendars(data: unknown): PbxCalendar[] {
  if (!Array.isArray(data)) return []
  return data
    .filter((c) => c && typeof c.id === 'string' && /^[\w-]+$/.test(c.id))
    .map((c) => ({
      id: c.id,
      name: String(c.name ?? c.id),
      color: /^#[0-9a-f]{6}$/i.test(String(c.color)) ? String(c.color) : '#1a73e8',
      writable: Boolean(c.writable),
    }))
}

/** Prüft die Antwort der Anlage, damit kein beliebiges JSON das Konto überschreibt. */
export function parseProfile(data: unknown): PbxProfile {
  const p = data as Partial<PbxProfile> | null
  if (!p || p.format !== PROFILE_FORMAT || !p.account || typeof p.account.user !== 'string' || !p.account.domain) {
    throw new Error('Die Antwort ist kein Profil einer Phone4all-Telefonanlage.')
  }
  if (typeof p.password !== 'string' || p.password.includes(';')) throw new Error('Das Profil enthält kein gültiges Passwort.')
  return {
    format: PROFILE_FORMAT,
    version: Number(p.version) || 1,
    pbx: { name: String(p.pbx?.name ?? 'Telefonanlage'), version: String(p.pbx?.version ?? '') },
    extension: String(p.extension ?? p.account.user),
    account: parseAccount(p.account),
    password: p.password,
    url: typeof p.url === 'string' && /^https?:\/\//.test(p.url) ? p.url : '',
    phonebook: Array.isArray(p.phonebook) ? p.phonebook.filter((e) => e && typeof e.phone === 'string') : [],
    app: parsePolicy(p.app),
    calendars: parseCalendars(p.calendars),
    permissions: parsePermissions(p.permissions),
    messenger: p.messenger === true,
    video: p.messenger === true ? parseVideo(p.video) : null,
    revision: String(p.revision ?? ''),
  }
}

/**
 * Nur bekannte Felder übernehmen; sie landen in der Kontozeile von baresip, daher keine
 * Zeichen, mit denen sich weitere Parameter oder Zeilen einschmuggeln ließen.
 */
export function parseAccount(raw: Partial<AccountSettings>): AccountSettings {
  const text = (v: unknown, pattern = /^[\w.:@[\]-]*$/): string => {
    const s = String(v ?? '').trim()
    if (!pattern.test(s)) throw new Error('Das Profil enthält ungültige Kontodaten.')
    return s
  }
  const num = (v: unknown, max: number): number => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 0 && n <= max ? n : 0
  }
  return {
    display_name: String(raw.display_name ?? '').replace(/["<>;\r\n\\]/g, '').slice(0, 80),
    user: text(raw.user),
    domain: text(raw.domain),
    auth_user: text(raw.auth_user),
    port: num(raw.port, 65535),
    local_port: num(raw.local_port, 65535),
    transport: raw.transport === 'tcp' || raw.transport === 'tls' ? raw.transport : 'udp',
    outbound: text(raw.outbound, /^[\w.:@[\];=-]*$/),
    stun: text(raw.stun),
    mediaenc: ['srtp', 'srtp-mand', 'srtp-mandf', 'dtls_srtp', 'zrtp'].includes(String(raw.mediaenc)) ? String(raw.mediaenc) : '',
    regint: num(raw.regint, 86400) || 300,
  }
}

/** „sip-telefon://provision?url=…“ oder ein direkt eingefügter Link → Profil-URL */
export function profileUrlFromLink(link: string): string | null {
  const text = link.trim()
  try {
    const u = new URL(text)
    if (u.protocol === `${LINK_SCHEME}:`) {
      const target = u.searchParams.get('url') ?? ''
      return /^https?:\/\//.test(target) ? target : null
    }
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      // Link aus der Einladung (…/setup/<token>) oder direkt das Profil (…/provision/<token>)
      return text.replace(/\/setup\/([\w-]+)\/?$/, '/provision/$1')
    }
  } catch {
    // kein Link
  }
  return null
}

/** Eingabe wie „192.168.1.5“, „pbx.local:8080“ oder „https://pbx.example.de“ → Basis-URL */
export function normalizeServer(input: string): string {
  let s = input.trim().replace(/\/+$/, '')
  if (!s) return ''
  if (!/^https?:\/\//.test(s)) s = `http://${s}`
  const u = new URL(s)
  if (u.protocol === 'http:' && !u.port) u.port = '8080'
  return u.origin
}

/** Broadcast-Adressen aller IPv4-Netze des Rechners */
export function broadcastAddresses(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const result = new Set<string>(['255.255.255.255'])
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue
      const addr = i.address.split('.').map(Number)
      const mask = i.netmask.split('.').map(Number)
      result.add(addr.map((a, n) => (a & mask[n]) | (~mask[n] & 255)).join('.'))
    }
  }
  return [...result]
}

/** Sucht Telefonanlagen im LAN; Antworten innerhalb von `timeout` ms. */
export function discover(timeout = 1500): Promise<PbxFound[]> {
  return new Promise((resolve) => {
    const found = new Map<string, PbxFound>()
    const sock = dgram.createSocket('udp4')
    const done = (): void => {
      try {
        sock.close()
      } catch {
        // schon geschlossen
      }
      resolve([...found.values()])
    }
    sock.on('message', (msg, rinfo) => {
      try {
        const r = JSON.parse(msg.toString()) as { phone4all?: string; name?: string; version?: string; port?: number }
        if (r.phone4all !== 'pbx') return
        const url = `http://${rinfo.address}:${Number(r.port) || 8080}`
        found.set(url, { name: String(r.name ?? 'Telefonanlage'), version: String(r.version ?? ''), url })
      } catch {
        // fremde Antwort
      }
    })
    sock.on('error', done)
    sock.bind(0, () => {
      sock.setBroadcast(true)
      const msg = Buffer.from(JSON.stringify({ phone4all: 'discover' }))
      for (const addr of broadcastAddresses()) sock.send(msg, DISCOVERY_PORT, addr, () => undefined)
    })
    setTimeout(done, timeout)
  })
}

async function request(url: string, body?: unknown): Promise<PbxProfile> {
  let r: Response
  try {
    r = await fetch(url, {
      method: body ? 'POST' : 'GET',
      // Name für die Geräteliste der Anlage
      headers: { 'X-Device-Name': encodeURIComponent(os.hostname()), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    throw new Error('Die Telefonanlage ist nicht erreichbar. Adresse und Netzwerk prüfen.')
  }
  const data = (await r.json().catch(() => null)) as { error?: string } | null
  if (!r.ok) {
    if (r.status === 404) throw new Error('Der Einrichtungslink ist ungültig, wurde erneuert oder das Gerät wurde abgemeldet.')
    throw new Error(data?.error || `Die Telefonanlage antwortet mit Fehler ${r.status}.`)
  }
  return parseProfile(data)
}

function preview(p: PbxProfile): PbxPreview {
  return {
    pbx: p.pbx.name,
    version: p.pbx.version,
    extension: p.extension,
    display_name: p.account.display_name,
    server: p.account.domain,
    contacts: p.phonebook.length,
  }
}

export interface ProvisioningHost {
  store: Store
  restartEngine(): void
  stateChanged(): void
  phonebookChanged(): void
  /** Liste der zentralen Kalender hat sich geändert */
  calendarsChanged(): void
  /** Termine in zentralen Kalendern haben sich geändert */
  eventsChanged(): void
  toast(text: string): void
}

export class Provisioning {
  /** Abgerufen, aber noch nicht bestätigt */
  private pending: PbxProfile | null = null
  private timer: NodeJS.Timeout | null = null
  private poller: NodeJS.Timeout | null = null
  private revision = { profile: '', events: '' }
  phonebook: Omit<Contact, 'id'>[]
  /** Umleitungen der Nebenstelle (null = Anlage kennt sie nicht oder nicht erreichbar) */
  forward: PbxForward | null = null

  constructor(
    private host: ProvisioningHost,
    private phonebookPath: string,
  ) {
    this.phonebook = loadJson(phonebookPath, [])
  }

  get active(): boolean {
    return Boolean(this.host.store.settings.provisioning.pbx)
  }

  start(): void {
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL)
    this.timer.unref()
    this.poller = setInterval(() => void this.poll(), POLL_INTERVAL)
    this.poller.unref()
    void this.refresh()
  }

  /** Die Anlage verwaltet die Kontodaten (App-Profil) */
  get accountLocked(): boolean {
    return this.active && Boolean(this.host.store.settings.provisioning.policy?.lock_account)
  }

  /** Profil-Adresse der Anlage (…/provision/<token>), Basis für Kalender-Abfragen */
  get url(): string {
    return this.active ? this.host.store.getSecret(URL_SECRET) : ''
  }

  /** Fragt nur den Änderungsstand ab und lädt bei Bedarf Profil oder Termine nach. */
  async poll(): Promise<void> {
    const url = this.url
    if (!url) return
    try {
      const r = await fetch(`${url}/revision`, { signal: AbortSignal.timeout(10000) })
      if (!r.ok) return
      const rev = (await r.json()) as { profile?: string; events?: string }
      if (rev.profile && rev.profile !== this.revision.profile) await this.refresh()
      if (rev.events && this.revision.events && rev.events !== this.revision.events) this.host.eventsChanged()
      if (rev.events) this.revision.events = rev.events
      await this.loadForward()
    } catch {
      // Anlage gerade nicht erreichbar
    }
  }

  /** Umleitungen von der Anlage holen (auch Regeln greifen je nach Uhrzeit) */
  async loadForward(): Promise<void> {
    const url = this.url
    if (!url) return
    try {
      const r = await fetch(`${url}/forward`, { signal: AbortSignal.timeout(10000) })
      const next = r.ok ? parseForward(await r.json()) : r.status === 404 ? null : this.forward
      if (JSON.stringify(next) !== JSON.stringify(this.forward)) {
        this.forward = next
        this.host.stateChanged()
      }
    } catch {
      // Anlage gerade nicht erreichbar: letzten Stand behalten
    }
  }

  /** Umleitung in der Anlage ändern; die Anlage prüft die Rechte. */
  async setForward(change: PbxForwardChange): Promise<PbxForward> {
    const url = this.url
    if (!url) throw new Error('Keine Telefonanlage verbunden.')
    let r: Response
    try {
      r = await fetch(`${url}/forward`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
        signal: AbortSignal.timeout(10000),
      })
    } catch {
      throw new Error('Die Telefonanlage ist nicht erreichbar.')
    }
    const data = (await r.json().catch(() => null)) as { error?: string } | null
    if (!r.ok) throw new Error(data?.error || `Die Telefonanlage antwortet mit Fehler ${r.status}.`)
    const next = parseForward(data)
    if (!next) throw new Error('Die Telefonanlage kennt keine Umleitungen aus der App.')
    this.forward = next
    this.host.stateChanged()
    return next
  }

  /** Kontakt im Telefonbuch der Anlage anlegen (ohne pbx) oder ändern (Recht phonebook_edit) */
  async savePhonebookEntry(contact: Pick<Contact, 'name' | 'company' | 'phone' | 'mobile' | 'pbx'>): Promise<void> {
    const { name, company, phone, mobile } = contact
    await this.phonebookRequest(contact.pbx ? 'PUT' : 'POST', contact.pbx, { name, company, phone, mobile })
  }

  async deletePhonebookEntry(id: string): Promise<void> {
    await this.phonebookRequest('DELETE', id)
  }

  private async phonebookRequest(method: string, id?: string, body?: object): Promise<void> {
    const url = this.url
    if (!url) throw new Error('Keine Telefonanlage verbunden.')
    let r: Response
    try {
      r = await fetch(`${url}/phonebook${id ? `/${encodeURIComponent(id)}` : ''}`, {
        method,
        // Name für die Geräteliste der Anlage
      headers: { 'X-Device-Name': encodeURIComponent(os.hostname()), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
      })
    } catch {
      throw new Error('Die Telefonanlage ist nicht erreichbar.')
    }
    const data = (await r.json().catch(() => null)) as { error?: string } | null
    if (!r.ok) throw new Error(data?.error || `Die Telefonanlage antwortet mit Fehler ${r.status}.`)
    // Neues Telefonbuch gleich holen, damit die Liste stimmt
    await this.refresh()
  }

  /** Profil per Link abrufen (zur Bestätigung). */
  async fromLink(link: string): Promise<PbxPreview> {
    const url = profileUrlFromLink(link)
    if (!url) throw new Error('Das ist kein Einrichtungslink einer Telefonanlage.')
    this.pending = await request(url)
    this.pending.url ||= url
    return preview(this.pending)
  }

  /** Profil mit Nebenstelle und Einrichtungs-PIN abrufen (zur Bestätigung). */
  async fromPin(server: string, extension: string, pin: string): Promise<PbxPreview> {
    const base = normalizeServer(server)
    if (!base) throw new Error('Bitte die Adresse der Telefonanlage angeben.')
    this.pending = await request(`${base}/provision`, { extension: extension.trim(), pin: pin.trim() })
    return preview(this.pending)
  }

  /** Bestätigtes Profil übernehmen. Gibt false zurück, wenn kein Schlüsselbund verfügbar war. */
  apply(): boolean {
    if (!this.pending) throw new Error('Kein Profil zum Übernehmen.')
    const secure = this.applyProfile(this.pending, true)
    this.pending = null
    void this.loadForward()
    return secure
  }

  /** Verbindung zur Anlage lösen; das Konto bleibt eingerichtet. */
  disconnect(): void {
    if (this.accountLocked) throw new Error('Die Telefonanlage verwaltet dieses Konto. Bitte in der Anlage das App-Profil ändern.')
    const { store } = this.host
    store.deleteSecret(URL_SECRET)
    store.settings.provisioning = { pbx: '', extension: '', server: '', updated: 0, policy: null, calendars: [], permissions: [], messenger: false, video: null }
    store.saveSettings()
    this.revision = { profile: '', events: '' }
    this.forward = null
    this.setPhonebook([])
    this.host.calendarsChanged()
    this.host.stateChanged()
  }

  /** Profil erneut abrufen und Änderungen still übernehmen. */
  async refresh(): Promise<void> {
    const url = this.host.store.getSecret(URL_SECRET)
    if (!this.active || !url) return
    try {
      const p = await request(url)
      this.applyProfile(p, false)
      await this.loadForward()
    } catch {
      // Anlage gerade nicht erreichbar: beim nächsten Mal wieder versuchen
    }
  }

  private applyProfile(p: PbxProfile, initial: boolean): boolean {
    const { store } = this.host
    const account: AccountSettings = { ...store.account, ...p.account }
    const changed = JSON.stringify(account) !== JSON.stringify(store.account) || p.password !== store.getPassword()
    Object.assign(store.account, account)
    const secure = store.setPassword(p.password)
    if (p.url) store.setSecret(URL_SECRET, p.url)
    const calendarsChanged = JSON.stringify(p.calendars) !== JSON.stringify(store.settings.provisioning.calendars)
    store.settings.provisioning = {
      pbx: p.pbx.name,
      extension: p.extension,
      server: p.account.domain,
      updated: Date.now(),
      policy: p.app,
      calendars: p.calendars,
      permissions: p.permissions,
      messenger: p.messenger,
      video: p.video,
    }
    this.revision.profile = p.revision
    store.settings.registered = true
    store.saveSettings()
    if (JSON.stringify(p.phonebook) !== JSON.stringify(this.phonebook)) this.setPhonebook(p.phonebook)
    if (calendarsChanged || initial) this.host.calendarsChanged()
    if (changed || initial) this.host.restartEngine()
    if (changed && !initial) this.host.toast(`Konto von „${p.pbx.name}“ aktualisiert`)
    this.host.stateChanged()
    return secure
  }

  private setPhonebook(entries: PbxProfile['phonebook']): void {
    this.phonebook = entries.map((e) => ({
      name: e.name,
      company: e.company,
      phone: e.phone,
      mobile: e.mobile,
      other: [],
      ...(typeof e.id === 'string' && e.id ? { pbx: e.id } : {}),
    }))
    saveJson(this.phonebookPath, this.phonebook)
    this.host.phonebookChanged()
  }
}
