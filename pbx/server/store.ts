/** Konfiguration und Laufzeitzustand laden/speichern, Sicherungen, Export und Import. */

import { randomBytes, randomInt } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { loadJson, saveJson, writeAtomic } from './files'
import {
  COLLECTIONS,
  type CollectionName,
  DEFAULT_CONFIG,
  type Extension,
  type PbxConfig,
  withDefaults,
} from './model'
import { isInternalNumber } from './numbers'
import { PATHS } from './paths'
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

export function validate(cfg: PbxConfig): void {
  for (const e of cfg.extensions) {
    if (!isInternalNumber(e.number)) throw new ValidationError(`Ungültige Nebenstelle „${e.number}“: 2–6 Ziffern, nicht mit 0 beginnend.`)
    if (!e.name.trim()) throw new ValidationError(`Nebenstelle ${e.number}: Name fehlt.`)
    if (e.secret && e.secret.length < 8) throw new ValidationError(`Nebenstelle ${e.number}: Das SIP-Passwort braucht mindestens 8 Zeichen.`)
    if (/[;\s]/.test(e.secret)) throw new ValidationError(`Nebenstelle ${e.number}: Das SIP-Passwort darf keine Leerzeichen oder „;“ enthalten.`)
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
  }
  usedNumbers(cfg)
  const s = cfg.system
  if (s.rtp_start >= s.rtp_end) throw new ValidationError('Der RTP-Portbereich ist ungültig.')
  if (!/^\d{1,3}$/.test(s.country_code)) throw new ValidationError('Ungültige Ländervorwahl.')
  if (s.area_code && !/^[1-9]\d{1,4}$/.test(s.area_code)) throw new ValidationError('Die Ortsvorwahl ohne führende 0 eintragen, z. B. 30 für Berlin.')
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
  c.mail.password = ''
  c.integration.token = ''
  return c
}

export class ConfigStore {
  config: PbxConfig
  state: RuntimeState

  constructor() {
    const fresh = !fs.existsSync(PATHS.config)
    this.config = withDefaults(loadJson<Partial<PbxConfig>>(PATHS.config, structuredClone(DEFAULT_CONFIG)))
    for (const e of this.config.extensions) fillSecrets(e)
    this.state = { dnd: {}, cfu: {}, ...loadJson<Partial<RuntimeState>>(PATHS.state, {}) }
    if (fresh) this.save()
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
    incoming.mail.password ||= this.config.mail.password
    incoming.integration.token ||= this.config.integration.token
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
