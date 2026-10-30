/**
 * Schnittstelle der Oberfläche im Browser: dieselben Funktionen wie src/main/api.ts,
 * umgesetzt mit dem Unterbau aus app.ts. Was es im Browser nicht gibt (CalDAV, SQL,
 * Updates, Tastenkürzel …), antwortet harmlos; die Oberfläche blendet es aus.
 */

import type { Api } from '../main/api'
import { parseFileData } from '../main/contactImport'
import type { CalEvent, ChatFile, Contact, PageName, PbxForwardChange } from '../shared/types'
import { normalizeNumber } from '../shared/numbers'
import type { WebApp } from './app'
import { sameOriginWebsocket } from './phone'
import { saveCustomTone, toneData } from './sound'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

async function attempt<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (e) {
    return { ok: false, error: (e as Error).message || String(e) }
  }
}

const NOT_HERE = 'Im Browser nicht verfügbar – bitte die Desktop-App verwenden.'

/** Dateiauswahl des Browsers; leer, wenn abgebrochen */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.style.display = 'none'
    const done = (files: File[]): void => {
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', () => done([...(input.files ?? [])]))
    input.addEventListener('cancel', () => done([]))
    document.body.append(input)
    input.click()
  })
}

async function bytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

/** Datei herunterladen lassen (Speichern-Dialog bzw. Download-Ordner des Browsers) */
function download(url: string, name: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
}

type WebApi = { [K in keyof Api]: (...args: Parameters<Api[K]>) => unknown }

export function createWebApi(app: WebApp): WebApi {
  const { store, phone, calendar, provisioning, messenger } = app
  const fileUrl = (room: string, file: ChatFile): string => {
    const base = provisioning.usableUrl
    if (!base) throw new Error('Keine Telefonanlage eingerichtet')
    return `${base}/chat/files/${encodeURIComponent(room)}/${encodeURIComponent(file.id)}`
  }
  const importFiles = async (files: File[]): Promise<void> => {
    const imported: Omit<Contact, 'id'>[] = []
    let skipped = 0
    const failed: string[] = []
    for (const file of files) {
      try {
        let data = await bytes(file)
        // UTF-8-BOM hier entfernen (readText erwartet sonst einen Node-Buffer)
        if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) data = data.subarray(3)
        const [contacts, without] = parseFileData(data as unknown as Parameters<typeof parseFileData>[0])
        imported.push(...contacts)
        skipped += without
      } catch (e) {
        failed.push(`${file.name}: ${(e as Error).message}`)
      }
    }
    if (failed.length) app.send('toast', 'Import fehlgeschlagen: ' + failed.join('; '))
    if (!imported.length) {
      if (!failed.length) app.send('toast', 'Keine Kontakte mit Telefonnummer gefunden')
      return
    }
    const [added, merged] = store.importContacts(imported as Contact[])
    app.contactsChanged()
    if (!added && !merged) app.send('toast', 'Alle Kontakte waren schon vorhanden')
    else app.send('toast', 'Import: ' + [`${added} neu`, `${merged} ergänzt`, ...(skipped ? [`${skipped} ohne Nr.`] : [])].join(' · '))
    app.showPage('contacts')
  }
  const upload = async (room: string, files: File[]): Promise<number> => {
    for (const f of files) await messenger.upload(room, f.name, f.type, await bytes(f))
    return files.length
  }

  return {
    // -- Zustand -------------------------------------------------------------
    getState: () => app.state(),
    getHistory: () => store.historyRows(),
    markHistorySeen: () => app.markHistorySeen(),

    // -- Anrufe --------------------------------------------------------------
    dial: (number: string) => phone.dial(number),
    accept: (id: string) => phone.accept(id),
    hangup: (id?: string) => phone.hangup(id),
    setMute: (muted: boolean, id?: string) => phone.setMute(muted, id),
    setHold: (held: boolean, id?: string) => phone.setHold(held, id),
    switchCall: (id: string) => phone.switchTo(id),
    sendDtmf: (digit: string, id?: string) => phone.sendDtmf(digit, id),
    stopRinging: () => phone.stopRinging(),
    transfer: (id: string, target: string) => phone.transfer(id, target),
    openInWindow: (id: string) => phone.openInWindow(id),
    hidePopup: () => undefined,
    scheduleCallback: (number: string, name: string) => phone.scheduleCallback(number, name),

    // -- Anmeldung und Audio -------------------------------------------------
    setDnd: (active: boolean) => phone.setDnd(active),
    setRegistered: (registered: boolean) => phone.setRegistered(registered),
    restartEngine: () => {
      const url = app.state().banner?.url
      if (url) location.assign(url)
      else if (phone.standby) app.claimPhone(true)
      else phone.restartEngine()
    },

    // -- Diagnose ------------------------------------------------------------
    getDiagnose: () => app.diagnose(),
    checkNow: () => app.diagnose(),
    setWatchdog: (enabled: boolean) => {
      store.settings.watchdog = enabled
      store.saveSettings()
    },
    clearDiagnose: () => undefined,
    setAudio: (kind: 'source' | 'sink' | 'alert', device: string) => phone.setAudio(kind, device),
    refreshDevices: () => app.refreshDevices(),
    setRingtone: (key: string) => phone.setRingtone(key),
    ringtoneData: (key: string) => toneData(key),
    saveCustomRingtone: (wav: Uint8Array) => {
      saveCustomTone(wav)
      phone.setRingtone('custom')
    },
    chooseAudioFile: async () => {
      const [file] = await pickFiles('audio/*,.wav,.mp3,.ogg,.oga,.opus,.flac,.m4a,.aac,.webm')
      return file ? bytes(file) : null
    },

    // -- Einstellungen -------------------------------------------------------
    getPassword: () => store.getPassword(),
    // Die Kontodaten kommen im Browser immer von der Anlage
    saveAccount: () => true,
    setAppearance: (values) => {
      Object.assign(store.settings.appearance, values)
      store.saveSettings()
      app.stateChanged()
    },
    setBehaviour: (values) => {
      Object.assign(store.settings, values)
      store.saveSettings()
      app.stateChanged()
    },
    /** Telefon-Links (tel:, sip:) im Browser an den Web-Client geben */
    setLinks: (values: { handler?: boolean; hotkey?: string }) => {
      if (values.handler) {
        try {
          const target = `${location.origin}${location.pathname}#dial=%s`
          navigator.registerProtocolHandler('tel', target)
          navigator.registerProtocolHandler('sip', target)
        } catch {
          app.send('toast', 'Der Browser lässt das nicht zu.')
          return false
        }
      }
      store.settings.links.handler = Boolean(values.handler ?? store.settings.links.handler)
      store.saveSettings()
      app.stateChanged()
      return true
    },
    setReminderMinutes: (minutes: number) => {
      store.settings.calendar.reminder_minutes = minutes
      store.saveSettings()
      app.stateChanged()
    },
    setHome: (values) => {
      Object.assign(store.settings.home, values)
      store.saveSettings()
      app.stateChanged()
    },
    clearHistory: () => {
      store.clearHistory()
      app.historyChanged(false)
    },
    logPath: () => '',
    openLog: () => undefined,
    openOnlineAccounts: () => undefined,
    quit: () => void app.logout(),

    // -- Aktualisierung (macht die Anlage) ------------------------------------
    checkUpdate: () => undefined,
    installUpdate: () => ({ ok: false, error: 'Der Web-Client wird mit der Telefonanlage aktualisiert.' }),
    openReleasePage: () => undefined,
    setAutoUpdate: () => undefined,

    // -- Einrichtung durch die Telefonanlage ---------------------------------------
    pbxDiscover: () => [],
    pbxFromLink: (link: string) => attempt(() => provisioning.fromLink(link)),
    pbxFromPin: (_server: string, extension: string, pin: string) => attempt(() => provisioning.fromPin(location.origin, extension, pin)),
    pbxApply: () => provisioning.apply(),
    pbxDisconnect: () => void app.logout(),
    pbxSetForward: (change: PbxForwardChange) => attempt(() => provisioning.setForward(change)),
    pbxLoadForward: () => provisioning.loadForward(),
    pbxSaveContact: (contact: Pick<Contact, 'name' | 'company' | 'phone' | 'mobile' | 'pbx'>) => attempt(() => provisioning.savePhonebookEntry(contact)),
    pbxDeleteContact: (id: string) => attempt(() => provisioning.deletePhonebookEntry(id)),
    takePbxLink: () => null,
    pbxVoicemail: () => attempt(() => provisioning.voicemailList()),
    pbxVoicemailAudio: (id: string) => attempt(() => provisioning.voicemailAudio(id)),
    pbxVoicemailRead: (id: string) => attempt(() => provisioning.voicemailRead(id)),
    pbxVoicemailDelete: (id: string) => attempt(() => provisioning.voicemailDelete(id)),
    pbxBlock: (number: string, note: string) => attempt(() => provisioning.blockNumber(number, note)),
    consult: (id: string, target: string) => phone.consult(id, target),
    pbxJoinCalls: (mode: 'transfer' | 'conference') =>
      attempt(async () => {
        await provisioning.joinCalls(mode)
        phone.afterJoin(mode)
      }),
    pbxSetGroup: (id: string, active: boolean) => attempt(() => provisioning.setGroup(id, active)),
    pbxGroupMissed: () => attempt(() => provisioning.groupMissedList()),
    pbxSetBoss: (id: string, active: boolean) => attempt(() => provisioning.setBoss(id, active)),
    pbxCallback: (to: string) => attempt(() => provisioning.requestCallback(to)),
    pbxCallbackCancel: (id: string) => attempt(() => provisioning.cancelCallback(id)),
    pbxSendSms: (to: string, text: string) => attempt(() => provisioning.sendSms(to, text)),
    pbxGroupMissedAct: (group: string, id: string, action: 'claim' | 'release' | 'done' | 'reopen') => attempt(() => provisioning.groupMissedAct(group, id, action)),
    pbxFaxInfo: () => attempt(() => provisioning.faxInfo()),
    pbxSendFax: (box: string, number: string, pdf: Uint8Array) => attempt(() => provisioning.sendFax(box, number, pdf)),
    pickPdf: () =>
      attempt(async () => {
        const [file] = await pickFiles('application/pdf,.pdf')
        if (!file) return null
        if (file.size > 20 * 1024 * 1024) throw new Error('Die Datei ist größer als 20 MB.')
        return { name: file.name, data: await bytes(file) }
      }),
    park: (id: string) => {
      const parking = store.settings.provisioning.parking
      if (parking) phone.transfer(id, parking.number)
    },
    openCrm: (number: string, name: string) => app.openCrm(number, name),
    /** Farbe der Browserleiste (z. B. auf dem Handy) passend zum Thema */
    setTitleBarColors: (color: string) => {
      let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      if (!meta) {
        meta = document.createElement('meta')
        meta.name = 'theme-color'
        document.head.append(meta)
      }
      meta.content = color
    },

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
    importContacts: async () => {
      const files = await pickFiles('.vcf,.vcard,.csv,text/vcard,text/csv', true)
      if (files.length) await importFiles(files)
    },
    importFiles: (paths: string[]) => importFiles(paths.map((p) => app.takeFile(p)).filter((f): f is File => f !== null)),
    syncContacts: async () => {
      await provisioning.refresh()
      app.syncBook()
      app.send('toast', `Telefonbuch der Anlage abgeglichen (${store.external.length} Kontakte)`)
    },
    setBookEnabled: (id: string, enabled: boolean) => {
      const disabled = new Set(store.settings.addressbooks.disabled)
      if (enabled) disabled.delete(id)
      else disabled.add(id)
      store.settings.addressbooks.disabled = [...disabled].sort()
      store.saveSettings()
      app.syncBook()
    },
    setBooksUseEds: () => undefined,

    // -- CalDAV/CardDAV und SQL gibt es im Browser nicht ---------------------------------------
    davSecret: () => '',
    addDavAccount: () => ({ ok: false, error: NOT_HERE }),
    removeDavAccount: () => undefined,
    sqlSecret: () => '',
    sqlTables: () => ({ ok: false, error: NOT_HERE }),
    sqlColumns: () => ({ ok: false, error: NOT_HERE }),
    sqlTestAndSave: () => ({ ok: false, error: NOT_HERE }),
    sqlRemove: () => undefined,

    // -- Kalender --------------------------------------------------------------
    fetchEvents: (start: number, end: number) => calendar.fetch(start, end),
    saveEvent: (ev: CalEvent) => attempt(() => calendar.save(ev)),
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
    setCalendarUseEds: () => undefined,
    defaultCalendar: () => calendar.defaultCalendar()?.id ?? null,

    // -- Messenger -----------------------------------------------------------
    messengerState: () => messenger.state,
    messengerHistory: (room: string, before?: number) => attempt(() => messenger.loadHistory(room, before)),
    messengerSend: (room: string, text: string) => attempt(() => messenger.sendText(room, text)),
    messengerDirect: (ext: string) => attempt(() => messenger.openDirect(ext)),
    messengerGroup: (name: string, members: string[]) => attempt(() => messenger.createGroup(name, members)),
    messengerUpdateGroup: (room: string, change: { name?: string; members?: string[] }) => attempt(() => messenger.updateGroup(room, change)),
    messengerLeave: (room: string) => attempt(() => messenger.leave(room)),
    messengerRead: (room: string, seq: number) => messenger.markRead(room, seq),
    messengerTyping: (room: string) => messenger.typing(room),
    messengerVideoAccount: () => {
      const p = store.settings.provisioning
      // Auch Videoanrufe über die Adresse dieser Seite
      return p.messenger && p.video ? { ...p.video, websocket: sameOriginWebsocket(), password: store.getPassword() } : null
    },
    messengerDecline: (room: string) => messenger.decline(room),
    messengerMediaAccess: () => true,
    // Den Bildschirm wählt der Browser selbst aus (getDisplayMedia)
    screenSources: () => ({ ok: true, value: [] }),
    chooseScreen: () => undefined,
    messengerInCall: (room: string | null) => {
      app.videoCall = room
    },
    messengerFocus: (room: string | null) => {
      app.openChat = room
    },
    messengerPickFiles: (room: string) =>
      attempt(async () => {
        const files = await pickFiles('*/*', true)
        return upload(room, files)
      }),
    messengerSendFiles: (room: string, files: string[]) => attempt(() => upload(room, files.map((p) => app.takeFile(p)).filter((f): f is File => f !== null))),
    messengerSendData: (room: string, name: string, type: string, data: Uint8Array) => attempt(() => messenger.upload(room, name, type, data)),
    /** Vorschaubilder direkt von der Anlage (gleiche Adresse) */
    messengerImage: (room: string, file: ChatFile) => attempt(() => (file.type.startsWith('image/') && file.size <= 10 * 1024 * 1024 ? fileUrl(room, file) : '')),
    messengerOpenFile: (room: string, file: ChatFile) =>
      attempt(() => {
        // Bilder, PDFs, Text und Medien zeigt der Browser selbst, alles andere wird geladen
        if (/^(image|audio|video|text)\/|^application\/pdf$/.test(file.type)) window.open(fileUrl(room, file), '_blank', 'noopener')
        else download(fileUrl(room, file), file.name)
      }),
    messengerSaveFile: (room: string, file: ChatFile) =>
      attempt(() => {
        download(fileUrl(room, file), file.name)
        return true
      }),
  }
}

/** Seite aus dem Hash (#page=…) oder Telefon-Link (#dial=tel:…) beim Start */
export function startAction(hash: string): { dial?: string; page?: PageName } {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const dial = params.get('dial')
  if (dial) {
    const number = decodeURIComponent(dial).replace(/^(tel|sip|callto):(\/\/)?/i, '').split(/[;?]/)[0]
    return { dial: number }
  }
  return {}
}
