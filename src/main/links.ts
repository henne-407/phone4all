/**
 * Wähl-Links: Telefonnummern im Browser oder in anderen Programmen anklicken (tel:,
 * callto:, sip:) und ein Tastenkürzel, das die markierte Nummer wählt. Beides ist
 * abschaltbar, weil die App sonst anderen Programmen die Links wegnimmt.
 */

import { app as electronApp, clipboard, globalShortcut } from 'electron'
import path from 'node:path'
import { findNumbers, normalizeNumber } from '../shared/numbers'

export const DIAL_SCHEMES = ['tel', 'callto', 'sip'] as const

/** Ist das ein Wähl-Link (und nicht der Einrichtungslink sip-telefon:)? */
export function isDialLink(link: string): boolean {
  return /^(tel|callto|sip):/i.test(link.trim())
}

/**
 * tel:+49-30-123456, callto://+4930123456, sip:10@pbx.local;transport=tcp → Nummer.
 * Nur Ziffern, + * #; alles andere (Parameter, Domain) fällt weg.
 */
export function numberFromLink(link: string): string {
  const m = /^(?:tel|callto|sip):(?:\/\/)?([^?;@]*)/i.exec(link.trim())
  if (!m) return ''
  let raw = m[1]
  try {
    raw = decodeURIComponent(raw)
  } catch {
    // ungültige Kodierung: so nehmen, wie es ist
  }
  const n = normalizeNumber(raw)
  return /\d/.test(n) && n.length <= 32 ? n : ''
}

/** Erste Telefonnummer in markiertem Text; kurze Nummern (Nebenstellen) auch allein */
export function numberFromText(text: string): string {
  const t = text.trim()
  if (/^\+?[\d\s\-/().]{2,30}$/.test(t)) return normalizeNumber(t)
  const found = findNumbers(t)[0]
  return found ? normalizeNumber(found) : ''
}

/** App als Standard für tel:, callto: und sip: eintragen oder austragen */
export function setLinkHandler(enabled: boolean): void {
  for (const scheme of DIAL_SCHEMES) {
    if (enabled) {
      if (process.defaultApp && process.argv[1]) electronApp.setAsDefaultProtocolClient(scheme, process.execPath, [path.resolve(process.argv[1])])
      else electronApp.setAsDefaultProtocolClient(scheme)
    } else if (electronApp.isDefaultProtocolClient(scheme)) {
      electronApp.removeAsDefaultProtocolClient(scheme)
    }
  }
}

/** Markierter Text: unter Linux die Auswahl (ohne Kopieren), sonst die Zwischenablage */
export async function selectedText(): Promise<string> {
  if (process.platform === 'linux' && clipboard.selection) {
    const selection = await clipboard.selection.readText().catch(() => '')
    if (selection.trim()) return selection
  }
  return clipboard.readText().catch(() => '')
}

let registered = ''

/** Tastenkürzel (z. B. „CommandOrControl+Shift+D“) setzen; '' = aus. Gibt false zurück, wenn es belegt ist. */
export function setHotkey(accelerator: string, onPress: () => void): boolean {
  if (registered) globalShortcut.unregister(registered)
  registered = ''
  if (!accelerator) return true
  try {
    if (!globalShortcut.register(accelerator, onPress)) return false
  } catch {
    return false
  }
  registered = accelerator
  return true
}
