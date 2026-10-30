import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material'
import { StrictMode, useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { paletteFor } from '../../shared/themes'
import type { AppState } from '../../shared/types'
import { api } from './api'
import { CallWindow } from './CallWindow'
import { MainWindow } from './MainWindow'
import { StateProvider } from './state'
import { buildTheme, titleBarColors } from './theme'

const hash = new URLSearchParams(window.location.hash.slice(1))
const callId = hash.get('call')

function Themed({ state }: { state: AppState }) {
  // Hell/Dunkel fest eingestellt: selbst auswerten. Unter Linux kommt nativeTheme.themeSource
  // nicht immer als prefers-color-scheme in der Oberfläche an, dann bliebe „Dunkel“ hell.
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const { theme: key, style, scheme } = state.settings.appearance
  const dark = scheme === 'system' ? systemDark : scheme === 'dark'
  const theme = useMemo(() => {
    return buildTheme(style, paletteFor(key, dark, state.platform.accent), dark)
  }, [style, key, dark, state.platform.accent])

  useEffect(() => {
    void api.setTitleBarColors(...titleBarColors(theme))
    // Auch <html> einfärben: beim Vergrößern ist die Seite kurz größer als der Inhalt
    document.documentElement.style.backgroundColor = theme.palette.background.default
    document.title = callId ? 'Anruf' : 'Phone4All'
  }, [theme])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      {callId ? <CallWindow callId={callId} /> : <MainWindow />}
    </ThemeProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StateProvider>{(state) => <Themed state={state} />}</StateProvider>
  </StrictMode>,
)
