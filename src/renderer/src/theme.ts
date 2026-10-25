/**
 * MUI-Themes für die beiden Designstile:
 * - classic: Standard-MUI, das Farbthema bestimmt nur die Primärfarbe
 * - m3: Material Design 3 (Material You) aus den Farbrollen des Farbthemas
 */

import { alpha, createTheme, type Theme } from '@mui/material/styles'
import type { Roles } from '../../shared/themes'
import type { DesignStyle } from '../../shared/types'

// App-Verhalten statt Gestaltung: kein Markieren der Oberfläche, Seiten scrollen selbst
const BEHAVIOUR = {
  body: { userSelect: 'none', overflow: 'hidden' },
  'input, textarea, [contenteditable]': { userSelect: 'text' },
} as const

export function buildTheme(style: DesignStyle, md: Roles, dark: boolean): Theme {
  return style === 'm3' ? buildMaterial3(md, dark) : buildClassic(md.primary, dark)
}

/** Farben für die Titelleiste (Hintergrund, Symbole) */
export function titleBarColors(theme: Theme): [string, string] {
  const p = theme.palette
  return [p.background.default, p.mode === 'dark' ? p.common.white : p.common.black]
}

/**
 * Klick-Rückmeldung ohne die große Welle (Ripple): eine Zustandsschicht wie in
 * Material 3, die der Form des Elements folgt (auch Pillen und runde Symbole).
 */
function pressFeedback(onSurface: string, focus: string) {
  const layer = (a: number): string => `linear-gradient(${alpha(onSurface, a)}, ${alpha(onSurface, a)})`
  return {
    defaultProps: { disableRipple: true },
    styleOverrides: {
      root: {
        transition: 'background-color 150ms, background-image 150ms, box-shadow 150ms',
        '&:active:not(.Mui-disabled)': { backgroundImage: layer(0.12) },
        '&.Mui-focusVisible': { outline: `2px solid ${focus}`, outlineOffset: 2 },
      },
    },
  }
}

function buildClassic(primary: string, dark: boolean): Theme {
  const base = createTheme({ palette: { mode: dark ? 'dark' : 'light' } })
  return createTheme(base, {
    palette: {
      primary: base.palette.augmentColor({ color: { main: primary } }),
    },
    components: {
      MuiCssBaseline: { styleOverrides: BEHAVIOUR },
      MuiButtonBase: pressFeedback(base.palette.text.primary, primary),
      MuiTextField: { defaultProps: { fullWidth: true } },
    },
  })
}

function buildMaterial3(md: Roles, dark: boolean): Theme {
  const base = createTheme({ palette: { mode: dark ? 'dark' : 'light' } })
  return createTheme(base, {
    palette: {
      primary: base.palette.augmentColor({ color: { main: md.primary, contrastText: md.onPrimary } }),
      secondary: base.palette.augmentColor({
        color: { main: md.secondaryContainer, contrastText: md.onSecondaryContainer },
      }),
      error: base.palette.augmentColor({ color: { main: md.hangup, contrastText: md.onHangup } }),
      success: base.palette.augmentColor({
        color: { main: md.call, contrastText: dark ? '#00390f' : '#ffffff' },
      }),
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
          ...BEHAVIOUR,
          body: { ...BEHAVIOUR.body, backgroundColor: md.surface },
          '*::-webkit-scrollbar': { width: 10, height: 10 },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: alpha(md.onSurface, 0.2),
            borderRadius: 8,
            border: `2px solid ${md.surface}`,
          },
          '*::-webkit-scrollbar-track': { background: 'transparent' },
        },
      },
      MuiButtonBase: pressFeedback(md.onSurface, md.primary),
      // Voll abgerundete Knöpfe ohne Schatten
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 9999, paddingInline: 20, minHeight: 40 },
          sizeSmall: { minHeight: 32, paddingInline: 14 },
          outlined: { borderColor: md.outline },
        },
      },
      MuiIconButton: { styleOverrides: { root: { borderRadius: 9999 } } },
      MuiToggleButton: { styleOverrides: { root: { textTransform: 'none' } } },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: { borderRadius: 9999 },
          firstButton: { borderTopLeftRadius: 9999, borderBottomLeftRadius: 9999 },
          lastButton: { borderTopRightRadius: 9999, borderBottomRightRadius: 9999 },
        },
      },
      // FAB als abgerundetes Quadrat; Primär-FAB in der Container-Farbe, Anrufen/Auflegen bleiben grün/rot
      MuiFab: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            boxShadow: `0 3px 6px ${alpha('#000', 0.18)}`,
            variants: [
              {
                props: { color: 'primary' },
                style: {
                  backgroundColor: md.primaryContainer,
                  color: md.onPrimaryContainer,
                  '&:hover': { backgroundColor: md.primaryContainer, filter: 'brightness(0.95)' },
                },
              },
            ],
          },
          sizeSmall: { borderRadius: 12 },
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
        styleOverrides: {
          root: {
            borderRadius: 16,
            backgroundColor: md.surfaceContainerLow,
            variants: [{ props: { variant: 'outlined' }, style: { backgroundColor: md.surface, borderColor: md.outlineVariant } }],
          },
        },
      },
      MuiCardActionArea: { styleOverrides: { root: { borderRadius: 16 } } },
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
      MuiMenuItem: { styleOverrides: { root: { borderRadius: 8, marginInline: 4 } } },
      MuiTextField: { defaultProps: { variant: 'filled', fullWidth: true } },
      MuiFilledInput: {
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
      MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 8 } } },
      MuiSnackbarContent: {
        styleOverrides: { root: { backgroundColor: md.onSurface, color: md.surface, borderRadius: 8 } },
      },
      // M3-Schalter: breite Spur mit Rand, Daumen wächst beim Einschalten
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
            '&.Mui-disabled + .MuiSwitch-track': { opacity: 0.38 },
          },
          thumb: { width: 14, height: 14, margin: 3, boxShadow: 'none', backgroundColor: md.outline },
          track: {
            borderRadius: 14,
            backgroundColor: md.surfaceContainerHighest,
            border: `2px solid ${md.outline}`,
            opacity: 1,
            boxSizing: 'border-box',
          },
        },
      },
      // Navigationsleiste unten: aktives Symbol in einer Pille
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
      // Senkrechte Tabs als Navigation Rail, waagerechte Tabs wie gehabt mit Unterstrich
      MuiTabs: {
        styleOverrides: {
          // doppelte Klasse, damit es auch gegen die Trennlinie aus sx greift
          root: {
            '&.MuiTabs-vertical': { backgroundColor: md.surface, borderRight: 0, paddingTop: 8 },
            '&.MuiTabs-vertical .MuiTabs-indicator': { display: 'none' },
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 500,
            minHeight: 48,
            '.MuiTabs-vertical &': {
              color: md.onSurfaceVariant,
              fontSize: 12,
              minHeight: 64,
              paddingBlock: 6,
              '& .MuiSvgIcon-root': { padding: '4px 16px', borderRadius: 16, boxSizing: 'content-box' },
              '&:hover .MuiSvgIcon-root': { backgroundColor: alpha(md.onSurface, 0.08) },
              '&.Mui-selected': { color: md.onSurface, fontWeight: 700 },
              '&.Mui-selected .MuiSvgIcon-root': {
                backgroundColor: md.secondaryContainer,
                color: md.onSecondaryContainer,
              },
            },
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            variants: [
              {
                props: { variant: 'standard', severity: 'info' },
                style: {
                  backgroundColor: md.secondaryContainer,
                  color: md.onSecondaryContainer,
                  '& .MuiAlert-icon': { color: md.onSecondaryContainer },
                },
              },
              {
                props: { variant: 'standard', severity: 'success' },
                style: {
                  backgroundColor: md.callContainer,
                  color: md.onCallContainer,
                  '& .MuiAlert-icon': { color: md.onCallContainer },
                },
              },
            ],
          },
        },
      },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: 4, height: 6 } } },
    },
  })
}
