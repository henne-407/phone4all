/** Material-3-Thema (Baseline-Farben, runde Formen, Tonflächen statt Schatten). */

import { createTheme, type Theme } from '@mui/material/styles'

const LIGHT = {
  primary: '#6750a4',
  onPrimary: '#ffffff',
  primaryContainer: '#eaddff',
  onPrimaryContainer: '#21005d',
  secondary: '#625b71',
  secondaryContainer: '#e8def8',
  onSecondaryContainer: '#1d192b',
  error: '#b3261e',
  success: '#2e7d32',
  warning: '#8c5000',
  surface: '#fef7ff',
  surfaceContainerLow: '#f7f2fa',
  surfaceContainer: '#f3edf7',
  surfaceContainerHigh: '#ece6f0',
  onSurface: '#1d1b20',
  onSurfaceVariant: '#49454f',
  outline: '#79747e',
  outlineVariant: '#cac4d0',
}

const DARK: typeof LIGHT = {
  primary: '#d0bcff',
  onPrimary: '#381e72',
  primaryContainer: '#4f378b',
  onPrimaryContainer: '#eaddff',
  secondary: '#ccc2dc',
  secondaryContainer: '#4a4458',
  onSecondaryContainer: '#e8def8',
  error: '#f2b8b5',
  success: '#81c784',
  warning: '#ffb870',
  surface: '#141218',
  surfaceContainerLow: '#1d1b20',
  surfaceContainer: '#211f26',
  surfaceContainerHigh: '#2b2930',
  onSurface: '#e6e0e9',
  onSurfaceVariant: '#cac4d0',
  outline: '#938f99',
  outlineVariant: '#49454f',
}

export type M3Colors = typeof LIGHT

declare module '@mui/material/styles' {
  interface Theme {
    m3: M3Colors
  }
  interface ThemeOptions {
    m3?: M3Colors
  }
}

export function buildTheme(dark: boolean): Theme {
  const c = dark ? DARK : LIGHT
  return createTheme({
    m3: c,
    palette: {
      mode: dark ? 'dark' : 'light',
      primary: { main: c.primary, contrastText: c.onPrimary },
      secondary: { main: c.secondary },
      error: { main: c.error },
      success: { main: c.success },
      warning: { main: c.warning },
      background: { default: c.surface, paper: c.surfaceContainerLow },
      text: { primary: c.onSurface, secondary: c.onSurfaceVariant },
      divider: c.outlineVariant,
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: 'Roboto, system-ui, sans-serif',
      h5: { fontWeight: 400 },
      h6: { fontWeight: 500, fontSize: '1.125rem' },
      button: { textTransform: 'none', fontWeight: 500, letterSpacing: '0.01em' },
    },
    components: {
      MuiCssBaseline: { styleOverrides: { body: { backgroundColor: c.surface } } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 20, paddingInline: 20, minHeight: 40 } },
      },
      MuiFab: { styleOverrides: { root: { borderRadius: 16, boxShadow: 'none', textTransform: 'none' } } },
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { borderRadius: 16, backgroundColor: c.surfaceContainerLow } },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: 28, backgroundColor: c.surfaceContainerHigh } },
      },
      MuiDialogTitle: { styleOverrides: { root: { fontSize: '1.5rem', fontWeight: 400, paddingTop: 24 } } },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            '&.Mui-selected': { backgroundColor: c.secondaryContainer, color: c.onSecondaryContainer },
            '&.Mui-selected:hover': { backgroundColor: c.secondaryContainer },
          },
        },
      },
      MuiChip: { styleOverrides: { root: { borderRadius: 8 } } },
      MuiTextField: { defaultProps: { fullWidth: true, size: 'medium' } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 500 } } },
      MuiTableCell: { styleOverrides: { root: { borderColor: c.outlineVariant } } },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 28 } } },
      MuiSnackbarContent: { styleOverrides: { root: { borderRadius: 8 } } },
    },
  })
}
