/**
 * Datenmodell der Telefonanlage. Die gesamte Konfiguration ist ein JSON-Dokument
 * (data/config.json), das exportiert und importiert werden kann. Daraus werden die
 * Asterisk-Konfigurationsdateien erzeugt. Wird auch von der Weboberfläche importiert.
 */

export const CONFIG_VERSION = 2

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
  | 'fax'
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
  /**
   * Weiterleitungen bei besetzt / keine Antwort und Regeln (Zeitplan, Zeitsteuerung,
   * Nicht stören). Die Sofort-Umleitung schaltet man per *21 oder in der App.
   */
  forward: { busy: string; noanswer: string; rules: ForwardRule[] }
  record: boolean
  /** Einrichtungs-PIN für die App (zusammen mit der Nebenstelle), gilt einmal */
  provision_pin: string
  /** PIN gültig bis (ms seit 1970); 0 = abgelaufen oder schon benutzt */
  provision_pin_expires: number
  /** Geheimer Teil des Einladungslinks (QR-Code, E-Mail); jedes Gerät bekommt daraus ein eigenes Token */
  provision_token: string
  /** Einladungslink gültig bis (ms seit 1970); 0 = abgelaufen */
  provision_expires: number
  /** Eingerichtete Apps; jede hat ein eigenes Token und lässt sich einzeln abmelden */
  devices: AppDevice[]
  /** App-Profil (Ansichten der Phone4All-App), leer = ohne Vorgaben */
  app_profile: string
  /** Handynummer klingelt mit (paralleles Klingeln über das SIP-Konto) */
  mobile: MobileRing
  /** Türsprechstelle: diese Nebenstelle ist eine Tür, die Apps zeigen „Tür öffnen“ */
  door: DoorSettings
}

/** Handy klingelt bei Anrufen auf die Nebenstelle mit */
export interface MobileRing {
  enabled: boolean
  /** Handynummer, wie gewählt (z. B. 0171…) */
  number: string
  /** Erst nach so vielen Sekunden klingeln */
  delay: number
  /** Annehmen nur mit Taste 1 (sonst nimmt die Mailbox des Handys den Anruf an) */
  confirm: boolean
}

export interface DoorSettings {
  enabled: boolean
  /** Tasten zum Öffnen, die die Apps im Gespräch senden (z. B. „*9“ oder „#“) */
  dtmf: string
}

/** Eine eingerichtete App (Desktop oder Handy) einer Nebenstelle */
export interface AppDevice {
  id: string
  name: string
  /** Geheimer Teil der Profiladresse dieses Geräts */
  token: string
  created: number
  /** Zuletzt gesehen (ms seit 1970) und von welcher Adresse */
  seen: number
  ip: string
}

/** Umleitung (oder „Nicht stören“), die sich nach Zeit, Termin oder Zustand selbst einschaltet. */
export interface ForwardRule {
  id: string
  enabled: boolean
  /** schedule: eigene Zeiten · timecondition: Zeitsteuerung der Anlage · dnd: bei „Nicht stören“ · calendar: bei Termin */
  when: 'schedule' | 'timecondition' | 'dnd' | 'calendar'
  /** forward: an target umleiten · dnd: „Nicht stören“ einschalten (nicht mit when = dnd) */
  action?: 'forward' | 'dnd'
  /** Zentraler Kalender (when = calendar) */
  calendar?: string
  /** Nur Termine, deren Titel diese Wörter enthält, z. B. „Urlaub Anna“ (leer = jeder Termin) */
  keyword?: string
  days: number[] // 1 = Montag … 7 = Sonntag
  from: string // „18:00“
  to: string // „08:00“ (über Mitternacht erlaubt)
  timecondition: string
  /** Bei welchem Zustand der Zeitsteuerung umleiten */
  tc_state: 'open' | 'closed'
  target: string
}

/** Was eine Nebenstelle in der App selbst einstellen darf */
export type AppPermission =
  | 'forward'
  | 'forward_external'
  | 'forward_rules'
  | 'calendar_edit'
  | 'phonebook_edit'
  | 'voicemail_other'
  | 'block_numbers'
  | 'intercom'
  | 'fax_send'

export const APP_PERMISSIONS: [AppPermission, string, string][] = [
  ['forward', 'Umleitung schalten', 'In der App die Sofort-Umleitung ein- und ausschalten'],
  ['forward_external', 'Nach außen umleiten', 'Umleitung auch auf externe Rufnummern, nicht nur auf Nebenstellen'],
  ['forward_rules', 'Umleitungsregeln bearbeiten', 'Weiterleitung bei besetzt/keine Antwort und Regeln nach Zeit'],
  ['calendar_edit', 'Zentrale Kalender bearbeiten', 'Termine in beschreibbaren zentralen Kalendern anlegen und ändern'],
  ['phonebook_edit', 'Telefonbuch bearbeiten', 'Einträge im zentralen Telefonbuch anlegen und ändern'],
  ['voicemail_other', 'Fremde Voicemail abhören', 'Mit *98 andere Mailboxen abhören (mit deren PIN)'],
  ['block_numbers', 'Rufnummern sperren', 'Anrufer aus dem Verlauf auf die Sperrliste der Anlage setzen'],
  ['intercom', 'Durchsage und Gegensprechen', 'Mit *80 direkt zu einer Nebenstelle sprechen, mit *81 eine Durchsage an eine Gruppe'],
  ['fax_send', 'Faxe senden', 'PDF aus der Desktop-App als Fax verschicken'],
]

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
  /** Zusätzliche Rechte in der App für alle Mitglieder */
  permissions: AppPermission[]
  /** Verpasste Anrufe als gemeinsame Liste in den Apps der Mitglieder */
  missed_list: boolean
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
  /** Fax über T.38 (sonst als Ton über G.711) */
  t38: boolean
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

/** Gesperrte Rufnummer für eingehende Anrufe */
export interface BlockedNumber {
  id: string
  /** Rufnummer wie eingegeben; endet sie auf *, gilt sie für alle Nummern mit diesem Anfang */
  number: string
  note: string
  /** ISO-Datum der Sperre */
  created: string
  /** Nebenstelle, die gesperrt hat (leer = Weboberfläche) */
  by: string
}

/** Eingehende Anrufe sperren (Liste unter blocklist) */
export interface BlockingSettings {
  /** Anrufe ohne Rufnummer annehmen oder abweisen */
  anonymous: 'allow' | 'reject'
}

/** Gespräche parken (res_parking): Weiterleiten auf number parkt, number+1 … holt zurück */
export interface ParkingSettings {
  enabled: boolean
  number: string
  slots: number
  /** Danach klingelt es wieder bei dem, der geparkt hat */
  seconds: number
}

/** Wer erfährt, dass jemand 110 oder 112 gewählt hat */
export interface EmergencySettings {
  /** E-Mail-Adressen (leer = keine E-Mail) */
  notify_email: string
  /** Nebenstellen, die eine Nachricht im Messenger bekommen */
  notify_exts: string[]
}

/** Sicherung zusätzlich auf einem anderen Speicher (WebDAV oder S3) */
export interface OffsiteSettings {
  enabled: boolean
  type: 'webdav' | 's3'
  /** WebDAV: Adresse des Ordners · S3: Adresse des Dienstes, z. B. https://s3.eu-central-1.amazonaws.com */
  url: string
  /** WebDAV: Benutzer · S3: Access Key */
  user: string
  /** WebDAV: Passwort · S3: Secret Key */
  password: string
  /** Nur S3 */
  bucket: string
  region: string
  /** Unterordner bzw. Präfix */
  folder: string
  /** So viele Sicherungen bleiben am Ziel */
  keep: number
  /** Verschlüsseln mit diesem Kennwort (leer = unverschlüsselt) */
  passphrase: string
}

export type WebhookEvent = 'call.ringing' | 'call.answered' | 'call.ended' | 'call.missed' | 'voicemail.new' | 'call.blocked' | 'emergency'

export const WEBHOOK_EVENTS: [WebhookEvent, string][] = [
  ['call.ringing', 'Anruf klingelt'],
  ['call.answered', 'Anruf angenommen'],
  ['call.ended', 'Anruf beendet'],
  ['call.missed', 'Anruf verpasst'],
  ['voicemail.new', 'Neue Voicemail'],
  ['call.blocked', 'Anruf gesperrt'],
  ['emergency', 'Notruf gewählt'],
]

/** Webhook: die Anlage meldet Ereignisse per HTTP POST */
export interface Webhook {
  id: string
  name: string
  url: string
  enabled: boolean
  /** Leer = alle Ereignisse */
  events: WebhookEvent[]
  /** Schlüssel für die Signatur (X-Phone4all-Signature), vergibt der Server */
  secret: string
}

/** Faxempfang: eingehende Faxe kommen als PDF per E-Mail */
export interface FaxBox {
  id: string
  name: string
  /** Interne Nummer (optional, z. B. zum Testen) */
  number: string
  /** E-Mail-Adressen für empfangene Faxe (mit Komma getrennt) */
  email: string
  /** Kennung im Kopf gesendeter Faxe, z. B. „+49 30 1234567“ */
  station: string
  /** Kopfzeile gesendeter Faxe, z. B. Firmenname */
  header: string
  /** Rufnummer, die beim Senden angezeigt wird (leer = Standard des SIP-Kontos) */
  cid: string
}

/** Hersteller von Tischtelefonen mit eigener Vorlage */
export type DeskVendor = 'yealink' | 'snom'

export type DeskKeyType = 'blf' | 'speed' | 'park' | 'dnd' | 'none'

/** Funktionstaste am Tischtelefon */
export interface DeskKey {
  type: DeskKeyType
  /** Nebenstelle (blf), Rufnummer (speed), Parkplatz (park) */
  value: string
  label: string
}

/** Tischtelefon, das sich per Auto-Provisioning selbst einrichtet */
export interface DeskPhone {
  id: string
  name: string
  vendor: DeskVendor
  /** MAC-Adresse, 12 Hex-Zeichen */
  mac: string
  extension: string
  keys: DeskKey[]
  /** Passwort der Weboberfläche des Telefons setzen (leer = nicht ändern) */
  admin_password: string
  /** Geheimer Teil der Provisioning-Adresse, vergibt der Server */
  token: string
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
  /** Verschlüsselte Sprache (SRTP) für Telefone im LAN: aus, wenn das Telefon es anbietet, oder Pflicht */
  srtp: 'off' | 'optional' | 'required'
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
  /** Reverse-Proxys (z. B. Newt von Pangolin), deren X-Forwarded-For gilt */
  trusted_proxies: string[]
  // -- Schutz vor Gebührenbetrug
  /** Notbremse: keine Gespräche nach außen außer Notruf */
  outbound_stop: boolean
  /** Gleichzeitige Gespräche nach außen je Nebenstelle und für die ganze Anlage (0 = unbegrenzt) */
  max_calls_ext: number
  max_calls_total: number
  /** Sonderrufnummern (Vorwahlen wie 0900 oder 00881), nur mit Recht „Sonderrufnummern“ */
  premium_prefixes: string[]
  /** Länder für das Recht „international“ (Ländervorwahlen ohne 00, leer = alle) */
  countries: string[]
  /** Ausland nur zwischen 6 und 22 Uhr */
  international_daytime: boolean
  /** Auslandsgespräche pro Tag, danach greift die Notbremse (0 = unbegrenzt) */
  international_per_day: number
  /** Umleitungen und Rufabfolgen dürfen ins Ausland weiterleiten */
  forward_international: boolean
}

/** Gebührenpflichtige Sonderrufnummern in Deutschland und Satellitennetze */
export const DEFAULT_PREMIUM_PREFIXES = ['0900', '0137', '0138', '0180', '0181', '019', '012', '0700', '032', '031', '00870', '00881', '00882', '00883', '00979']

/** EU, EWR, Schweiz, Großbritannien und Nachbarn auf dem Balkan */
export const DEFAULT_COUNTRIES = [
  '30', '31', '32', '33', '34', '351', '352', '353', '354', '356', '357', '358', '359', '36', '370', '371', '372',
  '376', '377', '378', '381', '382', '385', '386', '387', '389', '39', '40', '41', '420', '421', '423', '43', '44',
  '45', '46', '47', '48',
]

export interface UpdateSettings {
  channel: 'stable' | 'beta'
  auto: boolean
  hour: number // Stunde für automatische Updates (0–23)
}

/** Zugriff von unterwegs: Mobil-App über HTTPS (z. B. hinter Pangolin) */
export interface RemoteSettings {
  /** SIP über WebSocket (/ws) und WebRTC für die Mobil-App */
  enabled: boolean
  /** Öffentliche HTTPS-Adresse der Anlage, z. B. https://telefon.example.de (leer = wie aufgerufen) */
  public_url: string
  /** Eingebauter TURN-Server, über den die Sprache von unterwegs läuft */
  turn: boolean
  turn_port: number
  /** TURN-Adresse aus Sicht der App, z. B. telefon.example.de:3478 (leer = Host der öffentlichen Adresse) */
  turn_host: string
}

/** Watchdog: Überwachung und Selbstheilung (Diagnose) */
export interface WatchdogSettings {
  /** Störungen selbst beheben (sonst nur melden) */
  auto_repair: boolean
  /** Minuten, die ein SIP-Konto abgemeldet sein darf, bevor neu angemeldet wird */
  trunk_grace: number
  /** Störungen per E-Mail melden (leer = aus) */
  notify_email: string
}

/** Speicher: wie lange Aufnahmen und Voicemails aufbewahrt werden (0 = unbegrenzt) */
export interface StorageSettings {
  recordings_days: number
  voicemail_days: number
}

// Zustand und Ereignisse des Watchdogs (server/watchdog.ts), auch für die Weboberfläche

/** ok: wieder in Ordnung, info: Maßnahme, warning/error: Störung */
export type WatchLevel = 'ok' | 'info' | 'warning' | 'error'
export type CheckId = 'asterisk' | 'trunks' | 'disk' | 'security' | 'backup'
export type CheckLevel = 'ok' | 'warning' | 'error'

export interface WatchEvent {
  time: number
  level: WatchLevel
  check: CheckId
  text: string
}

export interface WatchCheck {
  id: CheckId
  name: string
  level: CheckLevel
  text: string
  /** Seit wann dieser Zustand besteht (ms) */
  since: number
}

export interface WatchdogStatus {
  auto_repair: boolean
  /** Letzte Prüfung (ms, 0 = noch nie) */
  checked: number
  /** Selbst behobene Störungen seit dem Start */
  repairs: number
  checks: WatchCheck[]
}

/** Schnittstelle für Hausautomation (Home Assistant u. a.) */
export interface IntegrationSettings {
  enabled: boolean
  /** Zugriffsschlüssel (Bearer-Token), vergibt der Server */
  token: string
  /** Anrufe über POST /api/integration/call starten, Ansagen abspielen (announce) */
  call_api: boolean
  /** Schalten über die Schnittstelle: Nicht stören, Umleitung, Zeitsteuerung */
  control: boolean
}

/** Messenger: Chats zwischen den Nebenstellen (server/messenger.ts) */
export interface MessengerSettings {
  enabled: boolean
  /** Größte Datei, die man verschicken kann (MB) */
  max_file_mb: number
  /** Kontingent: Belegen Nachrichten und Anhänge mehr, werden die ältesten gelöscht (MB) */
  max_storage_mb: number
  /** Notbremse: Ist weniger frei, wird höchstens die Hälfte des Messengers gelöscht (MB) */
  min_free_mb: number
  /** Videoanrufe in den Chats (WebRTC über /ws, Konferenzraum je Unterhaltung) */
  video: boolean
  /** Speicher für Anhänge je Nebenstelle (MB, 0 = unbegrenzt) */
  quota_mb: number
}

/** Unterhaltung: Einzelchat (zwei Nebenstellen) oder Gruppe */
export interface ChatRoom {
  id: string
  kind: 'direct' | 'group'
  /** Name der Gruppe (Einzelchats zeigen den Namen der Gegenseite) */
  name: string
  /** Nebenstellen (Nummern) */
  members: string[]
  created: number
  created_by: string
  /** Fortlaufende Nummer der letzten Nachricht */
  seq: number
  /** Zuletzt gelesene Nachricht je Nebenstelle */
  read: Record<string, number>
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
  /** Nebenstelle des Absenders (leer bei Systemnachrichten) */
  from: string
  time: number
  text: string
  file?: ChatFile
}

/** Seiten und Startkarten der Phone4All-App (wie dort benannt) */
export type AppPage = 'home' | 'dial' | 'contacts' | 'calendar' | 'history' | 'messenger'
export type AppHomeCard = 'status' | 'today' | 'favorites' | 'recent' | 'events' | 'team'

export const APP_PAGES: [AppPage, string][] = [
  ['home', 'Start'],
  ['dial', 'Wählen'],
  ['contacts', 'Kontakte'],
  ['calendar', 'Kalender'],
  ['history', 'Verlauf'],
  ['messenger', 'Messenger'],
]

export const APP_HOME_CARDS: [AppHomeCard, string][] = [
  ['status', 'Status und Nicht stören'],
  ['today', 'Heute'],
  ['favorites', 'Favoriten'],
  ['recent', 'Letzte Anrufe'],
  ['events', 'Nächste Termine'],
  ['team', 'Kollegen und geparkte Gespräche'],
]

/** Vorgaben für die Ansichten der App, Nebenstellen wählen ein Profil */
export interface AppProfile {
  id: string
  name: string
  pages: AppPage[]
  start_tab: AppPage
  /** Karten der Startseite in Reihenfolge (leer = wie in der App eingestellt) */
  home_cards: AppHomeCard[]
  /** Startseite in der App nicht anpassbar */
  lock_layout: boolean
  /** Kontodaten in der App nicht änderbar */
  lock_account: boolean
  /** Sichtbare zentrale Kalender (leer = alle) */
  calendars: string[]
  /** Anrufer im CRM öffnen: Adresse mit {nummer}, {e164}, {name} (leer = aus) */
  crm_url: string
  /** Beim Annehmen automatisch öffnen (sonst nur per Knopf) */
  crm_auto: boolean
}

/** Zentraler Kalender; Termine liegen in data/calendars/<id>.json */
export interface CentralCalendar {
  id: string
  name: string
  color: string
  /** events: eigene Termine, holidays: Feiertage des Bundeslandes, subscription: von außen gelesen */
  kind: 'events' | 'holidays' | 'subscription'
  /** Termine dürfen in der App angelegt und geändert werden */
  writable: boolean
  /** Nur bei subscription: woher die Termine kommen */
  source: CalendarSource
}

/** Kalender eines anderen Servers, den die Anlage regelmäßig liest */
export interface CalendarSource {
  /** ics: Abo-Adresse (.ics, webcal://), caldav: Kalender auf einem CalDAV-Server */
  type: 'ics' | 'caldav'
  url: string
  user: string
  password: string
  refresh_minutes: number
}

/** Externe Kontaktquelle (nur lesen): CardDAV, vCard-/CSV-Datei im Netz oder SQL Server */
export interface ContactSource {
  id: string
  name: string
  type: 'carddav' | 'url' | 'mssql'
  enabled: boolean
  /** CardDAV-Konto oder -Adressbuch bzw. Adresse einer .vcf-/.csv-Datei */
  url: string
  user: string
  password: string
  /** SQL Server: Server (auch server\instanz), Port, Datenbank */
  host: string
  port: number
  database: string
  mode: 'table' | 'query'
  table: string
  name_cols: string
  company_col: string
  phone_cols: string
  query: string
  refresh_minutes: number
}

/** Höchstzahl der Mobilteile an einer DECT-Basis (Gigaset N610/N670) */
export const DECT_MAX_HANDSETS = 20

/** Gigaset-DECT-Basis (N610, N670, N870 IP PRO), eingerichtet per Auto-Provisioning */
export interface DectBase {
  id: string
  name: string
  /** MAC-Adresse der Basis, 12 Hex-Zeichen (leer = jede Basis mit dem Link) */
  mac: string
  /** Nebenstellen der Mobilteile; Position = Mobilteil 1, 2, …; leer = Platz frei */
  handsets: string[]
  /** Anmelde-PIN für neue Mobilteile (4 Ziffern), vergibt der Server */
  pin: string
  /** Passwort der Weboberfläche der Basis setzen (leer = nicht ändern) */
  admin_password: string
  /** Geheimer Teil der Provisioning-Adresse, vergibt der Server */
  token: string
}

/** Voicemail als Text: lokal (whisper.cpp) oder über eine OpenAI-kompatible Adresse */
export interface TranscriptionSettings {
  enabled: boolean
  engine: 'local' | 'api'
  /** Lokales Modell: tiny, base, small … (größer = besser und langsamer) */
  model: string
  /** API: Adresse bis /v1, z. B. http://speaches:8000/v1 oder https://api.openai.com/v1 */
  api_url: string
  api_key: string
  /** API: Modellname, z. B. whisper-1 */
  api_model: string
  /** Text auch in die Voicemail-E-Mail (die E-Mail kommt dann von der Anlage statt von Asterisk) */
  email: boolean
}

/** Selbstbedienung im Browser: Nebenstelle und Voicemail-PIN */
export interface PortalSettings {
  enabled: boolean
  /** Auch von außerhalb der lokalen Netze (z. B. über Pangolin) */
  remote: boolean
}

/** Zentrales Telefonbuch per LDAP für DECT- und Tischtelefone (nur lesen) */
export interface LdapSettings {
  enabled: boolean
  port: number
  /** Kennwort für die Anmeldung (leer = ohne Anmeldung) */
  password: string
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
  blocklist: BlockedNumber[]
  webhooks: Webhook[]
  contactsources: ContactSource[]
  appprofiles: AppProfile[]
  calendars: CentralCalendar[]
  dect: DectBase[]
  faxes: FaxBox[]
  deskphones: DeskPhone[]
  mail: MailSettings
  security: SecuritySettings
  updates: UpdateSettings
  /** discovery: im Netz auffindbar · permissions: Rechte aller Nebenstellen in der App */
  /** pin_remote: Einrichtung per PIN auch von außerhalb der lokalen Netze */
  provisioning: { discovery: boolean; permissions: AppPermission[]; pin_remote: boolean }
  remote: RemoteSettings
  watchdog: WatchdogSettings
  integration: IntegrationSettings
  ldap: LdapSettings
  messenger: MessengerSettings
  storage: StorageSettings
  blocking: BlockingSettings
  parking: ParkingSettings
  emergency: EmergencySettings
  offsite: OffsiteSettings
  transcription: TranscriptionSettings
  portal: PortalSettings
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
    srtp: 'off',
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
  blocklist: [],
  webhooks: [],
  contactsources: [],
  appprofiles: [],
  calendars: [],
  dect: [],
  faxes: [],
  deskphones: [],
  mail: { host: '', port: 587, tls: 'starttls', user: '', password: '', from: '' },
  security: {
    ban_enabled: true,
    ban_after: 5,
    ban_window: 10,
    ban_minutes: 60,
    whitelist: ['127.0.0.1'],
    extension_nets: [],
    trusted_proxies: ['127.0.0.1', '::1', '172.16.0.0/12'],
    outbound_stop: false,
    max_calls_ext: 2,
    max_calls_total: 6,
    premium_prefixes: DEFAULT_PREMIUM_PREFIXES,
    countries: DEFAULT_COUNTRIES,
    international_daytime: false,
    international_per_day: 30,
    forward_international: false,
  },
  updates: { channel: 'stable', auto: false, hour: 3 },
  // Umleiten (*21) und Schreiben in zentrale Kalender darf jede Nebenstelle; nach außen
  // umleiten nur mit Freigabe (Schutz vor Umleitungsbetrug mit erbeuteten Zugängen)
  provisioning: { discovery: true, permissions: ['forward', 'forward_rules', 'calendar_edit'], pin_remote: false },
  remote: { enabled: true, public_url: '', turn: true, turn_port: 3478, turn_host: '' },
  watchdog: { auto_repair: true, trunk_grace: 3, notify_email: '' },
  storage: { recordings_days: 0, voicemail_days: 0 },
  integration: { enabled: false, token: '', call_api: false, control: false },
  ldap: { enabled: false, port: 389, password: '' },
  messenger: { enabled: true, max_file_mb: 25, max_storage_mb: 5120, min_free_mb: 200, video: true, quota_mb: 500 },
  blocking: { anonymous: 'allow' },
  parking: { enabled: true, number: '700', slots: 8, seconds: 120 },
  emergency: { notify_email: '', notify_exts: [] },
  offsite: { enabled: false, type: 'webdav', url: '', user: '', password: '', bucket: '', region: '', folder: 'phone4all', keep: 30, passphrase: '' },
  transcription: { enabled: false, engine: 'local', model: 'base', api_url: '', api_key: '', api_model: 'whisper-1', email: true },
  portal: { enabled: false, remote: false },
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
  'blocklist',
  'webhooks',
  'contactsources',
  'appprofiles',
  'calendars',
  'dect',
  'faxes',
  'deskphones',
] as const
export type CollectionName = (typeof COLLECTIONS)[number]

export const SECTIONS = [
  'system', 'mail', 'security', 'updates', 'provisioning', 'remote', 'watchdog', 'integration', 'ldap', 'messenger', 'storage',
  'blocking', 'parking', 'emergency', 'offsite', 'transcription', 'portal',
] as const
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
  fax: 'Fax an E-Mail',
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
        forward: { busy: '', noanswer: '', rules: [] },
        record: false,
        provision_pin: '',
        provision_pin_expires: 0,
        provision_token: '',
        provision_expires: 0,
        devices: [],
        app_profile: '',
        mobile: { enabled: false, number: '', delay: 0, confirm: true },
        door: { enabled: false, dtmf: '' },
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
        permissions: [],
        missed_list: true,
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
        t38: false,
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
    case 'blocklist':
      return { number: '', note: '', created: '', by: '' } satisfies Omit<BlockedNumber, 'id'>
    case 'webhooks':
      return { name: '', url: '', enabled: true, events: [], secret: '' } satisfies Omit<Webhook, 'id'>
    case 'appprofiles':
      return {
        name: '',
        pages: ['home', 'dial', 'contacts', 'calendar', 'history'],
        start_tab: 'home',
        home_cards: [],
        lock_layout: false,
        lock_account: true,
        calendars: [],
        crm_url: '',
        crm_auto: false,
      } satisfies Omit<AppProfile, 'id'>
    case 'calendars':
      return {
        name: '',
        color: '#1a73e8',
        kind: 'events',
        writable: true,
        source: { type: 'ics', url: '', user: '', password: '', refresh_minutes: 60 },
      } satisfies Omit<CentralCalendar, 'id'>
    case 'contactsources':
      return {
        name: '',
        type: 'carddav',
        enabled: true,
        url: '',
        user: '',
        password: '',
        host: '',
        port: 1433,
        database: '',
        mode: 'table',
        table: '',
        name_cols: '',
        company_col: '',
        phone_cols: '',
        query: '',
        refresh_minutes: 60,
      } satisfies Omit<ContactSource, 'id'>
    case 'dect':
      return { name: '', mac: '', handsets: [], pin: '', admin_password: '', token: '' } satisfies Omit<DectBase, 'id'>
    case 'faxes':
      return { name: '', number: '', email: '', station: '', header: '', cid: '' } satisfies Omit<FaxBox, 'id'>
    case 'deskphones':
      return { name: '', vendor: 'yealink', mac: '', extension: '', keys: [], admin_password: '', token: '' } satisfies Omit<DeskPhone, 'id'>
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
      // Kopie, damit sich Einträge keine leeren Listen teilen
      const merged: Record<string, unknown> = { ...structuredClone(blank), ...item }
      for (const [k, v] of Object.entries(blank)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && item[k] && typeof item[k] === 'object') {
          merged[k] = { ...v, ...(item[k] as object) }
        }
      }
      return merged
    }) as never
  }
  // Version 1: Der Messenger löschte schon unter 2 GB freiem Speicher (alter Standard)
  if ((raw.version ?? 1) < 2 && cfg.messenger.min_free_mb === 2048) cfg.messenger.min_free_mb = 200
  cfg.version = CONFIG_VERSION
  return cfg
}
