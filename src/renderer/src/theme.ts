/** Standard-MUI-Theme; das gewählte Farbthema bestimmt nur die Primärfarbe. */

import { createTheme, type Theme } from '@mui/material/styles'

export function buildTheme(primary: string, dark: boolean): Theme {
  const base = createTheme({ palette: { mode: dark ? 'dark' : 'light' } })
  return createTheme(base, {
    palette: {
      primary: base.palette.augmentColor({ color: { main: primary } }),
    },
    components: {
      // App-Verhalten statt Gestaltung: kein Markieren der Oberfläche, Seiten scrollen selbst
      MuiCssBaseline: {
        styleOverrides: {
          body: { userSelect: 'none', overflow: 'hidden' },
          'input, textarea, [contenteditable]': { userSelect: 'text' },
        },
      },
      MuiTextField: { defaultProps: { fullWidth: true } },
    },
  })
}
