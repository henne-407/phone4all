/** Konfiguration und Laufzeitzustand laden/speichern, Sicherungen, Export und Import. */

import { randomBytes, randomInt } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { loadJson, saveJson, writeAtomic } from './files'
import {
  COLLECTIONS,
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
import { forget, renumber } from './references'
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

export function newPin(digits = 6): string {
  return Array.from({ length: digits }, () => randomInt(10)).join('')
}

/** Fehlende Geheimnisse ergänzen (neue Nebenstellen, Import ohne Passwörter). */
export function fillSecrets(ext: Extension): void {
  if (!ext.secret) ext.secret = newSecret()
  if (!ext.provision_token) ext.provision_token = newSecret(32)
  if (!/^\d{6,}$/.test(ext.provision_pin)) ext.provision_pin = newPin()
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

export function validate(cfg: PbxConfig): void {
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
  const st = cfg.storage
  for (const d of [st.recordings_days, st.voicemail_days]) {
    if (!(Number.isInteger(d) && d >= 0 && d <= 3650)) throw new ValidationError('Aufbewahrung: 0 (unbegrenzt) bis 3650 Tage.')
  }
  if (!(m.max_storage_mb >= 100)) throw new ValidationError('Speicher für den Messenger: mindestens 100 MB.')
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
  /** Daten außerhalb der Konfiguration mitziehen (Chats, Voicemail) */
  hooks = { renumbered: (_from: string, _to: string): void => undefined, removed: (_number: string): void => undefined }

  /** Meldung, wenn die Konfiguration beim Start beschädigt war (für den Watchdog) */
  recovered = ''

  constructor() {
    const fresh = !fs.existsSync(PATHS.config)
    this.config = withDefaults(fresh ? structuredClone(DEFAULT_CONFIG) : this.loadConfig())
    const before = JSON.stringify(this.config)
    for (const e of this.config.extensions) fillSecrets(e)
    for (const b of this.config.dect) fillDectSecrets(b)
    this.state = { dnd: {}, cfu: {}, ...loadJson<Partial<RuntimeState>>(PATHS.state, {}) }
    // Neu vergebene Geheimnisse sofort speichern, sonst ändern sie sich beim nächsten Start
    if (fresh || this.recovered || JSON.stringify(this.config) !== before) this.save()
  }

  /**
   * config.json lesen. Ist sie unlesbar (Platte voll, Stromausfall, Handarbeit), nicht
   * mit leerer Anlage weitermachen: Datei beiseitelegen und die neueste Sicherung laden.
   */
  private loadConfig(): Partial<PbxConfig> {
    try {
      const data = JSON.parse(fs.readFileSync(PATHS.config, 'utf8')) as Partial<PbxConfig>
      if (data && typeof data === 'object' && !Array.isArray(data)) return data
      throw new Error('kein JSON-Objekt')
    } catch (e) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const broken = `${PATHS.config}.defekt-${stamp}`
      fs.copyFileSync(PATHS.config, broken)
      for (const b of this.backups()) {
        const data = loadJson<ExportFile | null>(path.join(PATHS.backups, b.name), null)
        if (data?.format === 'phone4all-pbx' && data.config && typeof data.config === 'object') {
          this.recovered = `Die Konfiguration war beschädigt (${(e as Error).message}) und wurde aus der Sicherung ${b.name} wiederhergestellt. Die beschädigte Datei liegt unter ${path.basename(broken)}.`
          console.error(this.recovered)
          return data.config
        }
      }
      this.recovered = `Die Konfiguration war beschädigt (${(e as Error).message}) und es gibt keine Sicherung. Die Anlage startet leer; die beschädigte Datei liegt unter ${path.basename(broken)}.`
      console.error(this.recovered)
      return structuredClone(DEFAULT_CONFIG)
    }
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
    let moved: [string, string] | null = null
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
        // Link und PIN der Basis vergibt nur der Server
        if (kind === 'dect') {
          saved.token = list[i].token
          saved.pin = list[i].pin
          if (!item.admin_password) saved.admin_password = list[i].admin_password
        }
        list[i] = saved
        // Neue Nummer: Gruppen, Mobilteile, Regeln und Weiterleitungen gehen mit
        if (kind === 'extensions') {
          const from = String(this.config.extensions.find((e) => e.id === item.id)?.number ?? '')
          const to = String(saved.number ?? '')
          if (from && to && from !== to) {
            renumber(draft, from, to)
            moved = [from, to]
          }
        }
      }
      Object.assign(draft, withDefaults(draft))
    })
    if (moved) this.renumberState(...(moved as [string, string]))
    const list = this.config[kind] as unknown as Record<string, unknown>[]
    return list.find((x) => x.id === saved.id) ?? saved
  }

  /** Nicht stören und Umleitungen auf die neue Nummer übertragen */
  private renumberState(from: string, to: string): void {
    const { dnd, cfu } = this.state
    if (dnd[from]) dnd[to] = true
    delete dnd[from]
    if (cfu[from]) cfu[to] = cfu[from]
    delete cfu[from]
    for (const [n, target] of Object.entries(cfu)) if (target === from) cfu[n] = to
    this.saveState()
    this.hooks.renumbered(from, to)
  }

  remove(kind: CollectionName, id: string): void {
    const removed = kind === 'extensions' ? this.config.extensions.find((e) => e.id === id)?.number : undefined
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
          forget(draft, ext.number)
        }
      }
      if (kind === 'trunks') {
        for (const r of draft.outbound) r.trunks = r.trunks.filter((t) => t !== id)
        for (const r of draft.inbound) if (r.trunk === id) r.trunk = ''
      }
      if (kind === 'appprofiles') for (const e of draft.extensions) if (e.app_profile === id) e.app_profile = ''
      if (kind === 'calendars') for (const p of draft.appprofiles) p.calendars = p.calendars.filter((c) => c !== id)
    })
    if (removed) {
      delete this.state.dnd[removed]
      delete this.state.cfu[removed]
      for (const [n, target] of Object.entries(this.state.cfu)) if (target === removed) delete this.state.cfu[n]
      this.saveState()
      this.hooks.removed(removed)
    }
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
        .sort((a, b) => b.time - a.time || b.name.localeCompare(a.name))
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
    // Ohne Passwörter exportiert: vorhandene Geheimnisse übernehmen, sonst neu erzeugen
    for (const e of incoming.extensions) {
      const old = this.config.extensions.find((x) => x.id === e.id || x.number === e.number)
      if (old) {
        e.secret ||= old.secret
        e.provision_token ||= old.provision_token
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
