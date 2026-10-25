/** Einstiegspunkt des Hauptprozesses. */

import { Menu, app as electronApp, systemPreferences } from 'electron'
import path from 'node:path'
import { App } from './app'
import { LINK_SCHEME } from './provisioning'

const background = process.argv.includes('--background') || process.argv.includes('-b')

/** Einrichtungslink der Telefonanlage aus der Befehlszeile (Windows/Linux) */
const linkArg = (argv: string[]): string | undefined => argv.find((a) => a.startsWith(`${LINK_SCHEME}://`))

// Interner Name bleibt „SIP-Telefon“: davon hängen der Ordner der Einstellungen
// (macOS/Windows), der Schlüssel im Schlüsselbund und die Fensterklasse ab.
// Angezeigt wird überall „Phone4All“ (productName).
electronApp.setName('SIP-Telefon')
if (process.platform === 'win32') electronApp.setAppUserModelId('de.hpieper.SipTelefon')

// Nur eine Instanz: ein zweiter Start holt das vorhandene Fenster nach vorn
if (!electronApp.requestSingleInstanceLock()) {
  electronApp.exit(0)
} else {
  let instance: App | null = null
  let startLink = linkArg(process.argv)

  // sip-telefon://provision?url=… öffnet die App und schlägt die Einrichtung vor
  if (process.defaultApp && process.argv[1]) {
    electronApp.setAsDefaultProtocolClient(LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])])
  } else {
    electronApp.setAsDefaultProtocolClient(LINK_SCHEME)
  }
  electronApp.on('open-url', (e, url) => {
    e.preventDefault()
    if (instance) instance.openLink(url)
    else startLink = url
  })

  electronApp.on('second-instance', (_e, argv) => {
    const link = linkArg(argv)
    if (link) instance?.openLink(link)
    else if (!argv.includes('--background')) instance?.present()
  })

  electronApp.whenReady().then(() => {
    if (process.platform === 'darwin') {
      // baresip läuft als Kindprozess und erbt die Mikrofonfreigabe der App
      void systemPreferences.askForMediaAccess('microphone')
      // macOS braucht ein Programmmenü für Kurzbefehle wie ⌘Q, ⌘C, ⌘V
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: 'Phone4All',
            submenu: [
              { role: 'about', label: 'Über Phone4All' },
              { type: 'separator' },
              { label: 'Einstellungen …', accelerator: 'Cmd+,', click: () => instance?.send('open-preferences', 'account') },
              { type: 'separator' },
              { role: 'hide', label: 'Phone4All ausblenden' },
              { role: 'hideOthers', label: 'Andere ausblenden' },
              { type: 'separator' },
              { label: 'Phone4All beenden', accelerator: 'Cmd+Q', click: () => instance?.quit() },
            ],
          },
          { role: 'editMenu', label: 'Bearbeiten' },
          { role: 'windowMenu', label: 'Fenster' },
        ]),
      )
    } else {
      Menu.setApplicationMenu(null)
    }
    instance = new App()
    const shotDir = process.env.SIP_TELEFON_SCREENSHOT
    instance.start(background || Boolean(shotDir))
    if (startLink) instance.openLink(startLink)
    if (shotDir) {
      const app = instance
      void import('./screenshot')
        .then((m) => m.takeScreenshots(app, shotDir))
        .finally(() => app.quit())
    }
    electronApp.on('activate', () => instance?.present())
  })

  electronApp.on('before-quit', (e) => {
    // ⌘Q, Abmelden usw.: baresip zuerst sauber beenden
    if (instance) {
      e.preventDefault()
      instance.quit()
    }
  })

  // Das Programm läuft ohne Fenster weiter (Tray, eingehende Anrufe)
  electronApp.on('window-all-closed', () => undefined)
}
