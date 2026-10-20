/**
 * Datenmodell der Telefonanlage. Die gesamte Konfiguration ist ein JSON-Dokument
 * (data/config.json), das exportiert und importiert werden kann. Daraus werden die
 * Asterisk-Konfigurationsdateien erzeugt. Wird auch von der Weboberfläche importiert.
 */

export const CONFIG_VERSION = 1

/** Wohin ein Anruf geht (Ziel in Anrufabläufen, Fallbacks, Sprachmenüs …). */
export type DestinationType =
  | 'extension'
  | 'group'
  | 'ivr'
  | 'timecondition'
  | 'voicemail'
  | 'conference'
  | 'announcement'
  | 'external'
  | 'hangup'

export interface Destination {
  type: DestinationType
  /** ID bzw. Nummer des Ziels; bei 'external' die Rufnummer */
  target: string
}

export type Permission = 'internal' | 'national' | 'international'

export interface Extension {
  id: string
  number: string
  name: string
  email: string
  secret: string
  /** Wie viele Geräte (App, Tischtelefon …) gleichzeitig angemeldet sein dürfen */
  max_devices: number
  ring_seconds: number
  /** Rufnummer, die bei Anrufen nach außen angezeigt wird (leer = Standard des SIP-Kontos) */
  outbound_cid: string
  permission: Permission
  allow_premium: boolean
  voicemail: { enabled: boolean; pin: string; attach: boolean }
  /** Feste Weiterleitungen; die Sofort-Weiterleitung schaltet man per *21 am Telefon */
  forward: { busy: string; noanswer: string }
  record: boolean
  /** Einrichtungs-PIN für die App (zusammen mit der Nebenstelle) */
  provision_pin: string
  /** Geheimer Teil des Einrichtungslinks */
  provision_token: string
}

export type GroupMode = 'all' | 'sequential' | 'queue'
export type QueueStrategy = 'ringall' | 'linear' | 'rrmemory' | 'leastrecent' | 'fewestcalls' | 'random'

export interface Group {
  id: string
  number: string
  name: string
  members: string[] // Nummern der Nebenstellen
  mode: GroupMode
  strategy: QueueStrategy // nur Warteschlange
  member_seconds: number // reihum: Klingeldauer je Teilnehmer
  timeout: number // Sekunden bis zum Ausweichziel
  name_prefix: string // vor den Anrufernamen gesetzt, z. B. „Vertrieb: “
  announcement: string // Ansage vor dem Klingeln (ID, optional)
  fallback: Destination
}

export type NumberFormat = 'e164' | 'national' | 'intl00' | 'e164_no_plus'
export type Transport = 'udp' | 'tcp' | 'tls'

export interface Trunk {
  id: string
  name: string
  provider: string // Schlüssel der Vorlage
  enabled: boolean
  register: boolean
  registrar: string
  port: number
  transport: Transport
  outbound_proxy: string
  username: string
  auth_username: string
  password: string
  from_domain: string
  from_user: string
  /** Rufnummern (MSN/DDI) dieses Kontos, gespeichert wie eingegeben */
  numbers: string[]
  /** Angezeigte Nummer, wenn die Nebenstelle keine eigene hat */
  default_cid: string
  /** Format der gewählten und angezeigten Nummern zum Anbieter */
  number_format: NumberFormat
  /** Woher die angerufene Nummer bei eingehenden Anrufen stammt */
  did_source: 'ruri' | 'to'
  /** Weiterleitungen nach außen: Rufnummer des Anrufers zeigen (CLIP no screening) */
  forward_caller_id: boolean
  codecs: string[]
  srtp: boolean
  max_channels: number
  /** Nur IP-Prüfung statt Registrierung (SIP-Trunk mit fester IP) */
  ip_auth: boolean
  /** Eingehend ohne passende Rufnummer */
  inbound_default: Destination
  /** Zusätzliche Zeilen für den Endpunkt in pjsip.conf (Experten) */
  advanced: string
}

export interface InboundRoute {
  id: string
  name: string
  number: string // angerufene Rufnummer (leer = alle Nummern des Kontos)
  trunk: string // leer = jedes Konto
  caller: string // nur für Anrufer mit dieser Nummer (Präfix), optional
  name_prefix: string
  destination: Destination
}

export interface OutboundRoute {
  id: string
  name: string
  /** Rufnummernanfänge wie gewählt (z. B. „015“, „00“, „+49“), leer = alle */
  prefixes: string[]
  trunks: string[] // Reihenfolge = Ausweich-Reihenfolge
  extensions: string[] // leer = alle Nebenstellen
}

export interface IvrOption {
  digit: string
  destination: Destination
}

export interface Ivr {
  id: string
  number: string // interne Nummer zum Testen (optional)
  name: string
  announcement: string
  options: IvrOption[]
  timeout: number
  repeats: number
  direct_dial: boolean
  timeout_destination: Destination
  invalid_destination: Destination
}

export interface TimeRule {
  days: number[] // 1 = Montag … 7 = Sonntag
  from: string // „08:00“
  to: string // „17:00“
}

export interface TimeCondition {
  id: string
  name: string
  rules: TimeRule[]
  holidays: boolean // an gesetzlichen Feiertagen geschlossen
  closed_dates: string[] // „2026-12-24“ oder „2026-12-24..2026-12-31“
  override: 'auto' | 'open' | 'closed'
  open: Destination
  closed: Destination
}

export interface Conference {
  id: string
  number: string
  name: string
  pin: string
  admin_pin: string
  max_members: number
  record: boolean
}

export interface Announcement {
  id: string
  name: string
  /** Dateiname ohne Endung in data/sounds/custom */
  file: string
  /** Nach der Ansage (bei Verwendung als Ziel) */
  next: Destination
}

export interface PhonebookEntry {
  id: string
  name: string
  company: string
  phone: string
  mobile: string
}

export interface SystemSettings {
  name: string
  /** Adresse, unter der Telefone die Anlage erreichen (leer = automatisch) */
  sip_host: string
  sip_port: number
  tls_port: number
  rtp_start: number
  rtp_end: number
  /** Öffentliche IP/DNS-Name für NAT (leer = keine NAT-Umsetzung) */
  external_address: string
  local_nets: string[]
  country_code: string // „49“
  area_code: string // Ortsvorwahl ohne 0, z. B. „30“
  state: string // Bundesland für Feiertage, z. B. „NI“
  language: string
  codecs: string[]
  /** Zeitzone für Zeitsteuerung und Voicemail */
  timezone: string
}

export interface MailSettings {
  host: string
  port: number
  tls: 'starttls' | 'tls' | 'none'
  user: string
  password: string
  from: string
}

export interface SecuritySettings {
  ban_enabled: boolean
  ban_after: number // Fehlversuche …
  ban_window: number // … innerhalb von Minuten
  ban_minutes: number
  whitelist: string[] // IPs/Netze, die nie gesperrt werden
  /** Nebenstellen nur aus diesen Netzen zulassen (leer = überall) */
  extension_nets: string[]
}

export interface UpdateSettings {
  channel: 'stable' | 'beta'
  auto: boolean
  hour: number // Stunde für automatische Updates (0–23)
}

export interface PbxConfig {
  version: number
  system: SystemSettings
  extensions: Extension[]
  groups: Group[]
  trunks: Trunk[]
  inbound: InboundRoute[]
  outbound: OutboundRoute[]
  ivrs: Ivr[]
  timeconditions: TimeCondition[]
  conferences: Conference[]
  announcements: Announcement[]
  phonebook: PhonebookEntry[]
  mail: MailSettings
  security: SecuritySettings
  updates: UpdateSettings
  provisioning: { discovery: boolean }
}

export const HANGUP: Destination = { type: 'hangup', target: '' }

export const DEFAULT_CONFIG: PbxConfig = {
  version: CONFIG_VERSION,
  system: {
    name: 'Phone4all',
    sip_host: '',
    sip_port: 5060,
    tls_port: 5061,
    rtp_start: 10000,
    rtp_end: 10999,
    external_address: '',
    local_nets: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
    country_code: '49',
    area_code: '',
    state: 'NI',
    language: 'de',
    codecs: ['opus', 'g722', 'alaw', 'ulaw'],
    timezone: 'Europe/Berlin',
  },
  extensions: [],
  groups: [],
  trunks: [],
  inbound: [],
  outbound: [],
  ivrs: [],
  timeconditions: [],
  conferences: [],
  announcements: [],
  phonebook: [],
  mail: { host: '', port: 587, tls: 'starttls', user: '', password: '', from: '' },
  security: {
    ban_enabled: true,
    ban_after: 5,
    ban_window: 10,
    ban_minutes: 60,
    whitelist: ['127.0.0.1'],
    extension_nets: [],
  },
  updates: { channel: 'stable', auto: false, hour: 3 },
  provisioning: { discovery: true },
}

/** Listen der Konfiguration, die die Weboberfläche einheitlich bearbeitet. */
export const COLLECTIONS = [
  'extensions',
  'groups',
  'trunks',
  'inbound',
  'outbound',
  'ivrs',
  'timeconditions',
  'conferences',
  'announcements',
  'phonebook',
] as const
export type CollectionName = (typeof COLLECTIONS)[number]

export const SECTIONS = ['system', 'mail', 'security', 'updates', 'provisioning'] as const
export type SectionName = (typeof SECTIONS)[number]

export const DESTINATION_LABELS: Record<DestinationType, string> = {
  extension: 'Nebenstelle',
  group: 'Gruppe',
  ivr: 'Sprachmenü',
  timecondition: 'Zeitsteuerung',
  voicemail: 'Voicemail',
  conference: 'Konferenz',
  announcement: 'Ansage',
  external: 'Externe Rufnummer',
  hangup: 'Auflegen',
}

export const BUNDESLAENDER: Record<string, string> = {
  BW: 'Baden-Württemberg',
  BY: 'Bayern',
  BE: 'Berlin',
  BB: 'Brandenburg',
  HB: 'Bremen',
  HH: 'Hamburg',
  HE: 'Hessen',
  MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen',
  NW: 'Nordrhein-Westfalen',
  RP: 'Rheinland-Pfalz',
  SL: 'Saarland',
  SN: 'Sachsen',
  ST: 'Sachsen-Anhalt',
  SH: 'Schleswig-Holstein',
  TH: 'Thüringen',
}

/** Leere Einträge für „Neu anlegen“ (IDs und Geheimnisse vergibt der Server). */
export function blankItem(kind: CollectionName): Record<string, unknown> {
  switch (kind) {
    case 'extensions':
      return {
        number: '',
        name: '',
        email: '',
        secret: '',
        max_devices: 3,
        ring_seconds: 25,
        outbound_cid: '',
        permission: 'national',
        allow_premium: false,
        voicemail: { enabled: true, pin: '', attach: true },
        forward: { busy: '', noanswer: '' },
        record: false,
        provision_pin: '',
        provision_token: '',
      } satisfies Omit<Extension, 'id'>
    case 'groups':
      return {
        number: '',
        name: '',
        members: [],
        mode: 'all',
        strategy: 'ringall',
        member_seconds: 15,
        timeout: 30,
        name_prefix: '',
        announcement: '',
        fallback: HANGUP,
      } satisfies Omit<Group, 'id'>
    case 'trunks':
      return {
        name: '',
        provider: 'generic',
        enabled: true,
        register: true,
        registrar: '',
        port: 0,
        transport: 'udp',
        outbound_proxy: '',
        username: '',
        auth_username: '',
        password: '',
        from_domain: '',
        from_user: '',
        numbers: [],
        default_cid: '',
        number_format: 'e164',
        did_source: 'ruri',
        forward_caller_id: false,
        codecs: ['alaw', 'g722', 'ulaw'],
        srtp: false,
        max_channels: 0,
        ip_auth: false,
        inbound_default: HANGUP,
        advanced: '',
      } satisfies Omit<Trunk, 'id'>
    case 'inbound':
      return { name: '', number: '', trunk: '', caller: '', name_prefix: '', destination: HANGUP } satisfies Omit<
        InboundRoute,
        'id'
      >
    case 'outbound':
      return { name: '', prefixes: [], trunks: [], extensions: [] } satisfies Omit<OutboundRoute, 'id'>
    case 'ivrs':
      return {
        number: '',
        name: '',
        announcement: '',
        options: [],
        timeout: 5,
        repeats: 2,
        direct_dial: false,
        timeout_destination: HANGUP,
        invalid_destination: HANGUP,
      } satisfies Omit<Ivr, 'id'>
    case 'timeconditions':
      return {
        name: '',
        rules: [{ days: [1, 2, 3, 4, 5], from: '08:00', to: '17:00' }],
        holidays: true,
        closed_dates: [],
        override: 'auto',
        open: HANGUP,
        closed: HANGUP,
      } satisfies Omit<TimeCondition, 'id'>
    case 'conferences':
      return { number: '', name: '', pin: '', admin_pin: '', max_members: 0, record: false } satisfies Omit<
        Conference,
        'id'
      >
    case 'announcements':
      return { name: '', file: '', next: HANGUP } satisfies Omit<Announcement, 'id'>
    case 'phonebook':
      return { name: '', company: '', phone: '', mobile: '' } satisfies Omit<PhonebookEntry, 'id'>
  }
}

/** Ergänzt fehlende Felder (ältere Exporte, Handarbeit) mit Standardwerten. */
export function withDefaults(raw: Partial<PbxConfig>): PbxConfig {
  const cfg = { ...DEFAULT_CONFIG, ...raw } as PbxConfig
  for (const key of SECTIONS) {
    cfg[key] = { ...DEFAULT_CONFIG[key], ...((raw[key] as object) ?? {}) } as never
  }
  for (const kind of COLLECTIONS) {
    const list = Array.isArray(raw[kind]) ? (raw[kind] as unknown as Record<string, unknown>[]) : []
    const blank = blankItem(kind)
    cfg[kind] = list.map((item) => {
      const merged: Record<string, unknown> = { ...blank, ...item }
      for (const [k, v] of Object.entries(blank)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && item[k] && typeof item[k] === 'object') {
          merged[k] = { ...v, ...(item[k] as object) }
        }
      }
      return merged
    }) as never
  }
  cfg.version = CONFIG_VERSION
  return cfg
}
