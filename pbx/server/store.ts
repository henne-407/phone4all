/** Konfiguration und Laufzeitzustand laden/speichern, Sicherungen, Export und Import. */

import { createCipheriv, createDecipheriv, randomBytes, randomInt, scryptSync } from 'node:crypto'
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
  type DeskPhone,
  type Extension,
  type ForwardRule,
  type PbxConfig,
  withDefaults,
} from './model'
import { cleanNumber, isInternalNumber } from './numbers'
import { PATHS, SETTINGS } from './paths'
import { forget, renumber } from './references'
import type { RuntimeState } from './routing'

// Je Anlass getrennt aufheben, damit die täglichen Sicherungen die vor Import oder Update
// nicht verdrängen
const BACKUP_KEEP: Record<string, number> = { taeglich: 14 }
const BACKUP_KEEP_OTHER = 10

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

/** Selbst gewählte SIP-Passwörter: mindestens 12 Zeichen (ältere kürzere bleiben gültig) */
export function checkNewSecret(secret: string): void {
  if (secret.length < 12) throw new ValidationError('Das SIP-Passwort braucht mindestens 12 Zeichen (oder leer lassen für ein zufälliges).')
}

export function newPin(digits = 6): string {
  return Array.from({ length: digits }, () => randomInt(10)).join('')
}

/** Fehlende Geheimnisse ergänzen (neue Nebenstellen, Import ohne Passwörter). */
export function fillSecrets(ext: Extension): void {
  if (!ext.secret) ext.secret = newSecret()
  if (!ext.provision_token) renewLink(ext)
  if (!/^\d{6,}$/.test(ext.provision_pin)) renewPin(ext)
  if (!/^\d+$/.test(ext.voicemail.pin)) ext.voicemail.pin = newPin(4)
}

/** Fehlende Geheimnisse einer DECT-Basis ergänzen; MAC einheitlich schreiben. */
export function fillDectSecrets(base: DectBase): void {
  if (!base.token) base.token = newSecret(32)
  if (!/^\d{4}$/.test(base.pin)) base.pin = newPin(4)
  base.mac = normalizeMac(base.mac)
}

/** Fehlendes Token eines Tischtelefons ergänzen; MAC einheitlich schreiben. */
export function fillDeskSecrets(phone: DeskPhone): void {
  if (!phone.token) phone.token = newSecret(32)
  phone.mac = normalizeMac(phone.mac)
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
  for (const f of cfg.faxes) add(f.number, `Fax ${f.name || f.number}`)
  for (const n of parkingNumbers(cfg)) add(n, n === cfg.parking.number ? 'Parken' : `Parkplatz ${n}`)
  return used
}

/** Parknummer und Parkplätze (leer, wenn Parken aus ist) */
export function parkingNumbers(cfg: PbxConfig): string[] {
  const p = cfg.parking
  if (!p.enabled || !isInternalNumber(p.number)) return []
  const first = Number(p.number) + 1
  return [p.number, ...Array.from({ length: Math.max(1, Math.min(50, p.slots)) }, (_, i) => String(first + i))]
}

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+$/

/** „a@b.de, c@d.de“ → Liste; wirft bei ungültigen Adressen */
export function emailList(raw: string, what: string): string[] {
  const list = raw.split(/[,;\s]+/).filter(Boolean)
  for (const m of list) if (!EMAIL.test(m)) throw new ValidationError(`Ungültige E-Mail-Adresse für ${what}: ${m}`)
  return list
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function validateRule(cfg: PbxConfig, num: string, r: ForwardRule): void {
  if (!r.id) r.id = newId()
  if (!['schedule', 'timecondition', 'dnd', 'calendar'].includes(r.when)) throw new ValidationError(`Nebenstelle ${num}: unbekannte Umleitungsregel.`)
  r.action = r.action === 'dnd' ? 'dnd' : 'forward'
  if (r.action === 'dnd') {
    if (r.when === 'dnd') throw new ValidationError(`Nebenstelle ${num}: „Nicht stören“ kann sich nicht selbst einschalten.`)
    r.target = ''
  } else if (!cleanNumber(r.target)) throw new ValidationError(`Nebenstelle ${num}: Bei einer Umleitungsregel fehlt das Ziel.`)
  if (r.when === 'calendar') {
    r.keyword = String(r.keyword ?? '').trim().slice(0, 100)
    if (!cfg.calendars.some((c) => c.id === r.calendar)) throw new ValidationError(`Nebenstelle ${num}: Für die Regel nach Kalender einen Kalender wählen.`)
  } else {
    delete r.calendar
    delete r.keyword
  }
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
  // Sperrlisten-Einträge aus den Apps kommen ohne ID
  for (const b of cfg.blocklist) if (!b.id) b.id = newId()
  for (const kind of COLLECTIONS) {
    for (const item of cfg[kind] as unknown as { id: unknown }[]) {
      if (typeof item.id !== 'string' || !ID.test(item.id)) throw new ValidationError(`Ungültige ID „${String(item.id)}“ (nur Buchstaben, Ziffern, - und _).`)
    }
  }
  if (!['off', 'optional', 'required'].includes(cfg.system.srtp)) throw new ValidationError('SRTP: aus, optional oder Pflicht.')
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
    for (const r of e.forward.rules) validateRule(cfg, e.number, r)
    const mob = e.mobile
    mob.number = cleanNumber(mob.number)
    if (mob.enabled && !/^\+?\d{6,}$/.test(mob.number)) throw new ValidationError(`Nebenstelle ${e.number}: Handynummer fehlt oder ist ungültig.`)
    if (!(Number.isInteger(mob.delay) && mob.delay >= 0 && mob.delay <= 60)) throw new ValidationError(`Nebenstelle ${e.number}: Verzögerung fürs Handy 0 bis 60 Sekunden.`)
    e.door.dtmf = e.door.dtmf.trim()
    if (e.door.enabled && !/^[0-9*#]{1,8}$/.test(e.door.dtmf)) throw new ValidationError(`Nebenstelle ${e.number}: Tasten zum Türöffnen wie *9 oder # angeben.`)
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
    p.crm_url = p.crm_url.trim()
    if (p.crm_url && !/^https?:\/\/\S+$/i.test(p.crm_url)) throw new ValidationError(`App-Profil ${p.name}: Die CRM-Adresse muss mit http:// oder https:// beginnen.`)
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
  for (const f of cfg.faxes) {
    if (!f.name.trim()) throw new ValidationError('Fax ohne Namen.')
    if (f.number && !isInternalNumber(f.number)) throw new ValidationError(`Fax ${f.name}: ungültige Nummer „${f.number}“.`)
    if (!emailList(f.email, `Fax ${f.name}`).length) throw new ValidationError(`Fax ${f.name}: E-Mail-Adresse für empfangene Faxe fehlt.`)
    f.station = f.station.trim().slice(0, 20)
    if (/[^\d +]/.test(f.station)) throw new ValidationError(`Fax ${f.name}: Die Kennung darf nur Ziffern, + und Leerzeichen enthalten.`)
    f.header = f.header.replace(/[\r\n"]/g, ' ').trim().slice(0, 50)
    f.cid = cleanNumber(f.cid)
  }
  const deskMacs = new Set<string>()
  for (const d of cfg.deskphones) {
    if (!d.name.trim()) throw new ValidationError('Tischtelefon ohne Namen.')
    if (!['yealink', 'snom'].includes(d.vendor)) throw new ValidationError(`Tischtelefon ${d.name}: Hersteller wird nicht unterstützt.`)
    if (!/^[0-9a-f]{12}$/.test(d.mac)) throw new ValidationError(`Tischtelefon ${d.name}: Die MAC-Adresse hat 12 Zeichen (0–9, A–F), z. B. 80:5E:C0:12:34:56.`)
    if (deskMacs.has(d.mac)) throw new ValidationError(`Tischtelefon ${d.name}: Die MAC-Adresse ist schon eingetragen.`)
    deskMacs.add(d.mac)
    if (!cfg.extensions.some((e) => e.number === d.extension)) throw new ValidationError(`Tischtelefon ${d.name}: Nebenstelle wählen.`)
    if (/[\s"<>&]/.test(d.admin_password)) throw new ValidationError(`Tischtelefon ${d.name}: Das Passwort darf keine Leerzeichen oder " < > & enthalten.`)
    if (d.keys.length > 60) throw new ValidationError(`Tischtelefon ${d.name}: höchstens 60 Funktionstasten.`)
    for (const k of d.keys) {
      if (!['blf', 'speed', 'park', 'dnd', 'none'].includes(k.type)) throw new ValidationError(`Tischtelefon ${d.name}: unbekannte Tastenart.`)
      k.value = cleanNumber(k.value)
      k.label = k.label.replace(/[\r\n"<>&]/g, ' ').trim().slice(0, 20)
      if ((k.type === 'blf' || k.type === 'speed' || k.type === 'park') && !k.value) throw new ValidationError(`Tischtelefon ${d.name}: Bei einer Taste fehlt die Nummer.`)
    }
  }
  const tr = cfg.transcription
  if (tr.enabled) {
    if (!['local', 'api'].includes(tr.engine)) throw new ValidationError('Voicemail als Text: unbekannte Art.')
    if (!/^[a-z0-9.-]{1,40}$/.test(tr.model)) throw new ValidationError('Voicemail als Text: ungültiges Modell.')
    tr.api_url = tr.api_url.trim().replace(/\/+$/, '')
    if (tr.engine === 'api' && !/^https?:\/\/\S+$/i.test(tr.api_url)) throw new ValidationError('Voicemail als Text: Adresse mit http:// oder https:// angeben, z. B. http://speaches:8000/v1.')
  }
  const pk = cfg.parking
  if (pk.enabled) {
    if (!isInternalNumber(pk.number)) throw new ValidationError(`Parken: ungültige Nummer „${pk.number}“ (2–6 Ziffern, nicht mit 0 beginnend).`)
    if (!(pk.slots >= 1 && pk.slots <= 50)) throw new ValidationError('Parken: 1 bis 50 Parkplätze.')
    if (!(pk.seconds >= 15 && pk.seconds <= 3600)) throw new ValidationError('Parken: Wartezeit 15 bis 3600 Sekunden.')
    if (String(Number(pk.number) + pk.slots).length !== pk.number.length) throw new ValidationError('Parken: Die Parkplätze müssen dieselbe Stellenzahl wie die Parknummer haben.')
  }
  usedNumbers(cfg)
  for (const b of cfg.blocklist) {
    b.number = b.number.trim().replace(/[\s\-/().]/g, '')
    if (!b.created) b.created = new Date().toISOString().slice(0, 10)
    if (!/^\+?\d+\*?$/.test(b.number) || b.number.replace(/\D/g, '').length < 2) {
      throw new ValidationError(`Sperrliste: „${b.number}“ ist keine Rufnummer. Erlaubt sind Ziffern, vorne +, hinten * für alle Nummern mit diesem Anfang.`)
    }
  }
  for (const w of cfg.webhooks) {
    if (!w.name.trim()) throw new ValidationError('Webhook ohne Namen.')
    w.url = w.url.trim()
    if (!/^https?:\/\/\S+$/i.test(w.url)) throw new ValidationError(`Webhook ${w.name}: Adresse mit http:// oder https:// angeben.`)
    if (!w.secret) w.secret = newSecret(32)
  }
  const em = cfg.emergency
  emailList(em.notify_email, 'Notrufe')
  for (const n of em.notify_exts) if (!cfg.extensions.some((e) => e.number === n)) throw new ValidationError(`Notrufe: Nebenstelle ${n} gibt es nicht.`)
  const o = cfg.offsite
  if (o.enabled) {
    o.url = o.url.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/\S+$/i.test(o.url)) throw new ValidationError('Externe Sicherung: Adresse mit http:// oder https:// angeben.')
    if (o.type === 's3' && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(o.bucket)) throw new ValidationError('Externe Sicherung: Name des Buckets fehlt oder ist ungültig.')
    if (!(o.keep >= 1 && o.keep <= 365)) throw new ValidationError('Externe Sicherung: 1 bis 365 Sicherungen aufheben.')
    o.folder = o.folder.trim().replace(/^\/+|\/+$/g, '')
    if (/[^\w./-]|\.\./.test(o.folder)) throw new ValidationError('Externe Sicherung: Der Ordner darf nur Buchstaben, Ziffern, - _ . und / enthalten.')
  }
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
  /** Nicht stören und Sofort-Umleitungen der Nebenstellen */
  state?: RuntimeState
}

/** Anlass einer Sicherung aus dem Dateinamen (2026-10-29T05-30-00-taeglich.json → taeglich) */
export function backupReason(name: string): string {
  return /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-(.*)\.json$/.exec(name)?.[1] ?? ''
}

/** Nur gültige Einträge aus einem eingelesenen Zustand übernehmen */
function cleanState(raw: unknown): RuntimeState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof RuntimeState, unknown>>
  const pick = <T>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> =>
    Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([k, x]) => /^[\w*#+-]+$/.test(k) && ok(x)))
  return {
    dnd: pick(r.dnd, (x): x is boolean => x === true),
    cfu: pick(r.cfu, (x): x is string => typeof x === 'string' && x.trim() !== ''),
    away: pick(r.away, (x): x is string[] => Array.isArray(x) && x.length > 0 && x.every((g) => typeof g === 'string')),
  }
}

/** Export mit Passwörtern: AES-256-GCM, Schlüssel per scrypt aus dem Passwort */
export interface EncryptedExport {
  format: 'phone4all-pbx-encrypted'
  exported: string
  version: string
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string }
  iv: string
  tag: string
  data: string
}

const SCRYPT = { N: 1 << 15, r: 8, p: 1 }
export const EXPORT_PASSWORD_MIN = 10

function exportKey(password: string, salt: Buffer, kdf: { N: number; r: number; p: number }): Buffer {
  return scryptSync(password, salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r })
}

export function encryptExport(data: ExportFile, password: string): EncryptedExport {
  if (password.length < EXPORT_PASSWORD_MIN) throw new ValidationError(`Das Passwort für den Export braucht mindestens ${EXPORT_PASSWORD_MIN} Zeichen.`)
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', exportKey(password, salt, SCRYPT), iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  return {
    format: 'phone4all-pbx-encrypted',
    exported: data.exported,
    version: data.version,
    kdf: { name: 'scrypt', ...SCRYPT, salt: salt.toString('base64') },
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: body.toString('base64'),
  }
}

export function decryptExport(file: EncryptedExport, password: string): ExportFile {
  const { N, r, p } = file.kdf ?? {}
  // Grenzen, damit eine präparierte Datei den Dienst nicht mit scrypt lahmlegt
  if (![N, r, p].every(Number.isInteger) || N > 1 << 17 || r > 16 || p > 4) throw new ValidationError('Die Exportdatei ist beschädigt.')
  try {
    const decipher = createDecipheriv('aes-256-gcm', exportKey(password, Buffer.from(file.kdf.salt, 'base64'), { N, r, p }), Buffer.from(file.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(file.tag, 'base64'))
    const json = Buffer.concat([decipher.update(Buffer.from(file.data, 'base64')), decipher.final()]).toString('utf8')
    return JSON.parse(json) as ExportFile
  } catch {
    throw new ValidationError('Das Passwort stimmt nicht oder die Datei ist beschädigt.')
  }
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
  for (const d of c.deskphones) {
    d.token = ''
    d.admin_password = ''
  }
  c.transcription.api_key = ''
  c.mail.password = ''
  c.integration.token = ''
  c.ldap.password = ''
  c.offsite.password = ''
  c.offsite.passphrase = ''
  for (const w of c.webhooks) w.secret = ''
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
    const raw = fresh ? structuredClone(DEFAULT_CONFIG) : this.loadConfig()
    this.config = withDefaults(raw)
    // Parken ist neu und standardmäßig an: belegen bestehende Nummern die Parkplätze, bleibt es aus
    if (!raw.parking) {
      try {
        usedNumbers(this.config)
      } catch {
        this.config.parking.enabled = false
      }
    }
    const before = JSON.stringify(this.config)
    migrateDevices(raw.extensions, this.config.extensions)
    for (const e of this.config.extensions) fillSecrets(e)
    for (const b of this.config.dect) fillDectSecrets(b)
    for (const d of this.config.deskphones) fillDeskSecrets(d)
    this.state = cleanState(loadJson<unknown>(PATHS.state, {}))
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
    for (const d of draft.deskphones) fillDeskSecrets(d)
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
        if (kind === 'extensions' && item.secret) checkNewSecret(String(item.secret))
        saved = { ...item, id: newId() }
        list.push(saved)
      } else {
        const i = list.findIndex((x) => x.id === item.id)
        if (i < 0) throw new ValidationError('Eintrag nicht gefunden.')
        // Leeres Passwortfeld = unverändert lassen
        saved = { ...list[i], ...item }
        if (kind === 'trunks' && !item.password) saved.password = list[i].password
        if (kind === 'extensions' && !item.secret) saved.secret = list[i].secret
        if (kind === 'extensions' && item.secret && item.secret !== list[i].secret) checkNewSecret(String(item.secret))
        // Einladungslink, PIN und Geräte vergibt nur der Server (die Oberfläche hat evtl. einen alten Stand)
        if (kind === 'extensions') {
          for (const k of ['provision_token', 'provision_expires', 'provision_pin', 'provision_pin_expires', 'devices']) saved[k] = list[i][k]
        }
        // Den Schlüssel des Webhooks vergibt nur der Server
        if (kind === 'webhooks') saved.secret = list[i].secret
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
    const { dnd, cfu, away } = this.state
    if (dnd[from]) dnd[to] = true
    delete dnd[from]
    if (away[from]) away[to] = away[from]
    delete away[from]
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
      if (kind === 'calendars') {
        for (const p of draft.appprofiles) p.calendars = p.calendars.filter((c) => c !== id)
        for (const e of draft.extensions) e.forward.rules = e.forward.rules.filter((r) => r.when !== 'calendar' || r.calendar !== id)
      }
      if (kind === 'extensions') {
        const ext = this.config.extensions.find((e) => e.id === id)
        if (ext) draft.emergency.notify_exts = draft.emergency.notify_exts.filter((n) => n !== ext.number)
      }
    })
    if (removed) {
      delete this.state.dnd[removed]
      delete this.state.cfu[removed]
      delete this.state.away[removed]
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
    const seen: Record<string, number> = {}
    for (const old of this.backups()) {
      const kind = backupReason(old.name)
      seen[kind] = (seen[kind] ?? 0) + 1
      if (seen[kind] > (BACKUP_KEEP[kind] ?? BACKUP_KEEP_OTHER)) fs.rmSync(path.join(PATHS.backups, old.name), { force: true })
    }
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
      state: structuredClone(this.state),
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
    for (const d of incoming.deskphones) {
      const old = this.config.deskphones.find((x) => x.id === d.id)
      if (old) {
        d.token ||= old.token
        d.admin_password ||= old.admin_password
      }
    }
    incoming.transcription.api_key ||= this.config.transcription.api_key
    incoming.mail.password ||= this.config.mail.password
    incoming.integration.token ||= this.config.integration.token
    incoming.ldap.password ||= this.config.ldap.password
    incoming.offsite.password ||= this.config.offsite.password
    incoming.offsite.passphrase ||= this.config.offsite.passphrase
    for (const w of incoming.webhooks) w.secret ||= this.config.webhooks.find((x) => x.id === w.id)?.secret ?? ''
    this.backup('vor-import')
    this.update((draft) => Object.assign(draft, incoming))
    if (data.state) {
      // Nur für Nebenstellen, die es nach dem Import gibt
      const known = new Set(this.config.extensions.map((e) => e.number))
      const state = cleanState(data.state)
      this.state.dnd = Object.fromEntries(Object.entries(state.dnd).filter(([n]) => known.has(n)))
      this.state.cfu = Object.fromEntries(Object.entries(state.cfu).filter(([n]) => known.has(n)))
      this.state.away = Object.fromEntries(Object.entries(state.away).filter(([n]) => known.has(n)))
      this.saveState()
    }
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
