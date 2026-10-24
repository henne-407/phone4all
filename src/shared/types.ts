/** Datentypen, die Hauptprozess und Oberfläche gemeinsam nutzen. */

export interface Contact {
  id: string
  name: string
  phone: string
  mobile: string
  other: string[]
  company: string
  favorite?: boolean
  source?: string // Name des Adressbuchs (nur externe Kontakte)
  readonly?: boolean
}

export interface HistoryEntry {
  time: number // Unix-Zeit in Sekunden
  direction: 'in' | 'out'
  number: string
  name: string
  duration: number
  missed: boolean
}

/** Verlaufseintrag mit erkanntem Kontakt (für die Anzeige). */
export interface HistoryRow extends HistoryEntry {
  contactId?: string
  contactName?: string
}

export type CallState = 'incoming' | 'calling' | 'ringing' | 'established'

export interface CallInfo {
  id: string
  direction: 'in' | 'out'
  number: string
  name: string
  company: string
  state: CallState
  created: number // ms
  established: number | null // ms
  muted: boolean
  held: boolean
  remoteHeld: boolean
  mini: boolean
  transferredTo: string | null
}

export type RegKind = 'ok' | 'busy' | 'error' | 'off'

export interface Banner {
  text: string
  button: string
  action: 'preferences' | 'reconnect'
}

export interface AccountSettings {
  display_name: string
  user: string
  domain: string
  auth_user: string
  port: number
  local_port: number
  transport: 'udp' | 'tcp' | 'tls'
  outbound: string
  stun: string
  mediaenc: string
  regint: number
}

export interface DavAccount {
  id: string
  name: string
  url: string
  user: string
}

export interface SqlSourceConf {
  id: string
  name: string
  host: string
  port: number
  database: string
  user: string
  mode: 'table' | 'query'
  table: string
  name_cols: string
  company_col: string
  phone_cols: string
  query: string
}

export type HomeCard = 'status' | 'today' | 'favorites' | 'recent' | 'events'
export type PageName = 'home' | 'dial' | 'contacts' | 'calendar' | 'history'

export interface Settings {
  account: AccountSettings
  calendar: {
    use_eds: boolean
    caldav: DavAccount[]
    disabled: string[]
    default: string
    reminder_minutes: number
  }
  addressbooks: {
    use_eds: boolean
    carddav: DavAccount[]
    sql: SqlSourceConf[]
    disabled: string[]
  }
  appearance: { theme: string; scheme: 'system' | 'light' | 'dark'; style: DesignStyle }
  audio: { source: string; sink: string; alert: string }
  home: { cards: [HomeCard, boolean][]; start_tab: PageName }
  ringtone: string
  mini_call: boolean
  dnd: boolean
  registered: boolean
  run_in_background: boolean
  autostart: boolean
  /** Watchdog: Verbindung bei Abbruch selbst wiederherstellen */
  watchdog: boolean
  /** Neue Versionen selbst laden und einspielen, sobald kein Gespräch läuft */
  auto_update: boolean
  /** Von einer Phone4all-Telefonanlage eingerichtet (leer = von Hand) */
  provisioning: {
    pbx: string
    extension: string
    server: string
    updated: number
    /** Vorgaben der Anlage für die Ansichten (null = keine) */
    policy: AppPolicy | null
    /** Zentrale Kalender der Anlage */
    calendars: PbxCalendar[]
  }
}

/** Von der Telefonanlage vorgegebene Ansichten (App-Profil) */
export interface AppPolicy {
  pages: PageName[]
  start_tab: PageName
  /** Karten der Startseite in Reihenfolge (leer = wie eingestellt) */
  home_cards: HomeCard[]
  lock_layout: boolean
  lock_account: boolean
}

export interface PbxCalendar {
  id: string
  name: string
  color: string
  writable: boolean
}

/** Gefundene oder abgefragte Telefonanlage, bevor das Konto übernommen wird. */
export interface PbxPreview {
  pbx: string
  version: string
  extension: string
  display_name: string
  server: string
  contacts: number
}

/** Antwort einer Telefonanlage auf die Suche im LAN */
export interface PbxFound {
  name: string
  version: string
  url: string
}

/** classic: Standard-Material-UI, m3: Material Design 3 (Material You) */
export type DesignStyle = 'classic' | 'm3'

export interface CalendarInfo {
  id: string
  name: string
  color: string
  writable: boolean
  group: string
  enabled: boolean
}

export interface CalEvent {
  uid: string
  calendarId: string
  calendarName: string
  color: string
  summary: string
  start: number // ms, lokale Zeit; ganztägig: 00:00
  end: number // ms, exklusiv
  allDay: boolean
  location: string
  description: string
  recurring: boolean
  href: string
  editable: boolean
}

export interface AddressBookInfo {
  id: string
  name: string
  group: string
  enabled: boolean
  count: number
}

export interface AudioDevice {
  id: string // Gerätename für baresip
  name: string // Anzeigename
  isDefault: boolean
}

export interface Platform {
  os: 'linux' | 'darwin' | 'win32'
  eds: boolean // GNOME Online-Konten/Evolution verfügbar
  version: string
  /** Woher die Geräteliste kommt; ohne Liste nur Systemstandard. */
  audioDevices: boolean
  accent: string | null // Systemakzentfarbe
  secureStorage: boolean // Passwörter im Schlüsselbund verschlüsselt
}

/** Watchdog (Diagnose): ok = wieder in Ordnung, info = Maßnahme */
export type WatchLevel = 'ok' | 'info' | 'warning' | 'error'
export type CheckLevel = 'ok' | 'warning' | 'error' | 'off'

export interface WatchEvent {
  time: number
  level: WatchLevel
  text: string
}

export interface WatchCheck {
  id: 'engine' | 'registration' | 'network'
  name: string
  level: CheckLevel
  text: string
  since: number
}

export interface Diagnose {
  enabled: boolean
  checked: number
  repairs: number
  checks: WatchCheck[]
  events: WatchEvent[] // neueste zuerst
}

export interface AppState {
  platform: Platform
  reg: { text: string; kind: RegKind }
  banner: Banner | null
  calls: CallInfo[]
  settings: Settings
  hasPassword: boolean
  favorites: Contact[]
  contactsVersion: number
  hasContacts: boolean
  calendars: CalendarInfo[]
  calendarsLoading: boolean
  calendarErrors: string[]
  defaultCalendar: string | null
  upcoming: CalEvent[] // nächste 7 Tage
  eventsVersion: number
  books: AddressBookInfo[]
  bookErrors: string[]
  syncing: boolean
  devices: { sources: AudioDevice[]; sinks: AudioDevice[] }
  ringtones: { key: string; name: string; description: string; available: boolean }[]
  missedUnseen: boolean
  /** Zusammenfassung des Watchdogs */
  watchdog: { level: CheckLevel; text: string; repairs: number }
  update: UpdateState
}

/** Stand der App-Aktualisierung */
export interface UpdateState {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'
  current: string
  latest: { version: string; notes: string; url: string } | null
  /** Ohne Paket für diese Installation nur Download-Seite öffnen */
  canInstall: boolean
  /** Download-Fortschritt 0…1 */
  progress: number
  error: string
  checked: number
}
