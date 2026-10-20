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
}
