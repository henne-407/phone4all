/** Einstellungen, Kontakte und Anrufverlauf (JSON-Dateien) plus Passwortablage. */

import { safeStorage } from 'electron'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { contactNumbers, digits, numbersMatch } from '../shared/numbers'
import type { Contact, HistoryEntry, HistoryRow, Settings } from '../shared/types'
import { mergeInto } from './contactImport'
import { loadJson, saveJson } from './files'
import { DIRS } from './paths'

const HISTORY_LIMIT = 300

export const DEFAULT_SETTINGS: Settings = {
  account: {
    display_name: '',
    user: '',
    domain: '',
    auth_user: '',
    port: 0,
    local_port: 0,
    transport: 'udp',
    outbound: '',
    stun: '',
    mediaenc: '',
    regint: 600,
  },
  calendar: { use_eds: true, caldav: [], disabled: [], default: '', reminder_minutes: 10 },
  addressbooks: { use_eds: true, carddav: [], sql: [], disabled: [] },
  appearance: { theme: 'violet', scheme: 'system', style: 'classic' },
  audio: { source: '', sink: '', alert: '' },
  home: { cards: [], start_tab: 'home' },
  ringtone: 'marimba',
  mini_call: true,
  auto_answer_page: true,
  dnd: false,
  registered: true,
  run_in_background: true,
  autostart: false,
  watchdog: true,
  auto_update: true,
  links: { handler: false, hotkey: '' },
  provisioning: { pbx: '', extension: '', server: '', updated: 0, policy: null, calendars: [], permissions: [], messenger: false, video: null, parking: null, crm: null, voicemail: false },
}

type SecretEntry = { enc: string } | { plain: string }

function withDefaults(raw: Record<string, unknown>): Settings {
  const s: Record<string, unknown> = { ...raw }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      s[key] = { ...value, ...((raw[key] as object) ?? {}) }
    } else if (!(key in s)) {
      s[key] = value
    }
  }
  return s as unknown as Settings
}

export class Store {
  readonly settingsPath = path.join(DIRS.config, 'settings.json')
  readonly secretsPath = path.join(DIRS.config, 'secrets.json')
  readonly contactsPath = path.join(DIRS.data, 'contacts.json')
  readonly historyPath = path.join(DIRS.data, 'history.json')
  // Zwischenspeicher der Adressbuch-Kontakte, damit Anrufer auch offline erkannt werden
  readonly externalPath = path.join(DIRS.data, 'addressbooks.json')

  settings: Settings
  contacts: Contact[]
  history: HistoryEntry[]
  external: Contact[]
  private secrets: Record<string, SecretEntry>
  private legacySecrets: Record<string, string>
  private legacyChecked = new Set<string>()
  private legacyRaw: Record<string, unknown>
  private numberIndex: Map<string, [number, string, Contact][]> | null = null
  private mergedCache: Contact[] | null = null

  constructor() {
    const raw = loadJson<Record<string, unknown>>(this.settingsPath, {})
    // Ältere Versionen legten Passwörter ohne Schlüsselbund direkt in settings.json ab
    this.legacySecrets = { ...((raw.secrets as Record<string, string>) ?? {}) }
    if (typeof raw.password === 'string') this.legacySecrets.__sip_password = raw.password
    // Unverändert zurückschreiben, damit die GTK-Version weiter funktioniert
    this.legacyRaw = Object.fromEntries(['secrets', 'password'].filter((k) => k in raw).map((k) => [k, raw[k]]))
    delete raw.secrets
    delete raw.password
    this.settings = withDefaults(raw)
    this.secrets = loadJson(this.secretsPath, {})
    this.contacts = loadJson<Contact[]>(this.contactsPath, []).map(fixContact)
    this.history = loadJson(this.historyPath, [])
    this.external = loadJson<Contact[]>(this.externalPath, []).map(fixContact)
  }

  get account(): Settings['account'] {
    return this.settings.account
  }

  saveSettings(): void {
    saveJson(this.settingsPath, { ...this.settings, ...this.legacyRaw }, true)
  }

  // -- Passwörter --------------------------------------------------------

  /** true, wenn Passwörter mit dem Schlüsselbund des Systems verschlüsselt werden. */
  get secureStorage(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (process.platform === 'linux') return safeStorage.getSelectedStorageBackend() !== 'basic_text'
    return true
  }

  private sipKey(): string {
    return `${this.account.user}@${this.account.domain}`
  }

  getPassword(): string {
    return this.getSecret(this.sipKey(), '__sip_password')
  }

  setPassword(password: string): boolean {
    return this.setSecret(this.sipKey(), password)
  }

  getSecret(key: string, legacyKey?: string): string {
    const entry = this.secrets[key]
    if (entry) {
      if ('plain' in entry) return entry.plain
      try {
        return safeStorage.decryptString(Buffer.from(entry.enc, 'base64'))
      } catch {
        return ''
      }
    }
    // Übernahme aus der GTK-Version: GNOME-Schlüsselbund bzw. settings.json
    if (this.legacyChecked.has(key)) return ''
    this.legacyChecked.add(key)
    const legacy = this.legacySecrets[key] ?? (legacyKey ? this.legacySecrets[legacyKey] : undefined) ?? libsecretLookup(key)
    if (legacy) {
      this.setSecret(key, legacy)
      return legacy
    }
    return ''
  }

  /** Gibt false zurück, wenn kein Schlüsselbund verfügbar war (Ablage im Klartext, 0600). */
  setSecret(key: string, value: string): boolean {
    const secure = this.secureStorage
    this.secrets[key] = secure ? { enc: safeStorage.encryptString(value).toString('base64') } : { plain: value }
    saveJson(this.secretsPath, this.secrets, true)
    return secure
  }

  deleteSecret(key: string): void {
    delete this.secrets[key]
    saveJson(this.secretsPath, this.secrets, true)
  }

  // -- Kontakte ----------------------------------------------------------

  private invalidate(): void {
    this.numberIndex = null
    this.mergedCache = null
  }

  saveContacts(): void {
    this.invalidate()
    this.contacts.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'de'))
    saveJson(this.contactsPath, this.contacts)
  }

  upsertContact(contact: Contact): Contact {
    const c = fixContact({ ...contact })
    if (!c.id) {
      c.id = randomUUID().replace(/-/g, '')
      this.contacts.push(c)
    } else {
      const i = this.contacts.findIndex((x) => x.id === c.id)
      if (i >= 0) this.contacts[i] = c
      else this.contacts.push(c)
    }
    this.saveContacts()
    return c
  }

  deleteContact(id: string): void {
    this.contacts = this.contacts.filter((c) => c.id !== id)
    this.saveContacts()
  }

  /** Nummernindex für schnelle Anrufererkennung (auch bei zehntausenden Kontakten). */
  private index(): Map<string, [number, string, Contact][]> {
    if (!this.numberIndex) {
      const index = new Map<string, [number, string, Contact][]>()
      ;[this.contacts, this.external].forEach((group, prio) => {
        for (const c of group) {
          for (const n of contactNumbers(c)) {
            const key = indexKey(n)
            const list = index.get(key)
            if (list) list.push([prio, n, c])
            else index.set(key, [[prio, n, c]])
          }
        }
      })
      this.numberIndex = index
    }
    return this.numberIndex
  }

  findContact(number: string, localOnly = false): Contact | null {
    const candidates = [...(this.index().get(indexKey(number)) ?? [])].sort((a, b) => a[0] - b[0])
    for (const [prio, n, c] of candidates) {
      if (localOnly && prio) break
      if (numbersMatch(n, number)) return c
    }
    return null
  }

  /** Eigene Kontakte plus Kontakte aus synchronisierten Adressbüchern (ohne Dubletten). */
  allContacts(): Contact[] {
    if (!this.mergedCache) {
      const external = this.external.filter((c) => !contactNumbers(c).some((n) => this.findContact(n, true)))
      this.mergedCache = [...this.contacts, ...external].sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'de'),
      )
    }
    return this.mergedCache
  }

  searchContacts(text: string): Contact[] {
    const contacts = this.allContacts()
    const t = text.trim().toLowerCase()
    if (!t) return contacts
    const d = t.replace(/\D/g, '')
    return contacts.filter((c) => {
      const haystack = [c.name, c.company, c.source ?? ''].join(' ').toLowerCase()
      return haystack.includes(t) || (d !== '' && contactNumbers(c).some((n) => n.replace(/\D/g, '').includes(d)))
    })
  }

  importContacts(imported: Contact[]): [number, number, number] {
    const stats = mergeInto(this.contacts, imported)
    this.saveContacts()
    return stats
  }

  setExternal(contacts: Contact[]): void {
    this.external = contacts.map(fixContact)
    this.invalidate()
    saveJson(this.externalPath, this.external, true)
  }

  // -- Verlauf -----------------------------------------------------------

  addHistory(direction: 'in' | 'out', number: string, name: string, duration: number, missed: boolean): void {
    this.history.unshift({ time: Date.now() / 1000, direction, number, name, duration: Math.floor(duration), missed })
    this.history.length = Math.min(this.history.length, HISTORY_LIMIT)
    saveJson(this.historyPath, this.history)
  }

  clearHistory(): void {
    this.history = []
    saveJson(this.historyPath, this.history)
  }

  /** Verlauf mit erkannten Kontakten für die Oberfläche. */
  historyRows(): HistoryRow[] {
    return this.history.map((e) => {
      const c = this.findContact(e.number)
      return c ? { ...e, contactId: c.id, contactName: c.name } : { ...e }
    })
  }
}

function indexKey(number: string): string {
  const d = digits(number)
  // Rufnummern über die letzten Ziffern, SIP-Namen wie „alice“ exakt
  return d ? d.slice(-6) : '=' + number.trim().toLowerCase()
}

function fixContact(c: Partial<Contact>): Contact {
  return {
    ...c,
    id: c.id ?? '',
    name: c.name ?? '',
    phone: c.phone ?? '',
    mobile: c.mobile ?? '',
    other: c.other ?? [],
    company: c.company ?? '',
  }
}

/** Passwort aus dem GNOME-Schlüsselbund der GTK-Version lesen (einmalige Übernahme). */
function libsecretLookup(key: string): string {
  if (process.platform !== 'linux') return ''
  try {
    return execFileSync('secret-tool', ['lookup', 'xdg:schema', 'de.hpieper.SipTelefon', 'account', key], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return ''
  }
}
