/**
 * Entwicklungshilfe: Bildschirmfotos der Oberfläche ohne sichtbares Fenster.
 *
 *   SIP_TELEFON_SCREENSHOT=/pfad/ordner npm start
 *
 * Fotografiert das Hauptfenster in mehreren Größen und Ansichten und beendet sich.
 * Optional SIP_TELEFON_SCREENSHOT_SCRIPT=datei.json mit [{name, width, height, js}].
 */

import fs from 'node:fs'
import path from 'node:path'
import type { App } from './app'

interface Shot {
  name: string
  width: number
  height: number
  js?: string
  wait?: number
  /** Simulierter Anruf: 'incoming' | 'established' | 'none' */
  call?: 'incoming' | 'established' | 'none'
}

const DEFAULT_SHOTS: Shot[] = [
  { name: 'home-narrow', width: 420, height: 760 },
  { name: 'home-wide', width: 1280, height: 800 },
]

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function fakeCall(app: App, kind: Shot['call']): void {
  app.phone.calls.clear()
  if (kind && kind !== 'none') {
    app.phone.calls.set('test', {
      id: 'test',
      direction: 'in',
      number: '+49 30 1234567',
      name: 'Erika Mustermann',
      company: 'Beispiel GmbH',
      state: kind,
      created: Date.now(),
      established: kind === 'established' ? Date.now() - 83000 : null,
      muted: false,
      held: false,
      remoteHeld: false,
      mini: false,
      transferredTo: null,
      declined: false,
      pendingTransfer: null,
    })
  }
  app.stateChanged()
}

export async function takeScreenshots(app: App, dir: string): Promise<void> {
  const win = app.mainWindow()!
  const scriptFile = process.env.SIP_TELEFON_SCREENSHOT_SCRIPT
  const shots: Shot[] = scriptFile ? JSON.parse(fs.readFileSync(scriptFile, 'utf8')) : DEFAULT_SHOTS
  fs.mkdirSync(dir, { recursive: true })
  await sleep(2500)
  for (const shot of shots) {
    win.setContentSize(shot.width, shot.height)
    await sleep(300)
    if (shot.call) fakeCall(app, shot.call)
    if (shot.js) {
      try {
        await win.webContents.executeJavaScript(shot.js)
      } catch (e) {
        fs.writeFileSync(path.join(dir, `${shot.name}.error.txt`), String(e))
      }
    }
    await sleep(shot.wait ?? 700)
    win.webContents.invalidate()
    await sleep(200)
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(dir, `${shot.name}.png`), image.toPNG())
  }
}
