/** Einstiegspunkt des Hauptprozesses. */

import { Menu, app as electronApp, systemPreferences } from 'electron'
import { App } from './app'

const background = process.argv.includes('--background') || process.argv.includes('-b')

electronApp.setName('SIP-Telefon')
if (process.platform === 'win32') electronApp.setAppUserModelId('de.hpieper.SipTelefon')

// Nur eine Instanz: ein zweiter Start holt das vorhandene Fenster nach vorn
if (!electronApp.requestSingleInstanceLock()) {
  electronApp.exit(0)
} else {
  let instance: App | null = null

  electronApp.on('second-instance', (_e, argv) => {
    if (!argv.includes('--background')) instance?.present()
  })

  electronApp.whenReady().then(() => {
    if (process.platform === 'darwin') {
      // baresip läuft als Kindprozess und erbt die Mikrofonfreigabe der App
      void systemPreferences.askForMediaAccess('microphone')
      // macOS braucht ein Programmmenü für Kurzbefehle wie ⌘Q, ⌘C, ⌘V
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: 'SIP-Telefon',
            submenu: [
              { role: 'about', label: 'Über SIP-Telefon' },
              { type: 'separator' },
              { label: 'Einstellungen …', accelerator: 'Cmd+,', click: () => instance?.send('open-preferences', 'account') },
              { type: 'separator' },
              { role: 'hide', label: 'SIP-Telefon ausblenden' },
              { role: 'hideOthers', label: 'Andere ausblenden' },
              { type: 'separator' },
              { label: 'SIP-Telefon beenden', accelerator: 'Cmd+Q', click: () => instance?.quit() },
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
