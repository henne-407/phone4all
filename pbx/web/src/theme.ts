/**
 * Thema der Weboberfläche: ruhige, kontrastreiche Flächen (weiße Karten mit Rand auf
 * hellgrauem Grund), ein klares Blau für Aktionen und kräftige Statusfarben. Die
 * Formen folgen Material 3, die Farben sind auf Lesbarkeit statt Tonflächen ausgelegt.
 */

import { alpha, createTheme, type Theme } from '@mui/material/styles'

const LIGHT = {
  primary: '#0b57d0',
  onPrimary: '#ffffff',
  primaryContainer: '#d3e3fd',
  onPrimaryContainer: '#041e49',
  secondaryContainer: '#e8eef7',
  onSecondaryContainer: '#1b2a3d',
  error: '#c5221f',
  success: '#137333',
  warning: '#b06000',
  info: '#0b57d0',
  background: '#f3f5f8',
  surface: '#ffffff',
  surfaceVariant: '#f7f9fc',
  sidebar: '#ffffff',
  onSurface: '#1b1f24',
  onSurfaceVariant: '#4f5864',
  outline: '#c7ced8',
  outlineVariant: '#e1e6ec',
  /** Farben der Knoten im Ablaufdiagramm */
  node: {
    number: '#0b57d0',
    extension: '#137333',
    group: '#8430ce',
    ivr: '#b06000',
    timecondition: '#007b83',
    voicemail: '#5f6368',
    conference: '#c5221f',
    announcement: '#9c27b0',
    external: '#1a73e8',
    fax: '#795548',
    ai: '#00897b',
    hangup: '#80868b',
  },
}

const DARK: typeof LIGHT = {
  primary: '#a8c7fa',
  onPrimary: '#062e6f',
  primaryContainer: '#0842a0',
  onPrimaryContainer: '#d3e3fd',
  secondaryContainer: '#27303c',
  onSecondaryContainer: '#dbe4f0',
  error: '#f2b8b5',
  success: '#6dd58c',
  warning: '#ffb870',
  info: '#a8c7fa',
  background: '#111418',
  surface: '#1a1e24',
  surfaceVariant: '#20252c',
  sidebar: '#161a1f',
  onSurface: '#e6e9ee',
  onSurfaceVariant: '#aab3be',
  outline: '#4a525d',
  outlineVariant: '#2c333c',
  node: {
    number: '#a8c7fa',
    extension: '#6dd58c',
    group: '#d7aefb',
    ivr: '#ffb870',
    timecondition: '#5fd4dc',
    voicemail: '#bdc1c6',
    conference: '#f2b8b5',
    announcement: '#e3a5ef',
    external: '#8ab4f8',
    fax: '#bcaaa4',
    ai: '#80cbc4',
    hangup: '#9aa0a6',
  },
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
      error: { main: c.error },
      success: { main: c.success },
      warning: { main: c.warning },
      info: { main: c.info },
      background: { default: c.background, paper: c.surface },
      text: { primary: c.onSurface, secondary: c.onSurfaceVariant },
      divider: c.outlineVariant,
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: 'Roboto, system-ui, sans-serif',
      h4: { fontWeight: 600, fontSize: '1.75rem', letterSpacing: '-0.01em' },
      h5: { fontWeight: 600, fontSize: '1.375rem' },
      h6: { fontWeight: 600, fontSize: '1.0625rem' },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      body1: { fontSize: '0.9375rem' },
      button: { textTransform: 'none', fontWeight: 600, letterSpacing: '0.01em' },
      overline: { fontWeight: 700, letterSpacing: '0.08em', fontSize: '0.6875rem' },
    },
    components: {
      // Platz für die Bildlaufleiste fest einplanen, sonst springt der Inhalt beim Wechsel auf lange Seiten
      MuiCssBaseline: { styleOverrides: { html: { scrollbarGutter: 'stable' }, body: { backgroundColor: c.background } } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 20, paddingInline: 18, minHeight: 38 }, sizeSmall: { minHeight: 32, paddingInline: 12 } },
      },
      MuiFab: { styleOverrides: { root: { borderRadius: 16, textTransform: 'none' } } },
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            borderRadius: 14,
            backgroundColor: c.surface,
            border: `1px solid ${c.outlineVariant}`,
            transition: 'border-color 150ms, background-color 150ms, box-shadow 150ms',
            // Anklickbare Karten: die ganze Karte reagiert, nicht nur die Klickfläche darin
            '&:has(> .MuiCardActionArea-root:hover)': {
              borderColor: c.primary,
              backgroundColor: alpha(c.primary, 0.04),
              boxShadow: `0 2px 8px ${alpha(c.primary, 0.12)}`,
            },
          },
        },
      },
      MuiCardActionArea: {
        styleOverrides: {
          root: { borderRadius: 'inherit', '&:hover .MuiCardActionArea-focusHighlight': { opacity: 0 } },
          focusHighlight: { borderRadius: 'inherit' },
        },
      },
      MuiIconButton: { styleOverrides: { root: { borderRadius: '50%' } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 20, backgroundColor: c.surface } } },
      MuiDialogTitle: { styleOverrides: { root: { fontSize: '1.375rem', fontWeight: 600, paddingTop: 20 } } },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            borderRadius: 10,
            '&.Mui-selected': { backgroundColor: c.primaryContainer, color: c.onPrimaryContainer },
            '&.Mui-selected:hover': { backgroundColor: c.primaryContainer },
          },
        },
      },
      MuiChip: { styleOverrides: { root: { borderRadius: 8, fontWeight: 500 } } },
      MuiTextField: { defaultProps: { fullWidth: true, size: 'medium' } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, minHeight: 44 } } },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: c.outlineVariant, paddingTop: 12, paddingBottom: 12 },
          head: { backgroundColor: c.surfaceVariant, color: c.onSurfaceVariant, fontWeight: 600, fontSize: 13 },
        },
      },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiSnackbarContent: { styleOverrides: { root: { borderRadius: 8 } } },
      MuiTooltip: { styleOverrides: { tooltip: { fontSize: 13 } } },
    },
  })
}
