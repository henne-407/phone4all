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
  /** Eintrag im Telefonbuch der Telefonanlage, den diese App bearbeiten darf */
  pbx?: string
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
  /** Web-Client: Knopf öffnet diese Adresse (z. B. dieselbe Seite über HTTPS) */
  url?: string
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

export type HomeCard = 'status' | 'today' | 'favorites' | 'recent' | 'events' | 'team'
export type PageName = 'home' | 'dial' | 'contacts' | 'calendar' | 'history' | 'messenger'

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
  /** Durchsagen und Gegensprechen der Anlage selbst annehmen */
  auto_answer_page: boolean
  dnd: boolean
  registered: boolean
  run_in_background: boolean
  autostart: boolean
  /** Watchdog: Verbindung bei Abbruch selbst wiederherstellen */
  watchdog: boolean
  /** Neue Versionen selbst laden und einspielen, sobald kein Gespräch läuft */
  auto_update: boolean
  /** Wähl-Links: tel:, callto: und sip: mit dieser App öffnen; Tastenkürzel wählt markierte Nummer ('' = aus) */
  links: { handler: boolean; hotkey: string }
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
    /** Was die Anlage dieser Nebenstelle in der App erlaubt */
    permissions: PbxPermission[]
    /** Messenger der Anlage freigegeben */
    messenger: boolean
    /** Videoanrufe im Messenger (null = aus) */
    video?: VideoAccount | null
    /** Zugang für Apps: SIP über WebSocket mit WebRTC (Web-Client; null = Fernzugang der Anlage aus) */
    remote?: VideoAccount | null
    /** Parken: Weiterleiten an number parkt (null = aus) */
    parking?: { number: string; slots: string[] } | null
    /** Anrufer im CRM öffnen: Adresse mit {nummer}, {e164}, {name} */
    crm?: { url: string; auto: boolean } | null
    /** Voicemail der Nebenstelle in der App */
    voicemail?: boolean
    /** Türsprechstellen (Tür öffnen im Gespräch) */
    doors?: PbxDoor[]
  }
}

export interface PbxDoor {
  number: string
  name: string
  /** Tasten zum Öffnen */
  dtmf: string
}

/** Zugang für Videoanrufe: SIP über WebSocket, Passwort wie das Konto */
export interface VideoAccount {
  /** ws(s)://…/ws */
  websocket: string
  /** <nummer>-video */
  user: string
  domain: string
  ice_servers: { urls: string[]; username?: string; credential?: string }[]
}

export type PbxPermission = 'forward' | 'forward_external' | 'forward_rules' | 'calendar_edit' | 'phonebook_edit' | 'block_numbers' | 'intercom' | 'fax_send'

/** Umleitung, die die Anlage nach Zeit oder Zustand selbst schaltet */
export interface PbxForwardRule {
  id: string
  enabled: boolean
  when: 'schedule' | 'timecondition' | 'dnd' | 'calendar'
  /** forward: umleiten an target · dnd: Nicht stören (ab Anlage 0.10) */
  action?: 'forward' | 'dnd'
  /** Zentraler Kalender und Stichwort im Termin (when = calendar) */
  calendar?: string
  keyword?: string
  days: number[] // 1 = Montag … 7 = Sonntag
  from: string
  to: string
  timecondition: string
  tc_state: 'open' | 'closed'
  target: string
}

/** Umleitungen der Nebenstelle in der Telefonanlage */
export interface PbxForward {
  permissions: PbxPermission[]
  /** Sofort-Umleitung ('' = aus) */
  cfu: string
  /** Was gerade greift (Sofort-Umleitung oder Regel) */
  active: string
  busy: string
  noanswer: string
  rules: PbxForwardRule[]
  targets: { number: string; name: string; kind: 'extension' | 'group' }[]
  timeconditions: { id: string; name: string }[]
  /** Zentrale Kalender für Regeln „bei Termin“ (ab Anlage 0.10) */
  calendars?: { id: string; name: string }[]
  /** Handy klingelt mit (null = keine Handynummer eingetragen) */
  mobile?: { enabled: boolean; number: string } | null
}

export type PbxForwardChange = Partial<Pick<PbxForward, 'cfu' | 'busy' | 'noanswer' | 'rules'>> & { mobile?: boolean }

/** Gruppe der Anlage, in der die Nebenstelle Mitglied ist */
export interface PbxGroup {
  id: string
  number: string
  name: string
  /** angemeldet (klingelt mit) */
  active: boolean
}

/** Chef und Sekretariat, an dem die eigene Nebenstelle beteiligt ist */
export interface PbxBoss {
  id: string
  name: string
  role: 'boss' | 'secretary'
  /** Nebenstelle des anderen */
  partner: string
  /** eingeschaltet: Anrufe für den Chef gehen ans Sekretariat */
  active: boolean
}

/** Offener Rückruf bei besetzt („Rückruf, wenn frei“) */
export interface PbxCallback {
  id: string
  /** Nebenstelle, die zurückruft, sobald sie frei ist */
  to: string
  name: string
  expires: number
}

/** Verpasster Anruf an eine Gruppe (gemeinsame Liste) */
export interface GroupMissed {
  id: string
  group: string
  group_name: string
  time: number
  number: string
  name: string
  claimed_by: string
  done_by: string
  done_how: '' | 'callback' | 'answered' | 'manual'
}

/** Gesendetes Fax */
export interface PbxFax {
  id: string
  time: number
  number: string
  pages: number
  status: 'queued' | 'sending' | 'ok' | 'failed'
  error: string
  attempts: number
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

/** Kollege in der Telefonanlage (Besetztanzeige) */
export interface TeamMember {
  number: string
  name: string
  state: 'idle' | 'ringing' | 'busy' | 'offline'
  dnd: boolean
  /** Umleitung: interne Nummer oder „extern“, leer = keine */
  forward: string
  /** Hinweis aus dem Kalender, z. B. „Urlaub bis 30.10.“ */
  note?: string
}

/** Geparktes Gespräch */
export interface ParkedCall {
  /** Parkplatz, zum Zurückholen wählen */
  slot: string
  number: string
  name: string
  /** Nebenstelle, die geparkt hat */
  by: string
  since: number
  until: number
}

/** Nachricht auf der Voicemail der Anlage */
export interface VoicemailMessage {
  id: string
  folder: 'INBOX' | 'Old'
  unread: boolean
  /** ms */
  time: number
  number: string
  name: string
  /** Sekunden */
  duration: number
  /** Voicemail als Text (wenn die Anlage es kann) */
  text?: string
  transcribing?: boolean
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
  /** Umleitungen in der Telefonanlage (null = keine Anlage oder zu alt) */
  forward: PbxForward | null
  /** Messenger der Telefonanlage: verfügbar, verbunden, ungelesene Nachrichten */
  messenger: { available: boolean; status: MessengerState['status']; unread: number; video: boolean }
  /** Kollegen und geparkte Gespräche (null = keine Anlage oder zu alt) */
  team: { extensions: TeamMember[]; parked: ParkedCall[] } | null
  /** Voicemail der Anlage: neue Nachrichten, version ändert sich bei jeder Änderung (null = keine) */
  voicemail: { unread: number; version: string } | null
  /** Eigene Gruppen zum An- und Abmelden (null = keine Anlage oder zu alt) */
  groups: PbxGroup[] | null
  /** Verpasste Gruppenanrufe: offene, version ändert sich bei jeder Änderung (null = keine Liste) */
  groupMissed: { open: number; version: string } | null
  /** Chef und Sekretariat (leer = nicht beteiligt) */
  boss: PbxBoss[]
  /** Offene Rückrufe bei besetzt (null = Rückruf auf der Anlage ausgeschaltet) */
  callbacks: PbxCallback[] | null
  /** SMS senden erlaubt */
  sms: boolean
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

// -- Messenger (Chats über die Phone4all-Telefonanlage) ---------------------------

export interface ChatUser {
  number: string
  name: string
}

export interface ChatFile {
  id: string
  name: string
  size: number
  type: string
}

export interface ChatMessage {
  seq: number
  room: string
  /** Nebenstelle des Absenders, leer bei Hinweisen der Anlage */
  from: string
  time: number
  text: string
  file?: ChatFile
}

export interface ChatRoom {
  id: string
  kind: 'direct' | 'group'
  /** Gruppenname (Einzelchats: leer) */
  name: string
  members: string[]
  created_by: string
  seq: number
  /** Zuletzt gelesene Nachricht je Nebenstelle */
  read: Record<string, number>
  last: ChatMessage | null
  unread: number
}

export interface MessengerState {
  /** off: nicht eingerichtet, connecting, online, offline: Verbindung unterbrochen */
  status: 'off' | 'connecting' | 'online' | 'offline'
  me: string
  users: ChatUser[]
  online: string[]
  rooms: ChatRoom[]
  /** Raum → Nebenstellen, die gerade tippen */
  typing: Record<string, string[]>
  /** Raum → laufender Videoanruf */
  calls: Record<string, ChatCall>
}

/** Laufender Videoanruf in einem Chat */
export interface ChatCall {
  since: number
  /** wer angefangen hat */
  by: string
  participants: string[]
}
