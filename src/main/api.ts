/**
 * Schnittstelle für die Oberfläche: Jede Funktion hier ist per IPC aus dem Renderer
 * aufrufbar (window.api.<name>(…)). Der Typ `Api` wird im Renderer importiert.
 */

import { dialog, shell } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeNumber } from '../shared/numbers'
import type { AccountSettings, CalEvent, Contact, DavAccount, HomeCard, PageName, SqlSourceConf } from '../shared/types'
import type { App } from './app'
import { CalDavBackend } from './calendars'
import { CardDavBackend } from './contactSync'
import { errorText } from './dav'
import { RINGTONE_DIR } from './paths'
import { ringtonePath, saveCustomRingtone } from './ringtones'
import { MsSqlSource } from './sqlSource'

type DavKind = 'caldav' | 'carddav'

function davList(app: App, kind: DavKind): DavAccount[] {
  return kind === 'caldav' ? app.store.settings.calendar.caldav : app.store.settings.addressbooks.carddav
}

/** Ergebnis langer Vorgänge: Fehler als Text statt Ausnahme (lesbar in der Oberfläche). */
type Result<T> = { ok: true; value: T } | { ok: false; error: string }

async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

export function createApi(app: App) {
  const { store, phone, calendar, sync } = app
  return {
    // -- Zustand -------------------------------------------------------------
    getState: () => app.state(),
    getHistory: () => store.historyRows(),
    markHistorySeen: () => app.markHistorySeen(),

    // -- Anrufe --------------------------------------------------------------
    dial: (number: string) => phone.dial(number),
    accept: (id: string, via: 'window' | 'popup') => phone.accept(id, via),
    hangup: (id?: string) => phone.hangup(id),
    setMute: (muted: boolean, id?: string) => phone.setMute(muted, id),
    setHold: (held: boolean, id?: string) => phone.setHold(held, id),
    sendDtmf: (digit: string, id?: string) => phone.sendDtmf(digit, id),
    stopRinging: () => phone.stopRinging(),
    transfer: (id: string, target: string) => phone.transfer(id, target),
    openInWindow: (id: string) => phone.openInWindow(id),
    hidePopup: (id: string) => app.hidePopup(id),
    scheduleCallback: (number: string, name: string) => phone.scheduleCallback(number, name),

    // -- Anmeldung und Audio -------------------------------------------------
    setDnd: (active: boolean) => phone.setDnd(active),
    setRegistered: (registered: boolean) => phone.setRegistered(registered),
    restartEngine: () => phone.restartEngine(),
    setAudio: (kind: 'source' | 'sink' | 'alert', device: string) => phone.setAudio(kind, device),
    refreshDevices: () => app.refreshDevices(),
    setRingtone: (key: string) => phone.setRingtone(key),
    ringtoneData: (key: string): Uint8Array | null => {
      const file = ringtonePath(key, RINGTONE_DIR, phone.engine.engine?.soundDir ?? null)
      return file && fs.existsSync(file) ? fs.readFileSync(file) : null
    },
    saveCustomRingtone: (wav: Uint8Array) => {
      saveCustomRingtone(RINGTONE_DIR, wav)
      phone.setRingtone('custom')
    },
    chooseAudioFile: async (): Promise<Uint8Array | null> => {
      const r = await dialog.showOpenDialog(app.mainWindow()!, {
        title: 'Klingelton wählen',
        filters: [{ name: 'Audiodateien', extensions: ['wav', 'mp3', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'webm'] }],
        properties: ['openFile'],
      })
      return r.canceled || !r.filePaths[0] ? null : fs.readFileSync(r.filePaths[0])
    },

    // -- Einstellungen -------------------------------------------------------
    getPassword: () => store.getPassword(),
    /** Gibt false zurück, wenn kein Schlüsselbund verfügbar war. */
    saveAccount: (acc: AccountSettings, password: string): boolean => {
      const before = JSON.stringify(store.account)
      const oldPassword = store.getPassword()
      Object.assign(store.account, acc)
      store.saveSettings()
      const changed = before !== JSON.stringify(store.account) || password !== oldPassword
      let secure = true
      if (password !== oldPassword || (changed && password)) secure = store.setPassword(password)
      if (changed) phone.restartEngine()
      app.stateChanged()
      return secure
    },
    setAppearance: (values: { theme?: string; scheme?: 'system' | 'light' | 'dark' }) => app.setAppearance(values),
    setBehaviour: (values: { run_in_background?: boolean; autostart?: boolean; mini_call?: boolean }) => {
      Object.assign(store.settings, values)
      store.saveSettings()
      if ('autostart' in values) app.updateAutostart()
      app.stateChanged()
    },
    setReminderMinutes: (minutes: number) => {
      store.settings.calendar.reminder_minutes = minutes
      store.saveSettings()
      app.stateChanged()
    },
    setHome: (values: { cards?: [HomeCard, boolean][]; start_tab?: PageName }) => {
      Object.assign(store.settings.home, values)
      store.saveSettings()
      app.stateChanged()
    },
    clearHistory: () => {
      store.clearHistory()
      app.historyChanged(false)
    },
    logPath: () => phone.engine.logPath,
    openLog: () => shell.openPath(path.dirname(phone.engine.logPath)),
    openOnlineAccounts: () => {
      execFile('gnome-control-center', ['online-accounts'], () => undefined)
    },
    quit: () => app.quit(),
    setTitleBarColors: (color: string, symbolColor: string) => app.setTitleBarColors(color, symbolColor),

    // -- Kontakte ------------------------------------------------------------
    searchContacts: (text: string, limit = 200) => {
      const all = store.searchContacts(text)
      return { items: all.slice(0, limit), total: all.length }
    },
    getContact: (id: string) => store.allContacts().find((c) => c.id === id) ?? null,
    findContact: (number: string) => store.findContact(normalizeNumber(number)),
    saveContact: (contact: Contact) => {
      const saved = store.upsertContact(contact)
      app.contactsChanged()
      return saved
    },
    deleteContact: (id: string) => {
      store.deleteContact(id)
      app.contactsChanged()
    },
    importContacts: () => app.importContacts(),
    importFiles: (paths: string[]) => app.importFiles(paths),
    syncContacts: () => app.syncContacts(true),
    setBookEnabled: (id: string, enabled: boolean) => sync.setEnabled(id, enabled),
    setBooksUseEds: (use: boolean) => {
      store.settings.addressbooks.use_eds = use
      store.saveSettings()
      void sync.sync()
    },

    // -- CalDAV/CardDAV-Konten ------------------------------------------------
    davSecret: (kind: DavKind, id: string) => store.getSecret(`${kind}:${id}`),
    addDavAccount: (kind: DavKind, conf: DavAccount, password: string) =>
      attempt(async () => {
        const found =
          kind === 'caldav'
            ? await new CalDavBackend(conf, password).discover()
            : await new CardDavBackend(conf, password).listBooks()
        davList(app, kind).push(conf)
        store.setSecret(`${kind}:${conf.id}`, password)
        store.saveSettings()
        if (kind === 'caldav') void calendar.reload()
        else void sync.sync()
        app.stateChanged()
        return found.length
      }),
    removeDavAccount: (kind: DavKind, id: string) => {
      const list = davList(app, kind)
      list.splice(
        list.findIndex((c) => c.id === id),
        1,
      )
      store.deleteSecret(`${kind}:${id}`)
      store.saveSettings()
      if (kind === 'caldav') void calendar.reload()
      else void sync.sync()
      app.stateChanged()
    },

    // -- SQL Server ------------------------------------------------------------
    sqlSecret: (id: string) => store.getSecret(`mssql:${id}`),
    sqlTables: (conf: SqlSourceConf, password: string) => attempt(() => new MsSqlSource(conf, password).tables()),
    sqlColumns: (conf: SqlSourceConf, password: string, table: string) =>
      attempt(async () => {
        const columns = await new MsSqlSource(conf, password).columns(table)
        return { columns, suggestion: MsSqlSource.suggest(columns) }
      }),
    sqlTestAndSave: (conf: SqlSourceConf, password: string) =>
      attempt(async () => {
        const [contacts, rows] = await new MsSqlSource(conf, password).fetch()
        if (contacts.length) {
          const sources = store.settings.addressbooks.sql
          store.settings.addressbooks.sql = [...sources.filter((c) => c.id !== conf.id), conf]
          store.setSecret(`mssql:${conf.id}`, password)
          store.saveSettings()
          void sync.sync()
          app.stateChanged()
        }
        return { count: contacts.length, rows, sample: contacts[0]?.name ?? '' }
      }),
    sqlRemove: (id: string) => {
      store.settings.addressbooks.sql = store.settings.addressbooks.sql.filter((c) => c.id !== id)
      store.deleteSecret(`mssql:${id}`)
      store.saveSettings()
      void sync.sync()
      app.stateChanged()
    },

    // -- Kalender --------------------------------------------------------------
    fetchEvents: (start: number, end: number) => calendar.fetch(start, end),
    saveEvent: (ev: CalEvent, isNew: boolean) => attempt(() => calendar.save(ev, isNew)),
    deleteEvent: (ev: CalEvent) => attempt(() => calendar.delete(ev)),
    refreshCalendars: () => calendar.refresh(),
    reloadCalendars: () => calendar.reload(),
    setCalendarEnabled: (id: string, enabled: boolean) => {
      calendar.setEnabled(id, enabled)
      app.stateChanged()
    },
    setDefaultCalendar: (id: string) => {
      store.settings.calendar.default = id
      store.saveSettings()
      app.stateChanged()
    },
    setCalendarUseEds: (use: boolean) => {
      store.settings.calendar.use_eds = use
      store.saveSettings()
      void calendar.reload()
    },
    defaultCalendar: () => calendar.defaultCalendar()?.id ?? null,
  }
}

export type Api = ReturnType<typeof createApi>

/** Ereignisse vom Hauptprozess an die Oberfläche */
export interface RendererEvents {
  state: [import('../shared/types').AppState]
  history: [import('../shared/types').HistoryRow[]]
  toast: [string]
  navigate: [PageName]
  'new-event': [Partial<CalEvent>]
  'open-preferences': [string]
  'edit-contact': [Partial<Contact>]
}
