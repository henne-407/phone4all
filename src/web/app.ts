/**
 * Unterbau des Web-Clients: übernimmt im Browser die Rolle des Electron-Hauptprozesses
 * (src/main/app.ts). Einstellungen, Kontakte, Verlauf, Profil der Anlage und Messenger
 * nutzen denselben Code wie die Desktop-App; Telefonie und Kalender sind eigene
 * Browser-Fassungen. Die Oberfläche spricht ihn über window.bridge an wie sonst per IPC.
 */

import { Messenger } from '../main/messenger'
import type { NotifyOptions, PhoneUi } from '../main/phone'
import { Provisioning } from '../main/provisioning'
import { Store } from '../main/store'
import type { RendererEvents } from '../main/api'
import { contactNumbers } from '../shared/numbers'
import type { AppState, AudioDevice, ChatCall, ChatMessage, Contact, Diagnose, HomeCard, PageName } from '../shared/types'
import { WebCalendar } from './calendar'
import { WebPhone } from './phone'
import { clearAll } from './shims/files'
import { ringtoneList } from './sound'

declare const __APP_VERSION__: string

const DEFAULT_CARDS: [HomeCard, boolean][] = [
  ['status', true],
  ['today', true],
  ['favorites', true],
  ['recent', true],
  ['events', true],
  ['team', true],
]

const URL_SECRET = 'pbx:url'
/** So lange klingelt ein Videoanruf */
const RING_MS = 45000

/** Profil-Adresse immer über diese Seite (gleicher Ursprung, auch wenn die Anlage eine öffentliche Adresse nennt) */
export function sameOriginProfileUrl(url: string): string {
  const token = /\/provision\/([\w-]+)\/?$/.exec(url)?.[1]
  return token ? `${location.origin}/provision/${token}` : url
}

/** Store mit Ablage im Browser; die Profil-Adresse zeigt immer auf diese Seite */
class WebStore extends Store {
  constructor() {
    super()
    // Was es im Browser nicht gibt, gar nicht erst einschalten
    this.settings.mini_call = false
    this.settings.calendar.use_eds = false
    this.settings.addressbooks.use_eds = false
    this.settings.run_in_background = false
    this.settings.autostart = false
    this.settings.auto_update = false
  }

  override setSecret(key: string, value: string): boolean {
    return super.setSecret(key, key === URL_SECRET ? sameOriginProfileUrl(value) : value)
  }
}

type Listener = (...args: unknown[]) => void

export class WebApp {
  readonly store = new WebStore()
  readonly calendar = new WebCalendar(this.store)
  readonly phone: WebPhone
  readonly provisioning: Provisioning
  readonly messenger: Messenger
  /** Raum des laufenden Videoanrufs in der Oberfläche */
  videoCall: string | null = null
  /** Unterhaltung, die gerade offen ist (keine Benachrichtigung dafür) */
  openChat: string | null = null
  private listeners = new Map<string, Set<Listener>>()
  private notifications = new Map<string, Notification>()
  private devices: { sources: AudioDevice[]; sinks: AudioDevice[] } = { sources: [], sinks: [] }
  private contactsVersion = 0
  private eventsVersion = 0
  private missedUnseen = false
  private pendingState = false
  private started = false
  private lastPresence = 0
  /** Per Drag & Drop abgelegte Dateien (statt Dateipfaden wie in Electron) */
  private files = new Map<string, File>()
  private fileCounter = 0

  constructor() {
    const ui: PhoneUi = {
      stateChanged: () => this.stateChanged(),
      historyChanged: (missed) => this.historyChanged(missed),
      toast: (text) => this.send('toast', text),
      notify: (opts) => this.notify(opts),
      withdraw: (tag) => this.withdraw(tag),
      isMainActive: () => document.visibilityState === 'visible' && document.hasFocus(),
      presentMain: () => window.focus(),
      showPopup: () => undefined,
      closePopup: () => undefined,
      showPage: (page) => this.showPage(page as PageName),
      newEvent: (prefill) => {
        this.showPage('calendar')
        this.send('new-event', prefill)
      },
      showCalendarEvent: () => this.showPage('calendar'),
      established: (call) => {
        const crm = this.store.settings.provisioning.crm
        if (crm?.auto && call.direction === 'in' && call.number.replace(/\D/g, '').length > 5) this.openCrm(call.number, call.name)
      },
    }
    this.phone = new WebPhone(this.store, ui)
    this.provisioning = new Provisioning(
      {
        store: this.store,
        // Vor dem Start (Anmeldeseite) noch nicht: start() verbindet ohnehin
        restartEngine: () => this.started && this.phone.restartEngine(),
        stateChanged: () => {
          this.messenger.update()
          this.stateChanged()
        },
        phonebookChanged: () => this.syncBook(),
        calendarsChanged: () => void this.calendar.reload(),
        eventsChanged: () => this.calendar.emit('events-changed'),
        toast: (text) => this.send('toast', text),
      },
      'data/pbx-phonebook.json',
    )
    this.calendar.pbxSource = () => {
      const p = this.store.settings.provisioning
      const url = this.provisioning.url
      return url && p.calendars.length ? { url, name: p.pbx, calendars: p.calendars } : null
    }
    this.messenger = new Messenger({
      url: () => this.provisioning.usableUrl,
      enabled: () => Boolean(this.store.settings.provisioning.messenger),
    })
    this.messenger.on('changed', () => {
      this.send('messenger', this.messenger.state)
      this.stateChanged()
    })
    this.messenger.on('reset', () => this.send('messenger-reset'))
    this.messenger.on('message', (m: ChatMessage) => this.onChatMessage(m))
    this.messenger.on('call', (room: string, call: ChatCall | null, before: ChatCall | null) => this.onVideoCall(room, call, before))
    this.messenger.on('declined', (room: string, ext: string) => {
      if (ext === this.messenger.state.me) this.withdraw(`video-${room}`)
      this.send('messenger-declined', { room, ext })
    })
    if (!this.store.settings.home.cards.length) this.store.settings.home.cards = DEFAULT_CARDS
  }

  /** Mit einer Anlage verbunden (sonst Anmeldeseite) */
  get loggedIn(): boolean {
    return this.provisioning.active && Boolean(this.provisioning.url)
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.calendar.on('calendars-changed', () => {
      this.stateChanged()
      void this.refreshUpcoming()
    })
    this.calendar.on('events-changed', () => {
      this.eventsVersion++
      this.stateChanged()
      void this.refreshUpcoming()
    })
    this.syncBook()
    void this.calendar.reload()
    void this.refreshDevices()
    this.claimPhone()
    this.messenger.update()
    void this.provisioning.refresh()
    // Wie Provisioning.start(), ohne unref (gibt es im Browser nicht)
    setInterval(() => void this.provisioning.refresh(), 6 * 3600000)
    setInterval(() => void this.provisioning.poll(), 120000)
    setInterval(() => {
      // Im Hintergrund seltener fragen
      if (document.visibilityState === 'hidden' && Date.now() - this.lastPresence < 30000) return
      this.lastPresence = Date.now()
      void this.provisioning.pollPresence()
    }, 4000)
    setInterval(() => void this.refreshUpcoming(), 600000)
    navigator.mediaDevices?.addEventListener?.('devicechange', () => void this.refreshDevices())
    // Nach Ruhezustand, Netzwechsel oder Zurückkehren zum Tab
    const wake = (): void => {
      this.phone.wake()
      this.messenger.reconnect()
      void this.provisioning.pollPresence()
    }
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.phone.wake())
    window.addEventListener('beforeunload', () => this.phone.stop())
  }

  /**
   * Nur ein Tab des Browsers meldet sich zum Telefonieren an (sonst klingelt es mehrfach).
   * steal: „Hier telefonieren“ – der andere Tab gibt ab und wartet.
   */
  claimPhone(steal = false): void {
    const locks = navigator.locks
    if (!locks) return this.phone.restartEngine()
    const run = (): Promise<void> => {
      this.phone.standby = false
      this.phone.restartEngine()
      // Sperre halten, solange der Tab offen ist
      return new Promise<void>(() => undefined)
    }
    const lost = (): void => {
      this.phone.standby = true
      this.phone.restartEngine()
    }
    if (steal) {
      void locks.request('phone4all-phone', { steal: true }, run).catch(() => this.claimPhone())
      return
    }
    void locks
      .request('phone4all-phone', { ifAvailable: true }, (lock) => {
        if (lock) return run()
        lost()
        // Warten, bis der andere Tab zu ist oder abgibt
        void locks.request('phone4all-phone', run).catch(() => this.claimPhone())
        return undefined
      })
      // Abgegeben („Hier telefonieren“ im anderen Tab): wieder anstellen
      .catch(() => {
        lost()
        this.claimPhone()
      })
  }

  // -- Brücke zur Oberfläche ---------------------------------------------------------

  on(channel: string, listener: Listener): () => void {
    let set = this.listeners.get(channel)
    if (!set) this.listeners.set(channel, (set = new Set()))
    set.add(listener)
    return () => set.delete(listener)
  }

  send<K extends keyof RendererEvents>(channel: K, ...args: RendererEvents[K]): void {
    // Wie über IPC: die Oberfläche bekommt Kopien, keine geteilten Objekte
    const copy = structuredClone(args)
    for (const l of this.listeners.get(channel) ?? []) l(...copy)
  }

  /** Datei aus Drag & Drop merken; die Oberfläche gibt den „Pfad“ an importFiles/messengerSendFiles */
  registerFile(file: File): string {
    const key = `web-file:${++this.fileCounter}`
    this.files.set(key, file)
    return key
  }

  takeFile(key: string): File | null {
    const file = this.files.get(key) ?? null
    this.files.delete(key)
    return file
  }

  // -- Zustand -------------------------------------------------------------------------

  state(): AppState {
    const s = this.store.settings
    return {
      platform: {
        os: 'linux',
        eds: false,
        version: __APP_VERSION__,
        audioDevices: this.devices.sinks.length > 0 || this.devices.sources.length > 0,
        accent: null,
        secureStorage: false,
      },
      reg: this.phone.reg,
      banner: this.provisioning.invalid
        ? { text: `Die Telefonanlage „${s.provisioning.pbx}“ kennt diesen Browser nicht mehr (abgemeldet oder Nebenstelle gelöscht).`, button: 'Neu anmelden', action: 'preferences' }
        : this.phone.banner,
      calls: [...this.phone.calls.values()].map(({ declined: _d, pendingTransfer: _p, ...info }) => info),
      settings: s,
      hasPassword: Boolean(this.store.getPassword()),
      favorites: this.store.contacts.filter((c) => c.favorite),
      contactsVersion: this.contactsVersion,
      hasContacts: this.store.contacts.length > 0 || this.store.external.length > 0,
      calendars: this.calendar.info(),
      calendarsLoading: this.calendar.loading,
      calendarErrors: this.calendar.errors,
      defaultCalendar: this.calendar.defaultCalendar()?.id ?? null,
      upcoming: this.phone.upcoming,
      eventsVersion: this.eventsVersion,
      books: this.books(),
      bookErrors: [],
      syncing: false,
      devices: this.devices,
      ringtones: ringtoneList(),
      missedUnseen: this.missedUnseen,
      watchdog: { level: this.phone.reg.kind === 'ok' ? 'ok' : this.phone.reg.kind === 'error' ? 'error' : 'warning', text: this.phone.reg.text, repairs: 0 },
      update: { status: 'idle', current: __APP_VERSION__, latest: null, canInstall: false, progress: 0, error: '', checked: Date.now() },
      forward: this.provisioning.active ? this.provisioning.forward : null,
      messenger: {
        available: Boolean(s.provisioning.messenger),
        status: this.messenger.state.status,
        unread: this.messenger.unread,
        video: Boolean(s.provisioning.messenger && s.provisioning.video),
      },
      team: this.provisioning.active ? this.provisioning.team : null,
      voicemail: this.provisioning.active ? this.provisioning.voicemail : null,
      groups: this.provisioning.active ? this.provisioning.groups : null,
      groupMissed: this.provisioning.active ? this.provisioning.groupMissed : null,
      boss: this.provisioning.active ? this.provisioning.boss : [],
      callbacks: this.provisioning.active ? this.provisioning.callbacks : null,
      sms: this.provisioning.active && this.provisioning.sms,
    }
  }

  stateChanged(): void {
    if (this.pendingState) return
    this.pendingState = true
    setTimeout(() => {
      this.pendingState = false
      this.send('state', this.state())
      this.updateTitle()
    }, 0)
  }

  /** Ungelesenes und Anrufe im Titel des Tabs */
  private updateTitle(): void {
    const ringing = [...this.phone.calls.values()].find((c) => c.state === 'incoming')
    const unread = this.messenger.unread
    document.title = ringing ? `☎ ${ringing.name || ringing.number} – Phone4All` : unread ? `(${unread}) Phone4All` : 'Phone4All'
  }

  historyChanged(missed: boolean): void {
    if (missed) this.missedUnseen = true
    this.send('history', this.store.historyRows())
    this.stateChanged()
  }

  markHistorySeen(): void {
    this.missedUnseen = false
    this.stateChanged()
  }

  contactsChanged(): void {
    this.contactsVersion++
    this.send('history', this.store.historyRows())
    this.stateChanged()
  }

  showPage(page: PageName): void {
    window.focus()
    this.send('navigate', page)
  }

  // -- Kontakte der Anlage -------------------------------------------------------------

  private books(): AppState['books'] {
    if (!this.provisioning.active) return []
    return [
      {
        id: 'pbx',
        name: this.store.settings.provisioning.pbx,
        group: 'Telefonanlage',
        enabled: !this.store.settings.addressbooks.disabled.includes('pbx'),
        count: this.store.external.length,
      },
    ]
  }

  /** Telefonbuch der Anlage als Adressbuch (wie ContactSync mit der Quelle „pbx“) */
  syncBook(): void {
    const p = this.store.settings.provisioning
    const enabled = this.provisioning.active && !this.store.settings.addressbooks.disabled.includes('pbx')
    const contacts: Contact[] = enabled
      ? this.provisioning.phonebook.map((c, i) => ({ ...c, id: `pbx#${i}`, source: `Telefonanlage · ${p.pbx}`, readonly: !c.pbx }))
      : []
    this.store.setExternal(contacts.filter((c) => contactNumbers(c).length))
    this.contactsChanged()
  }

  // -- Kalender ----------------------------------------------------------------------------

  async refreshUpcoming(): Promise<void> {
    if (!this.calendar.enabledCalendars().length) return this.phone.setUpcoming([])
    const now = Date.now()
    const { events } = await this.calendar.fetch(now - 3600000, now + 7 * 86400000)
    this.phone.setUpcoming(events)
  }

  // -- Geräte --------------------------------------------------------------------------------

  async refreshDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const map = (kind: MediaDeviceKind): AudioDevice[] =>
        list
          .filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'communications')
          .map((d, i) => ({ id: d.deviceId === 'default' ? '' : d.deviceId, name: d.label || `${kind === 'audioinput' ? 'Mikrofon' : 'Lautsprecher'} ${i + 1}`, isDefault: d.deviceId === 'default' }))
      // Ohne Freigabe kennt der Browser nur anonyme Geräte (Firefox: keine Lautsprecher)
      this.devices = { sources: map('audioinput'), sinks: map('audiooutput') }
    } catch {
      this.devices = { sources: [], sinks: [] }
    }
    this.stateChanged()
  }

  // -- Benachrichtigungen ----------------------------------------------------------------------

  notify(opts: NotifyOptions): void {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    this.withdraw(opts.tag)
    try {
      const n = new Notification(opts.title, { body: opts.body ?? '', tag: opts.tag, icon: './icon.png', requireInteraction: Boolean(opts.urgent) })
      n.onclick = () => {
        window.focus()
        n.close()
        ;(opts.onClick ?? (() => undefined))()
      }
      n.onclose = () => {
        if (this.notifications.get(opts.tag) === n) this.notifications.delete(opts.tag)
      }
      this.notifications.set(opts.tag, n)
    } catch {
      // z. B. Android-Chrome: nur über einen Service Worker
    }
  }

  withdraw(tag: string): void {
    this.notifications.get(tag)?.close()
    this.notifications.delete(tag)
  }

  private onChatMessage(m: ChatMessage): void {
    this.send('messenger-message', m)
    const { state } = this.messenger
    if (!m.from || m.from === state.me) return
    if (this.openChat === m.room && document.hasFocus()) return
    const room = state.rooms.find((r) => r.id === m.room)
    const sender = state.users.find((u) => u.number === m.from)?.name || m.from
    this.notify({
      tag: `chat-${m.room}`,
      title: room?.kind === 'group' ? `${sender} in „${room.name}“` : sender,
      body: m.text || (m.file ? `Datei: ${m.file.name}` : ''),
      onClick: () => {
        this.showPage('messenger')
        this.send('messenger-open', m.room)
      },
    })
  }

  private onVideoCall(room: string, call: ChatCall | null, before: ChatCall | null): void {
    const { state } = this.messenger
    if (!call || call.participants.includes(state.me)) return this.withdraw(`video-${room}`)
    if (before || call.by === state.me || !this.store.settings.provisioning.video) return
    const r = state.rooms.find((x) => x.id === room)
    const caller = state.users.find((u) => u.number === call.by)?.name || call.by
    this.send('messenger-ring', { room, answer: false })
    this.notify({
      tag: `video-${room}`,
      title: r?.kind === 'group' ? `Videoanruf in „${r.name}“` : `Videoanruf von ${caller}`,
      body: r?.kind === 'group' ? `${caller} hat angefangen` : 'Im Messenger annehmen',
      urgent: true,
      onClick: () => {
        this.showPage('messenger')
        this.send('messenger-open', room)
      },
    })
    setTimeout(() => this.withdraw(`video-${room}`), RING_MS)
  }

  openCrm(number: string, name: string): void {
    const crm = this.store.settings.provisioning.crm
    if (!crm) return
    const digits = number.replace(/[^\d+]/g, '')
    const e164 = digits.startsWith('+') ? digits : digits.startsWith('00') ? `+${digits.slice(2)}` : digits.startsWith('0') ? `+49${digits.slice(1)}` : digits
    const url = crm.url
      .replace(/\{nummer\}/g, encodeURIComponent(digits))
      .replace(/\{e164\}/g, encodeURIComponent(e164))
      .replace(/\{name\}/g, encodeURIComponent(name))
    window.open(url, '_blank', 'noopener')
  }

  diagnose(): Diagnose {
    const kind = this.phone.reg.kind
    return {
      enabled: false,
      checked: Date.now(),
      repairs: 0,
      checks: [
        { id: 'registration', name: 'Anmeldung an der Telefonanlage', level: kind === 'ok' ? 'ok' : kind === 'error' ? 'error' : kind === 'off' ? 'off' : 'warning', text: this.phone.reg.text, since: 0 },
        { id: 'network', name: 'Netzwerk', level: navigator.onLine ? 'ok' : 'error', text: navigator.onLine ? 'Verbunden' : 'Kein Netzwerk', since: 0 },
      ],
      events: [],
    }
  }

  /** Abmelden: Gerät auf der Anlage freigeben und alles im Browser löschen */
  async logout(): Promise<void> {
    const url = this.provisioning.url
    this.phone.stop()
    this.messenger.stop()
    if (url) await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(5000) }).catch(() => undefined)
    clearAll()
    try {
      localStorage.removeItem('phone4all:ringtone-custom')
    } catch {
      // Speicher gesperrt
    }
    location.replace(location.pathname)
  }
}
