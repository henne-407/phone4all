/** Anwendung: Fenster, Tray, Benachrichtigungen und der Zustand für die Oberfläche. */

import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app as electronApp,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  screen,
  systemPreferences,
} from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppState, AudioDevice, Contact, HomeCard, PageName } from '../shared/types'
import { type Api, type RendererEvents, createApi } from './api'
import { listDevices } from './audioDevices'
import { CalendarManager } from './calendars'
import { parseFileData } from './contactImport'
import { ContactSync } from './contactSync'
import { edsAvailable } from './eds'
import { loadJson, saveJson } from './files'
import { DIRS, RINGTONE_DIR, resourcePath } from './paths'
import { type Call, type NotifyOptions, Phone, type PhoneUi } from './phone'
import { RINGTONES, ringtonePath } from './ringtones'
import { Store } from './store'

const APP_ID = 'de.hpieper.SipTelefon'
const DEFAULT_CARDS: [HomeCard, boolean][] = [
  ['status', true],
  ['today', true],
  ['favorites', true],
  ['recent', true],
  ['events', true],
]

// GNOME-Akzentfarben (org.gnome.desktop.interface accent-color)
const GNOME_ACCENTS: Record<string, string> = {
  blue: '#3584e4',
  teal: '#2190a4',
  green: '#3a944a',
  yellow: '#c88800',
  orange: '#ed5b00',
  red: '#e62d42',
  pink: '#d56199',
  purple: '#9141ac',
  slate: '#6f8396',
}

function systemAccent(): string | null {
  try {
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const c = systemPreferences.getAccentColor()
      return c ? '#' + c.slice(0, 6) : null
    }
    const name = execFileSync('gsettings', ['get', 'org.gnome.desktop.interface', 'accent-color'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return GNOME_ACCENTS[name.trim().replace(/'/g, '')] ?? null
  } catch {
    return null
  }
}

interface Bounds {
  width: number
  height: number
  x?: number
  y?: number
}

export class App {
  readonly store = new Store()
  readonly calendar = new CalendarManager(this.store)
  readonly sync = new ContactSync(this.store)
  readonly phone: Phone
  readonly api: Api
  private main: BrowserWindow | null = null
  private popups = new Map<string, BrowserWindow>()
  private tray: Tray | null = null
  private notifications = new Map<string, Notification>()
  private devices: { sources: AudioDevice[]; sinks: AudioDevice[] } = { sources: [], sinks: [] }
  private contactsVersion = 0
  private eventsVersion = 0
  private missedUnseen = false
  private manualSync = false
  private accent = systemAccent()
  private quitting = false
  private pendingState = false
  private titleBar = { color: '#fef7ff', symbolColor: '#1d1b20' }
  private boundsPath = path.join(DIRS.state, 'window.json')

  constructor() {
    const ui: PhoneUi = {
      stateChanged: () => this.stateChanged(),
      historyChanged: (missed) => this.historyChanged(missed),
      toast: (text) => this.send('toast', text),
      notify: (opts) => this.notify(opts),
      withdraw: (tag) => this.withdraw(tag),
      isMainActive: () => Boolean(this.main?.isFocused()),
      presentMain: () => this.present(),
      showPopup: (call) => this.showPopup(call),
      closePopup: (id) => this.closePopup(id),
      showPage: (page) => this.showPage(page as PageName),
      newEvent: (prefill) => {
        this.showPage('calendar')
        this.send('new-event', prefill)
      },
      showCalendarEvent: () => this.showPage('calendar'),
    }
    this.phone = new Phone(this.store, this.calendar, ui)
    this.api = createApi(this)
    if (!this.store.settings.home.cards.length) this.store.settings.home.cards = DEFAULT_CARDS
    nativeTheme.themeSource = this.store.settings.appearance.scheme
  }

  start(background: boolean): void {
    this.registerIpc()
    this.createMain(!background)
    this.createTray()
    this.calendar.on('calendars-changed', () => this.stateChanged())
    this.calendar.on('events-changed', () => {
      this.eventsVersion++
      this.stateChanged()
    })
    this.sync.on('synced', () => this.onContactsSynced())
    nativeTheme.on('updated', () => {
      this.accent = systemAccent()
      this.stateChanged()
    })
    // Autostart-Eintrag auffrischen (z. B. nach dem Wechsel von der GTK-Version)
    if (this.store.settings.autostart && !process.env.SIP_TELEFON_SCREENSHOT) this.updateAutostart()
    void this.calendar.reload()
    void this.sync.sync()
    void this.refreshDevices()
    this.phone.restartEngine()
  }

  // -- IPC -----------------------------------------------------------------

  private registerIpc(): void {
    ipcMain.handle('api', (_e, method: keyof Api, ...args: unknown[]) => {
      const fn = this.api[method] as (...a: unknown[]) => unknown
      if (typeof fn !== 'function') throw new Error(`Unbekannte Funktion: ${String(method)}`)
      return fn(...args)
    })
  }

  send<K extends keyof RendererEvents>(channel: K, ...args: RendererEvents[K]): void {
    for (const win of [this.main, ...this.popups.values()]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
    }
  }

  // -- Zustand -------------------------------------------------------------

  state(): AppState {
    const s = this.store.settings
    return {
      platform: {
        os: process.platform as 'linux' | 'darwin' | 'win32',
        eds: edsAvailable(),
        version: electronApp.getVersion(),
        audioDevices: this.devices.sinks.length > 0 || this.devices.sources.length > 0,
        accent: this.accent,
        secureStorage: this.store.secureStorage,
      },
      reg: this.phone.reg,
      banner: this.phone.banner,
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
      books: this.sync.info(),
      bookErrors: this.sync.errors,
      syncing: this.sync.syncing,
      devices: this.devices,
      ringtones: RINGTONES.map((r) => ({
        ...r,
        available: r.key !== 'custom' || ringtonePath('custom', RINGTONE_DIR, null) !== null,
      })),
      missedUnseen: this.missedUnseen,
    }
  }

  /** Zustand gebündelt an alle Fenster senden. */
  stateChanged(): void {
    if (this.pendingState) return
    this.pendingState = true
    setImmediate(() => {
      this.pendingState = false
      this.send('state', this.state())
      this.updateTray()
    })
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
    this.send('history', this.store.historyRows()) // Namen im Verlauf
    this.stateChanged()
  }

  private onContactsSynced(): void {
    this.contactsChanged()
    if (this.manualSync && !this.sync.syncing) {
      this.manualSync = false
      const errors = this.sync.errors
      this.send(
        'toast',
        errors.length ? 'Adressbuch: ' + errors[0] : `Adressbücher abgeglichen (${this.store.external.length} Kontakte)`,
      )
    }
  }

  syncContacts(manual: boolean): void {
    this.manualSync = manual
    void this.sync.sync()
  }

  async refreshDevices(): Promise<void> {
    this.devices = await listDevices()
    this.stateChanged()
  }

  setAppearance(values: Partial<AppState['settings']['appearance']>): void {
    Object.assign(this.store.settings.appearance, values)
    this.store.saveSettings()
    nativeTheme.themeSource = this.store.settings.appearance.scheme
    this.stateChanged()
  }

  setTitleBarColors(color: string, symbolColor: string): void {
    this.titleBar = { color, symbolColor }
    if (process.platform === 'darwin') return
    for (const win of [this.main, ...this.popups.values()]) {
      if (win && !win.isDestroyed()) win.setTitleBarOverlay({ ...this.titleBar, height: 48 })
    }
  }

  // -- Fenster -------------------------------------------------------------

  private loadRenderer(win: BrowserWindow, hash: string): void {
    if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
    else void win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash })
  }

  private windowOptions(): Electron.BrowserWindowConstructorOptions {
    const mac = process.platform === 'darwin'
    return {
      show: false,
      icon: resourcePath('icons', 'icon.png'),
      backgroundColor: this.titleBar.color,
      titleBarStyle: mac ? 'hiddenInset' : 'hidden',
      ...(mac ? { trafficLightPosition: { x: 16, y: 16 } } : { titleBarOverlay: { ...this.titleBar, height: 48 } }),
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        // Testmodus für Bildschirmfotos (siehe screenshot.ts)
        offscreen: Boolean(process.env.SIP_TELEFON_SCREENSHOT),
      },
    }
  }

  private createMain(show: boolean): void {
    const bounds = loadJson<Bounds>(this.boundsPath, { width: 420, height: 720 })
    // Gespeicherte Position nur verwenden, wenn sie auf einem Bildschirm liegt
    const visible =
      bounds.x !== undefined &&
      screen.getAllDisplays().some((d) => {
        const a = d.workArea
        return bounds.x! >= a.x - 50 && bounds.y! >= a.y - 50 && bounds.x! < a.x + a.width && bounds.y! < a.y + a.height
      })
    const win = new BrowserWindow({
      ...this.windowOptions(),
      title: 'SIP-Telefon',
      width: bounds.width,
      height: bounds.height,
      ...(visible ? { x: bounds.x, y: bounds.y } : {}),
      minWidth: 360,
      minHeight: 560,
    })
    this.main = win
    this.loadRenderer(win, 'main')
    if (show) win.once('ready-to-show', () => win.show())
    win.on('close', (e) => {
      saveJson(this.boundsPath, win.getNormalBounds())
      if (!this.quitting && this.store.settings.run_in_background) {
        e.preventDefault()
        win.hide()
      } else if (!this.quitting) {
        e.preventDefault()
        this.quit()
      }
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }

  mainWindow(): BrowserWindow | null {
    return this.main
  }

  present(): void {
    if (!this.main) return
    if (this.main.isMinimized()) this.main.restore()
    this.main.show()
    this.main.focus()
  }

  showPage(page: PageName): void {
    this.present()
    this.send('navigate', page)
  }

  private showPopup(call: Call): void {
    let win = this.popups.get(call.id)
    if (!win || win.isDestroyed()) {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
      const width = 360
      const height = 600
      win = new BrowserWindow({
        ...this.windowOptions(),
        title: call.direction === 'in' ? 'Eingehender Anruf' : 'Ausgehender Anruf',
        width,
        height,
        x: display.x + display.width - width - 24,
        y: display.y + 24,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        skipTaskbar: false,
      })
      const id = call.id
      win.on('close', (e) => {
        if (this.quitting || !this.phone.calls.has(id)) return
        e.preventDefault()
        const c = this.phone.calls.get(id)!
        // Schließen lehnt nicht ab, sondern blendet nur aus; ein Gespräch wandert ins Hauptfenster
        if (c.state === 'incoming') win!.hide()
        else this.phone.openInWindow(id)
      })
      win.on('closed', () => this.popups.delete(id))
      this.popups.set(id, win)
      this.loadRenderer(win, `call=${encodeURIComponent(id)}`)
      win.once('ready-to-show', () => {
        win!.show()
        win!.focus()
      })
    } else {
      win.show()
      win.focus()
    }
  }

  hidePopup(id: string): void {
    this.popups.get(id)?.hide()
  }

  private closePopup(id: string): void {
    const win = this.popups.get(id)
    this.popups.delete(id)
    if (win && !win.isDestroyed()) win.destroy()
  }

  // -- Tray ----------------------------------------------------------------

  private createTray(): void {
    if (process.env.SIP_TELEFON_SCREENSHOT) return
    const mac = process.platform === 'darwin'
    const image = nativeImage.createFromPath(resourcePath('icons', mac ? 'trayTemplate.png' : 'tray.png'))
    if (mac) image.setTemplateImage(true)
    try {
      this.tray = new Tray(image)
    } catch {
      return // kein Infobereich vorhanden
    }
    this.tray.setToolTip('SIP-Telefon')
    this.tray.on('click', () => this.present())
    this.updateTray()
  }

  private updateTray(): void {
    if (!this.tray) return
    this.tray.setToolTip(`SIP-Telefon – ${this.phone.reg.text}`)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'SIP-Telefon öffnen', click: () => this.present() },
        { label: this.phone.reg.text, enabled: false },
        { type: 'separator' },
        {
          label: 'Nicht stören',
          type: 'checkbox',
          checked: this.phone.dnd,
          click: (item) => this.phone.setDnd(item.checked),
        },
        { label: 'Neu verbinden', click: () => this.phone.restartEngine() },
        { type: 'separator' },
        { label: 'Beenden', click: () => this.quit() },
      ]),
    )
  }

  // -- Benachrichtigungen --------------------------------------------------

  private notify(opts: NotifyOptions): void {
    if (!Notification.isSupported()) return
    this.withdraw(opts.tag)
    const actions = opts.actions ?? []
    const n = new Notification({
      title: opts.title,
      body: opts.body ?? '',
      icon: resourcePath('icons', 'icon-256.png'),
      urgency: opts.urgent ? 'critical' : 'normal',
      timeoutType: opts.urgent ? 'never' : 'default',
      actions: actions.map((a) => ({ type: 'button' as const, text: a.text })),
    })
    n.on('click', () => (opts.onClick ?? (() => this.present()))())
    n.on('action', (_e, index) => actions[index]?.run())
    n.on('close', () => {
      if (this.notifications.get(opts.tag) === n) this.notifications.delete(opts.tag)
    })
    this.notifications.set(opts.tag, n)
    n.show()
  }

  private withdraw(tag: string): void {
    this.notifications.get(tag)?.close()
    this.notifications.delete(tag)
  }

  // -- Kontakte importieren -------------------------------------------------

  async importContacts(): Promise<void> {
    this.present()
    const r = await dialog.showOpenDialog(this.main!, {
      title: 'Kontakte importieren',
      filters: [
        { name: 'Kontakte (vCard, CSV)', extensions: ['vcf', 'vcard', 'csv'] },
        { name: 'vCard', extensions: ['vcf', 'vcard'] },
        { name: 'CSV', extensions: ['csv'] },
      ],
      properties: ['openFile', 'multiSelections'],
    })
    if (!r.canceled) this.importFiles(r.filePaths)
  }

  importFiles(paths: string[]): void {
    const imported: Omit<Contact, 'id'>[] = []
    let skipped = 0
    const failed: string[] = []
    for (const file of paths) {
      try {
        const [contacts, without] = parseFileData(fs.readFileSync(file))
        imported.push(...contacts)
        skipped += without
      } catch (e) {
        failed.push(`${path.basename(file)}: ${(e as Error).message}`)
      }
    }
    if (failed.length) this.send('toast', 'Import fehlgeschlagen: ' + failed.join('; '))
    if (!imported.length) {
      if (!failed.length) this.send('toast', 'Keine Kontakte mit Telefonnummer gefunden')
      return
    }
    const [added, merged] = this.store.importContacts(imported as Contact[])
    this.contactsChanged()
    if (!added && !merged) {
      this.send('toast', 'Alle Kontakte waren schon vorhanden')
    } else {
      const parts = [`${added} neu`, `${merged} ergänzt`, ...(skipped ? [`${skipped} ohne Nr.`] : [])]
      this.send('toast', 'Import: ' + parts.join(' · '))
    }
    this.showPage('contacts')
  }

  // -- Autostart und Beenden -------------------------------------------------

  updateAutostart(): void {
    const enabled = this.store.settings.autostart
    if (process.platform === 'linux') {
      const file = path.join(
        process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
        'autostart',
        `${APP_ID}.desktop`,
      )
      if (enabled) {
        const exe = process.env.APPIMAGE || process.execPath
        const args = electronApp.isPackaged ? '' : ` "${electronApp.getAppPath()}"`
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(
          file,
          `[Desktop Entry]\nType=Application\nName=SIP-Telefon\nExec="${exe}"${args} --background\n` +
            `Icon=sip-telefon\nX-GNOME-Autostart-enabled=true\n`,
        )
      } else {
        fs.rmSync(file, { force: true })
      }
    } else {
      electronApp.setLoginItemSettings({ openAtLogin: enabled, args: ['--background'] })
    }
  }

  quit(): void {
    if (this.quitting) return
    this.quitting = true
    if (this.main && !this.main.isDestroyed()) saveJson(this.boundsPath, this.main.getNormalBounds())
    void this.phone.stop().finally(() => electronApp.exit(0))
  }
}
