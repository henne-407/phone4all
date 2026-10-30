/**
 * Start des Web-Clients: Unterbau anlegen, als window.bridge bereitstellen (wie der
 * Preload der Desktop-App) und dann die Oberfläche der Desktop-App laden – oder, ohne
 * Anmeldung, erst die Anmeldeseite zeigen.
 */

import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material'
import { StrictMode, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { buildTheme } from '../renderer/src/theme'
import { paletteFor } from '../shared/themes'
import { createWebApi, startAction } from './api'
import { WebApp } from './app'
import { Login } from './Login'

const app = new WebApp()
const api = createWebApi(app) as Record<string, (...args: unknown[]) => unknown>

window.bridge = {
  invoke: async (method: string, ...args: unknown[]) => {
    // Nur eigene Funktionen der Schnittstelle, nichts aus der Prototypkette
    const fn = Object.hasOwn(api, method) ? api[method] : undefined
    if (typeof fn !== 'function') throw new Error(`Unbekannte Funktion: ${method}`)
    // Wie über IPC: Kopien statt geteilter Objekte
    return structuredClone(await fn(...args))
  },
  on: (channel: string, listener: (...args: unknown[]) => void) => app.on(channel, listener),
  pathForFile: (file: File) => app.registerFile(file),
  platform: 'web',
}

// Benachrichtigungen erlauben lassen (Browser fragen nur nach einer Bedienung)
if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
  document.addEventListener('pointerdown', () => void Notification.requestPermission().catch(() => undefined), { once: true })
}

/** Telefon-Link (#dial=…): wählen, sobald die Anmeldung steht */
function handleHash(): void {
  const { dial } = startAction(location.hash)
  if (!dial) return
  history.replaceState(null, '', location.pathname)
  let tries = 0
  const timer = setInterval(() => {
    if (app.phone.reg.kind === 'ok' || ++tries > 30) {
      clearInterval(timer)
      app.phone.dial(dial)
    }
  }, 500)
}

async function boot(): Promise<void> {
  app.start()
  handleHash()
  window.addEventListener('hashchange', handleHash)
  await import('../renderer/src/main')
}

function LoginPage({ onDone }: { onDone: () => void }) {
  const dark = useMediaQuery('(prefers-color-scheme: dark)')
  const { theme: key, style } = app.store.settings.appearance
  const theme = useMemo(() => buildTheme(style, paletteFor(key, dark, null), dark), [style, key, dark])
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <Login app={app} onDone={onDone} />
    </ThemeProvider>
  )
}

if (app.loggedIn) {
  void boot()
} else {
  const container = document.getElementById('login')!
  const root = createRoot(container)
  root.render(
    <StrictMode>
      <LoginPage
        onDone={() => {
          root.unmount()
          container.remove()
          void boot()
        }}
      />
    </StrictMode>,
  )
}
