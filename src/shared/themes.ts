/**
 * Farbthemen: Material-3-Farbrollen aus einer Grundfarbe ableiten.
 *
 * Das Standardthema „Violett“ nutzt die exakte M3-Baseline-Palette, alle anderen
 * werden aus einem Farbton erzeugt. „System“ übernimmt die Akzentfarbe des
 * Betriebssystems (macOS/Windows: Akzentfarbe, GNOME: accent-color).
 */

export interface ThemeDef {
  key: string
  name: string
  hue: number | null
  sat: number
}

export const THEMES: ThemeDef[] = [
  { key: 'violet', name: 'Violett', hue: null, sat: 1.0 },
  { key: 'blue', name: 'Blau', hue: 215, sat: 1.0 },
  { key: 'teal', name: 'Türkis', hue: 182, sat: 0.9 },
  { key: 'green', name: 'Grün', hue: 135, sat: 0.8 },
  { key: 'mustard', name: 'Senf', hue: 45, sat: 0.9 },
  { key: 'orange', name: 'Orange', hue: 24, sat: 1.0 },
  { key: 'coral', name: 'Koralle', hue: 4, sat: 0.9 },
  { key: 'pink', name: 'Pink', hue: 325, sat: 0.9 },
  { key: 'graphite', name: 'Graphit', hue: 220, sat: 0.08 },
  { key: 'system', name: 'Systemakzent', hue: null, sat: 1.0 },
]

export const SCHEMES = [
  { key: 'system', name: 'Wie das System' },
  { key: 'light', name: 'Hell' },
  { key: 'dark', name: 'Dunkel' },
] as const

export interface Roles {
  primary: string
  onPrimary: string
  primaryContainer: string
  onPrimaryContainer: string
  secondaryContainer: string
  onSecondaryContainer: string
  tertiaryContainer: string
  surface: string
  surfaceContainerLow: string
  surfaceContainer: string
  surfaceContainerHigh: string
  surfaceContainerHighest: string
  onSurface: string
  onSurfaceVariant: string
  outline: string
  outlineVariant: string
  error: string
  call: string
  callContainer: string
  onCallContainer: string
  hangup: string
  onHangup: string
}

const BASELINE_LIGHT: Roles = {
  primary: '#6750a4',
  onPrimary: '#ffffff',
  primaryContainer: '#eaddff',
  onPrimaryContainer: '#21005d',
  secondaryContainer: '#e8def8',
  onSecondaryContainer: '#1d192b',
  tertiaryContainer: '#ffd8e4',
  surface: '#fef7ff',
  surfaceContainerLow: '#f7f2fa',
  surfaceContainer: '#f3edf7',
  surfaceContainerHigh: '#ece6f0',
  surfaceContainerHighest: '#e6e0e9',
  onSurface: '#1d1b20',
  onSurfaceVariant: '#49454f',
  outline: '#79747e',
  outlineVariant: '#cac4d0',
  error: '#b3261e',
  call: '#146c2e',
  callContainer: '#b6f2be',
  onCallContainer: '#002109',
  hangup: '#ba1a1a',
  onHangup: '#ffffff',
}

const BASELINE_DARK: Roles = {
  primary: '#d0bcff',
  onPrimary: '#381e72',
  primaryContainer: '#4f378b',
  onPrimaryContainer: '#eaddff',
  secondaryContainer: '#4a4458',
  onSecondaryContainer: '#e8def8',
  tertiaryContainer: '#633b48',
  surface: '#141218',
  surfaceContainerLow: '#1d1b20',
  surfaceContainer: '#211f26',
  surfaceContainerHigh: '#2b2930',
  surfaceContainerHighest: '#36343b',
  onSurface: '#e6e0e9',
  onSurfaceVariant: '#cac4d0',
  outline: '#938f99',
  outlineVariant: '#49454f',
  error: '#f2b8b5',
  call: '#9ad5a3',
  callContainer: '#005322',
  onCallContainer: '#b6f2be',
  hangup: '#ffb4ab',
  onHangup: '#690005',
}

// Signalfarben sind themenunabhängig, brauchen im Dunkelmodus aber hellere Töne
const SIGNAL_LIGHT = {
  error: BASELINE_LIGHT.error,
  call: BASELINE_LIGHT.call,
  callContainer: BASELINE_LIGHT.callContainer,
  onCallContainer: BASELINE_LIGHT.onCallContainer,
  hangup: BASELINE_LIGHT.hangup,
  onHangup: BASELINE_LIGHT.onHangup,
}
const SIGNAL_DARK = {
  error: BASELINE_DARK.error,
  call: BASELINE_DARK.call,
  callContainer: BASELINE_DARK.callContainer,
  onCallContainer: BASELINE_DARK.onCallContainer,
  hangup: BASELINE_DARK.hangup,
  onHangup: BASELINE_DARK.onHangup,
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/** HLS -> #rrggbb (wie colorsys.hls_to_rgb) */
export function hslHex(h: number, s: number, l: number): string {
  s = clamp01(s)
  l = clamp01(l)
  const hue = (((h % 360) + 360) % 360) / 360
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s
  const m1 = 2 * l - m2
  const v = (hh: number): number => {
    hh = ((hh % 1) + 1) % 1
    if (hh < 1 / 6) return m1 + (m2 - m1) * hh * 6
    if (hh < 0.5) return m2
    if (hh < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hh) * 6
    return m1
  }
  const rgb = s === 0 ? [l, l, l] : [v(hue + 1 / 3), v(hue), v(hue - 1 / 3)]
  return '#' + rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
}

/** #rrggbb -> [Farbton in Grad, Sättigung, Helligkeit] */
export function hexHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

function luminance(hex: string): number {
  const chan = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * chan(1) + 0.7152 * chan(3) + 0.0722 * chan(5)
}

export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (la + 0.05) / (lb + 0.05)
}

/** Helligkeit schrittweise anpassen, bis Text darauf gut lesbar ist (WCAG AA, 4,5:1). */
function readable(hue: number, s: number, l: number, against: string, step: number): string {
  let color = hslHex(hue, s, l)
  while (contrast(color, against) < 4.5 && l > 0.05 && l < 0.95) {
    l += step
    color = hslHex(hue, s, l)
  }
  return color
}

function roles(hue: number, sat: number, dark: boolean): Roles {
  const c = (s: number, l: number): string => hslHex(hue, s * sat, l)
  const n = (s: number, l: number): string => hslHex(hue, Math.min(s, 0.25) * Math.max(sat, 0.3), l)
  if (dark) {
    const onPrimary = c(0.6, 0.2)
    return {
      primary: readable(hue, 0.75 * sat, 0.8, onPrimary, 0.02),
      onPrimary,
      primaryContainer: c(0.45, 0.3),
      onPrimaryContainer: c(0.8, 0.9),
      secondaryContainer: n(0.18, 0.28),
      onSecondaryContainer: n(0.25, 0.88),
      tertiaryContainer: hslHex(hue + 60, 0.3 * sat, 0.28),
      surface: n(0.12, 0.07),
      surfaceContainerLow: n(0.1, 0.1),
      surfaceContainer: n(0.1, 0.12),
      surfaceContainerHigh: n(0.09, 0.16),
      surfaceContainerHighest: n(0.08, 0.2),
      onSurface: n(0.1, 0.9),
      onSurfaceVariant: n(0.1, 0.8),
      outline: n(0.06, 0.58),
      outlineVariant: n(0.08, 0.29),
      ...SIGNAL_DARK,
    }
  }
  return {
    primary: readable(hue, 0.5 * sat, 0.4, '#ffffff', -0.02),
    onPrimary: '#ffffff',
    primaryContainer: c(0.85, 0.9),
    onPrimaryContainer: c(0.7, 0.14),
    secondaryContainer: n(0.4, 0.88),
    onSecondaryContainer: n(0.35, 0.12),
    tertiaryContainer: hslHex(hue + 60, 0.6 * sat, 0.88),
    surface: n(0.6, 0.985),
    surfaceContainerLow: n(0.35, 0.96),
    surfaceContainer: n(0.3, 0.94),
    surfaceContainerHigh: n(0.22, 0.92),
    surfaceContainerHighest: n(0.18, 0.89),
    onSurface: n(0.1, 0.12),
    onSurfaceVariant: n(0.08, 0.3),
    outline: n(0.05, 0.48),
    outlineVariant: n(0.12, 0.8),
    ...SIGNAL_LIGHT,
  }
}

/** Farbton und Sättigungsfaktor aus einer Systemakzentfarbe (#rrggbb). */
export function accentHue(accent: string | null): [number, number] {
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return [270, 1]
  const [h, s] = hexHsl(accent)
  return [h, s > 0.15 ? 1 : 0.1]
}

export function paletteFor(theme: string, dark: boolean, systemAccent: string | null = null): Roles {
  const def = THEMES.find((t) => t.key === theme)
  if (!def || theme === 'violet') return dark ? BASELINE_DARK : BASELINE_LIGHT
  const [hue, sat] = theme === 'system' ? accentHue(systemAccent) : [def.hue as number, def.sat]
  return roles(hue, sat, dark)
}

/** Vorschaufarbe für die Themenauswahl. */
export function swatch(theme: string, systemAccent: string | null = null): string {
  if (theme === 'violet') return '#6750a4'
  if (theme === 'system') {
    const [hue, sat] = accentHue(systemAccent)
    return hslHex(hue, 0.5 * sat, 0.45)
  }
  const def = THEMES.find((t) => t.key === theme)
  return def ? hslHex(def.hue as number, 0.5 * def.sat, 0.42) : '#6750a4'
}
