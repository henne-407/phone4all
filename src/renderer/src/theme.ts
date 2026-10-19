/** MUI-Theme aus den Material-3-Farbrollen des gewählten Farbthemas. */

import { alpha, createTheme, type Theme } from '@mui/material/styles'
import type { Roles } from '../../shared/themes'

declare module '@mui/material/styles' {
  interface Theme {
    md: Roles
  }
  interface ThemeOptions {
    md?: Roles
  }
}

export const FONT = '"Roboto", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'

export function buildTheme(md: Roles, dark: boolean): Theme {
  return createTheme({
    md,
    palette: {
      mode: dark ? 'dark' : 'light',
      primary: { main: md.primary, contrastText: md.onPrimary },
      secondary: { main: md.secondaryContainer, contrastText: md.onSecondaryContainer },
      error: { main: md.hangup, contrastText: md.onHangup },
      success: { main: md.call, contrastText: dark ? '#00390f' : '#ffffff' },
      background: { default: md.surface, paper: md.surfaceContainerLow },
      text: { primary: md.onSurface, secondary: md.onSurfaceVariant },
      divider: md.outlineVariant,
      action: {
        hover: alpha(md.onSurface, 0.08),
        selected: alpha(md.onSurface, 0.12),
        focus: alpha(md.onSurface, 0.12),
      },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: FONT,
      button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0.1 },
      h4: { fontSize: '1.75rem', fontWeight: 400 },
      h5: { fontSize: '1.5rem', fontWeight: 400 },
      h6: { fontSize: '1.125rem', fontWeight: 500 },
      subtitle1: { fontWeight: 500 },
      overline: { fontWeight: 500, letterSpacing: 0.5, textTransform: 'none', fontSize: '0.875rem' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: md.surface, userSelect: 'none', overflow: 'hidden' },
          '*::-webkit-scrollbar': { width: 10, height: 10 },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: alpha(md.onSurface, 0.2),
            borderRadius: 8,
            border: `2px solid ${md.surface}`,
          },
          '*::-webkit-scrollbar-track': { background: 'transparent' },
          'input, textarea, [contenteditable]': { userSelect: 'text' },
        },
      },
      // Einheitlich voll abgerundete Knöpfe (M3)
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 9999,
            paddingInline: 20,
            minHeight: 40,
            variants: [
              {
                props: { variant: 'contained', color: 'secondary' },
                style: { backgroundColor: md.secondaryContainer, color: md.onSecondaryContainer },
              },
            ],
          },
          sizeSmall: { minHeight: 32, paddingInline: 14 },
          outlined: { borderColor: md.outline },
        },
      },
      MuiIconButton: { styleOverrides: { root: { borderRadius: 9999 } } },
      MuiToggleButton: { styleOverrides: { root: { borderRadius: 9999, textTransform: 'none' } } },
      MuiFab: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            backgroundColor: md.primaryContainer,
            color: md.onPrimaryContainer,
            boxShadow: `0 3px 6px ${alpha('#000', 0.18)}`,
            '&:hover': { backgroundColor: md.primaryContainer, filter: 'brightness(0.97)' },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 8, fontWeight: 500 },
          outlined: { borderColor: md.outline },
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { borderRadius: 20, backgroundColor: md.surfaceContainerLow } },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: 28, backgroundColor: md.surfaceContainerHigh } },
      },
      MuiDialogTitle: { styleOverrides: { root: { fontSize: '1.5rem', fontWeight: 400, paddingTop: 24 } } },
      MuiMenu: {
        styleOverrides: { paper: { borderRadius: 12, backgroundColor: md.surfaceContainer, minWidth: 200 } },
      },
      MuiPopover: { styleOverrides: { paper: { borderRadius: 16, backgroundColor: md.surfaceContainer } } },
      MuiTooltip: {
        defaultProps: { enterDelay: 600, disableInteractive: true },
        styleOverrides: { tooltip: { backgroundColor: md.onSurface, color: md.surface, fontSize: 12, borderRadius: 6 } },
      },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 12 } } },
      MuiTextField: { defaultProps: { variant: 'filled', fullWidth: true } },
      MuiFilledInput: {
        defaultProps: { disableUnderline: false },
        styleOverrides: {
          root: {
            borderTopLeftRadius: 8,
            borderTopRightRadius: 8,
            backgroundColor: md.surfaceContainerHighest,
            '&:hover': { backgroundColor: alpha(md.onSurface, 0.1) },
            '&.Mui-focused': { backgroundColor: md.surfaceContainerHighest },
          },
        },
      },
      MuiSnackbarContent: {
        styleOverrides: { root: { backgroundColor: md.onSurface, color: md.surface, borderRadius: 8 } },
      },
      MuiSwitch: {
        styleOverrides: {
          root: { width: 64, height: 44, padding: 8 },
          switchBase: {
            padding: 12,
            '&.Mui-checked': {
              transform: 'translateX(20px)',
              color: md.onPrimary,
              '& + .MuiSwitch-track': { backgroundColor: md.primary, opacity: 1, border: 0 },
              '& .MuiSwitch-thumb': { width: 20, height: 20, margin: 0, backgroundColor: md.onPrimary },
            },
          },
          thumb: { width: 14, height: 14, margin: 3, boxShadow: 'none', backgroundColor: md.outline },
          track: {
            borderRadius: 14,
            backgroundColor: md.surfaceContainerHighest,
            border: `2px solid ${md.outline}`,
            opacity: 1,
          },
        },
      },
      MuiBottomNavigation: {
        styleOverrides: { root: { height: 72, backgroundColor: md.surfaceContainer } },
      },
      MuiBottomNavigationAction: {
        styleOverrides: {
          root: {
            color: md.onSurfaceVariant,
            minWidth: 0,
            paddingTop: 10,
            '& .MuiSvgIcon-root': { padding: '4px 20px', borderRadius: 16, boxSizing: 'content-box' },
            '&.Mui-selected': { color: md.onSurface },
            '&.Mui-selected .MuiSvgIcon-root': { backgroundColor: md.secondaryContainer, color: md.onSecondaryContainer },
          },
          label: { fontSize: 12, fontWeight: 500, marginTop: 4, '&.Mui-selected': { fontSize: 12 } },
        },
      },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 500, minHeight: 48 } } },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            variants: [
              {
                props: { variant: 'standard', severity: 'info' },
                style: { backgroundColor: md.secondaryContainer, color: md.onSecondaryContainer, '& .MuiAlert-icon': { color: md.onSecondaryContainer } },
              },
              {
                props: { variant: 'standard', severity: 'success' },
                style: { backgroundColor: md.callContainer, color: md.onCallContainer, '& .MuiAlert-icon': { color: md.onCallContainer } },
              },
            ],
          },
        },
      },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: 4, height: 6 } } },
    },
  })
}
