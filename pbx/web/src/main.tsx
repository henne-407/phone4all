import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material'
import { StrictMode, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { buildTheme } from './theme'

function Root() {
  const dark = useMediaQuery('(prefers-color-scheme: dark)')
  const theme = useMemo(() => buildTheme(dark), [dark])
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
