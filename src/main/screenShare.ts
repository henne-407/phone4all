/**
 * Bildschirm teilen im Videoanruf: Die Oberfläche zeigt die Auswahl (Bildschirme und
 * Fenster) selbst; getDisplayMedia bekommt danach genau die gewählte Quelle.
 */

import { desktopCapturer, session } from 'electron'

export interface ScreenSource {
  id: string
  name: string
  /** ganzer Bildschirm (sonst ein Fenster) */
  screen: boolean
  /** Vorschaubild als data:-Adresse ('' = keins) */
  thumbnail: string
}

let chosen = ''

export async function screenSources(): Promise<ScreenSource[]> {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } })
  return sources.map((s) => ({ id: s.id, name: s.name, screen: s.id.startsWith('screen:'), thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL() }))
}

/** Quelle für den nächsten Aufruf von getDisplayMedia merken */
export function chooseScreen(id: string): void {
  chosen = id
}

export function setupScreenShare(): void {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const id = chosen
    chosen = ''
    void desktopCapturer.getSources({ types: ['screen', 'window'] }).then(
      (sources) => {
        // Ohne vorherige Auswahl in der App nichts freigeben
        const source = sources.find((s) => s.id === id)
        callback(source ? { video: source } : {})
      },
      () => callback({}),
    )
  })
}
