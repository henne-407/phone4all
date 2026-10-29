/** Konfiguration und Laufzeitzustand laden/speichern, Sicherungen, Export und Import. */

import { randomBytes, randomInt } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { loadJson, saveJson, writeAtomic } from './files'
import {
  COLLECTIONS,
  type AppDevice,
  type CollectionName,
  DECT_MAX_HANDSETS,
  DEFAULT_CONFIG,
  type DectBase,
  type Extension,
  type ForwardRule,
  type PbxConfig,
  withDefaults,
} from './model'
import { cleanNumber, isInternalNumber } from './numbers'
import { PATHS, SETTINGS } from './paths'
import type { RuntimeState } from './routing'

const BACKUP_KEEP = 30

export class ValidationError extends Error {}

export function newId(): string {
  // Beginnt mit Buchstaben, damit die ID auch als Kontextname im Wählplan taugt
  return 'x' + randomBytes(5).toString('hex')
}

export function newSecret(length = 20): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join('')
}

/** Wie lange eine neue Einrichtungs-PIN gilt */
export const PIN_HOURS = 72

/** Neue Einrichtungs-PIN, gültig für PIN_HOURS Stunden und eine Einrichtung */
export function renewPin(ext: Extension, now = Date.now()): void {
  ext.provision_pin = newPin()
  ext.provision_pin_expires = now + PIN_HOURS * 3600000
}

/** PIN verbrauchen (nach Einrichtung oder zu vielen Fehlversuchen) */
export function consumePin(ext: Extension): void {
  ext.provision_pin = newPin()
  ext.provision_pin_expires = 0
}

export function pinValid(ext: Extension, now = Date.now()): boolean {
  return Boolean(ext.provision_pin) && ext.provision_pin_expires > now
}

/** Neuer Einladungslink, gültig für PIN_HOURS Stunden; eingerichtete Geräte bleiben */
export function renewLink(ext: Extension, now = Date.now()): void {
  ext.provision_token = newSecret(32)
  ext.provision_expires = now + PIN_HOURS * 3600000
}

export function linkValid(ext: Extension, now = Date.now()): boolean {
  return Boolean(ext.provision_token) && ext.provision_expires > now
}

/** Höchstzahl eingerichteter Apps je Nebenstelle */
export const MAX_APP_DEVICES = 10

/** Neues Gerät mit eigenem Token anlegen */
export function addDevice(ext: Extension, name: string, ip: string, now = Date.now()): AppDevice {
  if (ext.devices.length >= MAX_APP_DEVICES) {
    throw new ValidationError(`Für die Nebenstelle ${ext.number} sind schon ${MAX_APP_DEVICES} Geräte eingerichtet. Bitte in der Verwaltung alte Geräte abmelden.`)
  }
  const device: AppDevice = { id: newId(), name: name || 'Gerät', token: newSecret(32), created: now, seen: now, ip }
  ext.devices.push(device)
  return device
}

/** Nebenstelle und Gerät zu einem Geräte-Token */
export function findDevice(cfg: PbxConfig, token: string): { ext: Extension; device: AppDevice } | null {
  if (!token) return null
  for (const ext of cfg.extensions) {
    const device = ext.devices.find((d) => d.token === token)
    if (device) return { ext, device }
  }
  return null
}

/**
 * Bis 0.8.1 hatte jede Nebenstelle ein einziges, dauerhaftes Token für alle Geräte.
 * Bereits eingerichtete Apps behalten es als gemeinsames Gerät; der Einladungslink wird neu.
 */
export function migrateDevices(raw: unknown, exts: Extension[], now = Date.now()): void {
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
  for (const ext of exts) {
    const old = list.find((x) => x.id === ext.id)
    if (!old || Array.isArray(old.devices) || !ext.provision_token) continue
    ext.devices = [{ id: newId(), name: 'Bisher eingerichtete Geräte', token: ext.provision_token, created: now, seen: 0, ip: '' }]
    ext.provision_token = newSecret(32)
    ext.provision_expires = 0
  }
}

export function newPin(digits = 6): string {
  return Array.from({ length: digits }, () => randomInt(10)).join('')
}

/** Fehlende Geheimnisse ergänzen (neue Nebenstellen, Import ohne Passwörter). */
export function fillSecrets(ext: Extension): void {
  if (!ext.secret) ext.secret = newSecret()
  if (!ext.provision_token) renewLink(ext)
  if (!/^\d{6,}$/.test(ext.provision_pin)) renewPin(ext)
  if (!ext.voicemail.pin) ext.voicemail.pin = newPin(4)
}

/** Fehlende Geheimnisse einer DECT-Basis ergänzen; MAC einheitlich schreiben. */
export function fillDectSecrets(base: DectBase): void {
  if (!base.token) base.token = newSecret(32)
  if (!/^\d{4}$/.test(base.pin)) base.pin = newPin(4)
  base.mac = normalizeMac(base.mac)
}

/** „7C:2F:80-E0.D6 05“ → „7c2f80e0d605“ */
export function normalizeMac(mac: string): string {
  return mac.replace(/[\s:.-]/g, '').toLowerCase()
}

/** Belegte interne Rufnummern: Nummer → Beschreibung */
function usedNumbers(cfg: PbxConfig): Map<string, string> {
  const used = new Map<string, string>()
  const add = (n: string, what: string): void => {
    if (!n) return
    if (used.has(n)) throw new ValidationError(`Die Nummer ${n} ist doppelt vergeben (${used.get(n)} und ${what}).`)
    used.set(n, what)
  }
  for (const e of cfg.extensions) add(e.number, `Nebenstelle ${e.name || e.number}`)
  for (const g of cfg.groups) add(g.number, `Gruppe ${g.name || g.number}`)
  for (const c of cfg.conferences) add(c.number, `Konferenz ${c.name || c.number}`)
  for (const i of cfg.ivrs) add(i.number, `Sprachmenü ${i.name || i.number}`)
  return used
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function validateRule(num: string, r: ForwardRule): void {
  if (!r.id) r.id = newId()
  if (!['schedule', 'timecondition', 'dnd'].includes(r.when)) throw new ValidationError(`Nebenstelle ${num}: unbekannte Umleitungsregel.`)
  if (!cleanNumber(r.target)) throw new ValidationError(`Nebenstelle ${num}: Bei einer Umleitungsregel fehlt das Ziel.`)
  if (r.when === 'schedule') {
    if (!TIME.test(r.from) || !TIME.test(r.to)) throw new ValidationError(`Nebenstelle ${num}: Uhrzeit der Umleitungsregel im Format 18:00 angeben.`)
    if (!r.days.length || r.days.some((d) => d < 1 || d > 7)) throw new ValidationError(`Nebenstelle ${num}: Wochentage der Umleitungsregel fehlen.`)
  }
}

/** IDs landen in Dateinamen und Asterisk-Konfiguration (Kontexte, Abschnitte) */
const ID = /^[A-Za-z0-9_-]{1,64}$/

/** IPv4/IPv6-Adresse oder IPv4-Netz in CIDR-Schreibweise */
export function isAddressOrNet(entry: string): boolean {
  const [addr, bits, extra] = entry.trim().split('/')
  if (extra !== undefined) return false
  if (bits === undefined) return net.isIP(addr) !== 0
  return net.isIPv4(addr) && /^\d{1,2}$/.test(bits) && Number(bits) <= 32
}

export function validate(cfg: PbxConfig): void {
  for (const kind of COLLECTIONS) {
    for (const item of cfg[kind] as unknown as { id: unknown }[]) {
      if (typeof item.id !== 'string' || !ID.test(item.id)) throw new ValidationError(`Ungültige ID „${String(item.id)}“ (nur Buchstaben, Ziffern, - und _).`)
    }
  }
  const sec = cfg.security
  for (const [label, list] of [
    ['Nie sperren', sec.whitelist],
    ['Nebenstellen nur aus diesen Netzen', sec.extension_nets],
    ['Vertrauenswürdige Proxys', sec.trusted_proxies],
  ] as const) {
    const bad = list.find((e) => !isAddressOrNet(e))
    if (bad !== undefined) throw new ValidationError(`${label}: „${bad}“ ist keine IP-Adresse und kein Netz wie 192.168.1.0/24.`)
  }
  for (const key of ['max_calls_ext', 'max_calls_total', 'international_per_day'] as const) {
    if (!Number.isInteger(sec[key]) || sec[key] < 0) throw new ValidationError('Grenzen für Gespräche: ganze Zahlen ab 0.')
  }
  const badPrefix = sec.premium_prefixes.find((p) => !/^(\+|00|0)\d+$/.test(p.trim()))
  if (badPrefix !== undefined) throw new ValidationError(`Sonderrufnummern: „${badPrefix}“ ist keine Vorwahl wie 0900 oder 00881.`)
  const badCountry = sec.countries.find((c) => !/^(\*|[1-9]\d{0,3})$/.test(c.trim()))
  if (badCountry !== undefined) throw new ValidationError(`Erlaubte Länder: „${badCountry}“ ist keine Ländervorwahl wie 43.`)
  for (const e of cfg.extensions) {
    if (!isInternalNumber(e.number)) throw new ValidationError(`Ungültige Nebenstelle „${e.number}“: 2–6 Ziffern, nicht mit 0 beginnend.`)
    if (!e.name.trim()) throw new ValidationError(`Nebenstelle ${e.number}: Name fehlt.`)
    if (e.secret && e.secret.length < 8) throw new ValidationError(`Nebenstelle ${e.number}: Das SIP-Passwort braucht mindestens 8 Zeichen.`)
    if (/[;\s]/.test(e.secret)) throw new ValidationError(`Nebenstelle ${e.number}: Das SIP-Passwort darf keine Leerzeichen oder „;“ enthalten.`)
    for (const r of e.forward.rules) validateRule(e.number, r)
  }
  for (const g of cfg.groups) {
    if (g.number && !isInternalNumber(g.number)) throw new ValidationError(`Gruppe ${g.name}: ungültige Nummer „${g.number}“.`)
    if (!g.name.trim()) throw new ValidationError('Gruppe ohne Namen.')
  }
  for (const c of cfg.conferences) {
    if (!isInternalNumber(c.number)) throw new ValidationError(`Konferenz ${c.name}: ungültige Nummer „${c.number}“.`)
  }
  for (const i of cfg.ivrs) {
    if (i.number && !isInternalNumber(i.number)) throw new ValidationError(`Sprachmenü ${i.name}: ungültige Nummer „${i.number}“.`)
  }
  for (const t of cfg.trunks) {
    if (!t.name.trim()) throw new ValidationError('SIP-Konto ohne Namen.')
    if (t.enabled && !t.registrar.trim()) throw new ValidationError(`SIP-Konto ${t.name}: Server/Registrar fehlt.`)
    if (/[\s;]/.test(t.registrar)) throw new ValidationError(`SIP-Konto ${t.name}: ungültiger Server.`)
  }
  for (const p of cfg.appprofiles) {
    if (!p.name.trim()) throw new ValidationError('App-Profil ohne Namen.')
    if (!p.pages.length) throw new ValidationError(`App-Profil ${p.name}: mindestens eine Seite muss sichtbar sein.`)
    if (!p.pages.includes(p.start_tab)) throw new ValidationError(`App-Profil ${p.name}: Die Startseite muss sichtbar sein.`)
  }
  for (const c of cfg.calendars) {
    if (!c.name.trim()) throw new ValidationError('Kalender ohne Namen.')
    if (!/^#[0-9a-f]{6}$/i.test(c.color)) throw new ValidationError(`Kalender ${c.name}: ungültige Farbe.`)
    if (c.kind === 'subscription') {
      // Abonnierte Kalender sind nur zum Lesen
      c.writable = false
      c.source.url = c.source.url.trim().replace(/^webcal:\/\//i, 'https://')
      if (!/^https?:\/\/\S+$/i.test(c.source.url)) throw new ValidationError(`Kalender ${c.name}: Adresse mit http:// oder https:// angeben.`)
      c.source.refresh_minutes = Math.max(5, Math.round(c.source.refresh_minutes) || 60)
    }
  }
  for (const s of cfg.contactsources) {
    if (!s.name.trim()) throw new ValidationError('Kontaktquelle ohne Namen.')
    s.refresh_minutes = Math.max(5, Math.round(s.refresh_minutes) || 60)
    if (s.type === 'mssql') {
      if (!s.host.trim() || !s.database.trim()) throw new ValidationError(`Kontaktquelle ${s.name}: Server und Datenbank angeben.`)
      if (s.mode === 'table' && (!s.table.trim() || !s.phone_cols.trim())) throw new ValidationError(`Kontaktquelle ${s.name}: Tabelle und Telefonspalten angeben.`)
      if (s.mode === 'query' && !/^\s*(select|with)\b/i.test(s.query)) throw new ValidationError(`Kontaktquelle ${s.name}: Die Abfrage muss mit SELECT beginnen.`)
    } else {
      s.url = s.url.trim()
      if (!/^https?:\/\/\S+$/i.test(s.url)) throw new ValidationError(`Kontaktquelle ${s.name}: Adresse mit http:// oder https:// angeben.`)
    }
  }
  const handsets = new Map<string, string>()
  for (const b of cfg.dect) {
    if (!b.name.trim()) throw new ValidationError('DECT-Basis ohne Namen.')
    if (b.mac && !/^[0-9a-f]{12}$/.test(b.mac)) throw new ValidationError(`DECT-Basis ${b.name}: Die MAC-Adresse hat 12 Zeichen (0–9, A–F), z. B. 7C:2F:80:E0:D6:05.`)
    if (b.handsets.length > DECT_MAX_HANDSETS) throw new ValidationError(`DECT-Basis ${b.name}: höchstens ${DECT_MAX_HANDSETS} Mobilteile.`)
    if (/[\s"<>&]/.test(b.admin_password)) throw new ValidationError(`DECT-Basis ${b.name}: Das Passwort darf keine Leerzeichen oder " < > & enthalten.`)
    for (const n of b.handsets) {
      if (!n) continue
      if (!cfg.extensions.some((e) => e.number === n)) throw new ValidationError(`DECT-Basis ${b.name}: Nebenstelle ${n} gibt es nicht.`)
      if (handsets.has(n)) throw new ValidationError(`Nebenstelle ${n} ist schon einem Mobilteil zugeordnet (${handsets.get(n)}).`)
      handsets.set(n, b.name)
    }
  }
  usedNumbers(cfg)
  const l = cfg.ldap
  if (!Number.isInteger(l.port) || l.port < 1 || l.port > 65535) throw new ValidationError('Ungültiger Port für das LDAP-Telefonbuch.')
  if ([cfg.system.sip_port, cfg.system.tls_port].includes(l.port)) throw new ValidationError('Der LDAP-Port ist schon für SIP belegt.')
  if (l.port === SETTINGS.httpPort) throw new ValidationError('Der LDAP-Port ist schon für die Weboberfläche belegt.')
  const s = cfg.system
  if (s.rtp_start >= s.rtp_end) throw new ValidationError('Der RTP-Portbereich ist ungültig.')
  if (!/^\d{1,3}$/.test(s.country_code)) throw new ValidationError('Ungültige Ländervorwahl.')
  if (s.area_code && !/^[1-9]\d{1,4}$/.test(s.area_code)) throw new ValidationError('Die Ortsvorwahl ohne führende 0 eintragen, z. B. 30 für Berlin.')
  const r = cfg.remote
  if (r.public_url && !/^https?:\/\/[\w.-]+(:\d+)?\/?$/.test(r.public_url)) {
    throw new ValidationError('Die öffentliche Adresse bitte als https://name.example.de angeben (ohne Pfad).')
  }
  if (r.turn_host && !/^[\w.-]+(:\d+)?$/.test(r.turn_host)) throw new ValidationError('Die TURN-Adresse bitte als name.example.de:3478 angeben.')
  if (!(r.turn_port > 0 && r.turn_port < 65536)) throw new ValidationError('Ungültiger TURN-Port.')
  const w = cfg.watchdog
  if (!(w.trunk_grace >= 1 && w.trunk_grace <= 60)) throw new ValidationError('Wartezeit für SIP-Konten: 1 bis 60 Minuten.')
  if (w.notify_email && !/^[^\s@<>]+@[^\s@<>]+$/.test(w.notify_email)) throw new ValidationError('Ungültige E-Mail-Adresse für Störungsmeldungen.')
  const m = cfg.messenger
  if (!(m.max_file_mb >= 1 && m.max_file_mb <= 1024)) throw new ValidationError('Größte Datei im Messenger: 1 bis 1024 MB.')
  if (!(m.min_free_mb >= 100)) throw new ValidationError('Freier Speicher für den Messenger: mindestens 100 MB.')
  if (!(m.quota_mb >= 0)) throw new ValidationError('Speicher je Nebenstelle im Messenger: 0 (unbegrenzt) oder mehr.')
}

export interface ExportFile {
  format: 'phone4all-pbx'
  exported: string
  version: string
  config: PbxConfig
  /** Ansagen und Wartemusik (Pfad relativ zu data/sounds → Base64) */
  files?: Record<string, string>
  /** Termine der zentralen Kalender (Kalender-ID → Termine) */
  calendars?: Record<string, unknown[]>
}

export function stripSecrets(cfg: PbxConfig): PbxConfig {
  const c = structuredClone(cfg)
  for (const e of c.extensions) {
    e.secret = ''
    e.provision_token = ''
    e.provision_pin = ''
    e.devices = []
    e.voicemail.pin = ''
  }
  for (const t of c.trunks) t.password = ''
  for (const b of c.dect) {
    b.token = ''
    b.admin_password = ''
  }
  c.mail.password = ''
  c.integration.token = ''
  c.ldap.password = ''
  return c
}

export class ConfigStore {
  config: PbxConfig
  state: RuntimeState

  constructor() {
    const fresh = !fs.existsSync(PATHS.config)
    const raw = loadJson<Partial<PbxConfig>>(PATHS.config, structuredClone(DEFAULT_CONFIG))
    this.config = withDefaults(raw)
    const before = JSON.stringify(this.config)
    migrateDevices(raw.extensions, this.config.extensions)
    for (const e of this.config.extensions) fillSecrets(e)
    for (const b of this.config.dect) fillDectSecrets(b)
    this.state = { dnd: {}, cfu: {}, ...loadJson<Partial<RuntimeState>>(PATHS.state, {}) }
    // Neu vergebene Geheimnisse sofort speichern, sonst ändern sie sich beim nächsten Start
    if (fresh || JSON.stringify(this.config) !== before) this.save()
  }

  save(): void {
    saveJson(PATHS.config, this.config)
  }

  saveState(): void {
    saveJson(PATHS.state, this.state)
  }

  /** Änderung prüfen und übernehmen; bei Fehler bleibt die alte Konfiguration. */
  update(change: (draft: PbxConfig) => void): PbxConfig {
    const draft = structuredClone(this.config)
    change(draft)
    for (const e of draft.extensions) fillSecrets(e)
    for (const b of draft.dect) fillDectSecrets(b)
    if (draft.integration.enabled && !draft.integration.token) draft.integration.token = newSecret(40)
    validate(draft)
    this.config = draft
    this.save()
    return draft
  }

  upsert(kind: CollectionName, item: Record<string, unknown>): Record<string, unknown> {
    let saved: Record<string, unknown> = item
    this.update((draft) => {
      const list = draft[kind] as unknown as Record<string, unknown>[]
      if (!item.id) {
        saved = { ...item, id: newId() }
        list.push(saved)
      } else {
        const i = list.findIndex((x) => x.id === item.id)
        if (i < 0) throw new ValidationError('Eintrag nicht gefunden.')
        // Leeres Passwortfeld = unverändert lassen
        saved = { ...list[i], ...item }
        if (kind === 'trunks' && !item.password) saved.password = list[i].password
        if (kind === 'extensions' && !item.secret) saved.secret = list[i].secret
        // Einladungslink, PIN und Geräte vergibt nur der Server (die Oberfläche hat evtl. einen alten Stand)
        if (kind === 'extensions') {
          for (const k of ['provision_token', 'provision_expires', 'provision_pin', 'provision_pin_expires', 'devices']) saved[k] = list[i][k]
        }
        // Link und PIN der Basis vergibt nur der Server
        if (kind === 'dect') {
          saved.token = list[i].token
          saved.pin = list[i].pin
          if (!item.admin_password) saved.admin_password = list[i].admin_password
        }
        list[i] = saved
      }
      Object.assign(draft, withDefaults(draft))
    })
    const list = this.config[kind] as unknown as Record<string, unknown>[]
    return list.find((x) => x.id === saved.id) ?? saved
  }

  remove(kind: CollectionName, id: string): void {
    this.update((draft) => {
      const list = draft[kind] as unknown as { id: string }[]
      const i = list.findIndex((x) => x.id === id)
      if (i < 0) throw new ValidationError('Eintrag nicht gefunden.')
      list.splice(i, 1)
      if (kind === 'extensions') {
        const ext = this.config.extensions.find((e) => e.id === id)
        if (ext) {
          for (const g of draft.groups) g.members = g.members.filter((m) => m !== ext.number)
          // Platz des Mobilteils bleibt frei, damit die übrigen ihre Nummer behalten
          for (const b of draft.dect) b.handsets = b.handsets.map((n) => (n === ext.number ? '' : n))
          delete this.state.dnd[ext.number]
          delete this.state.cfu[ext.number]
        }
      }
      if (kind === 'trunks') {
        for (const r of draft.outbound) r.trunks = r.trunks.filter((t) => t !== id)
        for (const r of draft.inbound) if (r.trunk === id) r.trunk = ''
      }
      if (kind === 'appprofiles') for (const e of draft.extensions) if (e.app_profile === id) e.app_profile = ''
      if (kind === 'calendars') for (const p of draft.appprofiles) p.calendars = p.calendars.filter((c) => c !== id)
    })
  }

  // -- Sicherungen -------------------------------------------------------

  backup(reason: string): string {
    fs.mkdirSync(PATHS.backups, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const file = path.join(PATHS.backups, `${stamp}-${reason.replace(/[^a-z0-9-]/gi, '')}.json`)
    saveJson(file, this.exportData(true, false, 'backup'))
    const all = this.backups()
    for (const old of all.slice(BACKUP_KEEP)) fs.rmSync(path.join(PATHS.backups, old.name), { force: true })
    return path.basename(file)
  }

  backups(): { name: string; size: number; time: number }[] {
    try {
      return fs
        .readdirSync(PATHS.backups)
        .filter((f) => f.endsWith('.json'))
        .map((name) => {
          const st = fs.statSync(path.join(PATHS.backups, name))
          return { name, size: st.size, time: st.mtimeMs }
        })
        .sort((a, b) => b.name.localeCompare(a.name))
    } catch {
      return []
    }
  }

  exportData(secrets: boolean, withFiles: boolean, version: string): ExportFile {
    const data: ExportFile = {
      format: 'phone4all-pbx',
      exported: new Date().toISOString(),
      version,
      config: secrets ? structuredClone(this.config) : stripSecrets(this.config),
      calendars: Object.fromEntries(
        this.config.calendars.filter((c) => c.kind === 'events').map((c) => [c.id, loadJson<unknown[]>(path.join(PATHS.calendars, `${c.id}.json`), [])]),
      ),
    }
    if (withFiles) {
      data.files = {}
      for (const [dir, prefix] of [
        [PATHS.sounds, 'custom/'],
        [PATHS.moh, 'moh/'],
      ] as const) {
        for (const f of safeList(dir)) data.files[prefix + f] = fs.readFileSync(path.join(dir, f)).toString('base64')
      }
    }
    return data
  }

  /** Import einer Exportdatei; vorher wird automatisch gesichert. */
  importData(data: ExportFile): void {
    if (!data || data.format !== 'phone4all-pbx' || typeof data.config !== 'object') {
      throw new ValidationError('Das ist keine Konfigurationsdatei der Telefonanlage.')
    }
    const incoming = withDefaults(data.config)
    migrateDevices(data.config.extensions, incoming.extensions)
    // Ohne Passwörter exportiert: vorhandene Geheimnisse übernehmen, sonst neu erzeugen
    for (const e of incoming.extensions) {
      const old = this.config.extensions.find((x) => x.id === e.id || x.number === e.number)
      if (old) {
        e.secret ||= old.secret
        if (!e.provision_token) {
          e.provision_token = old.provision_token
          e.provision_expires = old.provision_expires
        }
        if (!e.devices.length) e.devices = old.devices
        e.provision_pin ||= old.provision_pin
        e.voicemail.pin ||= old.voicemail.pin
      }
    }
    for (const t of incoming.trunks) {
      const old = this.config.trunks.find((x) => x.id === t.id)
      if (old && !t.password) t.password = old.password
    }
    for (const b of incoming.dect) {
      const old = this.config.dect.find((x) => x.id === b.id)
      if (old) {
        b.token ||= old.token
        b.admin_password ||= old.admin_password
      }
    }
    incoming.mail.password ||= this.config.mail.password
    incoming.integration.token ||= this.config.integration.token
    incoming.ldap.password ||= this.config.ldap.password
    this.backup('vor-import')
    this.update((draft) => Object.assign(draft, incoming))
    for (const [id, events] of Object.entries(data.calendars ?? {})) {
      if (/^[\w-]+$/.test(id) && Array.isArray(events) && this.config.calendars.some((c) => c.id === id)) {
        saveJson(path.join(PATHS.calendars, `${id}.json`), events, 0o644)
      }
    }
    for (const [rel, b64] of Object.entries(data.files ?? {})) {
      const [kind, name] = rel.split('/')
      if (!name || !/^[\w.-]+$/.test(name) || (kind !== 'custom' && kind !== 'moh')) continue
      writeAtomic(path.join(kind === 'custom' ? PATHS.sounds : PATHS.moh, name), Buffer.from(b64, 'base64'))
    }
  }

  restoreBackup(name: string): void {
    if (!/^[\w.-]+\.json$/.test(name)) throw new ValidationError('Ungültiger Name.')
    const data = loadJson<ExportFile | null>(path.join(PATHS.backups, name), null)
    if (!data) throw new ValidationError('Sicherung nicht gefunden.')
    this.importData(data)
  }
}

export function safeList(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => !f.startsWith('.'))
  } catch {
    return []
  }
}

export { COLLECTIONS }
