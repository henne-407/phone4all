/** Wiederverwendbare Bausteine: Avatar, Wähltastatur, runde Knöpfe, Statuspunkt, leere Zustände. */

import { Avatar, Box, ButtonBase, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import type { ReactNode } from 'react'
import type { RegKind } from '../../../shared/types'

// -- Avatar mit Initialen ------------------------------------------------------

const AVATAR_HUES = [270, 215, 182, 135, 45, 24, 4, 325]

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length || /^\+?\d/.test(name.trim())) return ''
  return ((words[0][0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase()
}

export function ContactAvatar({ name, size = 40 }: { name: string; size?: number }) {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hue = AVATAR_HUES[hash % AVATAR_HUES.length]
  const text = initials(name)
  return (
    <Avatar
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        fontWeight: 500,
        bgcolor: `hsl(${hue} ${dark ? 30 : 70}% ${dark ? 30 : 88}%)`,
        color: `hsl(${hue} ${dark ? 70 : 50}% ${dark ? 88 : 22}%)`,
      }}
    >
      {text || <PersonGlyph size={size * 0.55} />}
    </Avatar>
  )
}

function PersonGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4m0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4" />
    </svg>
  )
}

// -- Wähltastatur ---------------------------------------------------------------

const KEYS: [string, string][] = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
]

export function DialPad({ onDigit, compact = false }: { onDigit: (d: string) => void; compact?: boolean }) {
  const { md } = useTheme()
  const size = compact ? 60 : 72
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(3, ${size}px)`,
        columnGap: compact ? '22px' : '26px',
        rowGap: compact ? '10px' : '12px',
        justifyContent: 'center',
      }}
    >
      {KEYS.map(([digit, letters]) => (
        <ButtonBase
          key={digit}
          onClick={() => onDigit(digit)}
          // Lange auf 0 drücken ergibt „+“
          onContextMenu={(e) => {
            e.preventDefault()
            if (digit === '0') onDigit('+')
          }}
          sx={{
            width: size,
            height: size,
            borderRadius: '50%',
            bgcolor: md.surfaceContainerHigh,
            color: md.onSurface,
            flexDirection: 'column',
            transition: 'background-color 120ms',
            '&:hover': { bgcolor: md.surfaceContainerHighest },
            '&:active': { bgcolor: md.primaryContainer, color: md.onPrimaryContainer },
          }}
          aria-label={digit}
        >
          <Typography sx={{ fontSize: compact ? 24 : 28, lineHeight: 1.1, fontWeight: 400 }}>{digit}</Typography>
          <Typography sx={{ fontSize: 10, letterSpacing: 1, color: md.onSurfaceVariant, minHeight: 12 }}>
            {letters || ' '}
          </Typography>
        </ButtonBase>
      ))}
    </Box>
  )
}

// -- Runde Anruftasten ------------------------------------------------------------

export function RoundAction({
  kind,
  icon,
  label,
  onClick,
  size = 64,
  autoFocus,
}: {
  kind: 'call' | 'hangup'
  icon: ReactNode
  label: string
  onClick: () => void
  size?: number
  autoFocus?: boolean
}) {
  const { md } = useTheme()
  const bg = kind === 'call' ? md.callContainer : md.hangup
  const fg = kind === 'call' ? md.onCallContainer : md.onHangup
  return (
    <Tooltip title={label}>
      <IconButton
        aria-label={label}
        onClick={onClick}
        autoFocus={autoFocus}
        sx={{
          width: size,
          height: size,
          bgcolor: bg,
          color: fg,
          '& .MuiSvgIcon-root': { fontSize: size * 0.42 },
          '&:hover': { bgcolor: bg, filter: 'brightness(0.95)' },
          '&.Mui-focusVisible': { outline: `3px solid ${alpha(fg, 0.5)}` },
        }}
      >
        {icon}
      </IconButton>
    </Tooltip>
  )
}

/** Runder Umschaltknopf mit Beschriftung darunter (Anrufansicht). */
export function CallToggle({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  onClick: (e: React.MouseEvent<HTMLElement>) => void
}) {
  const { md } = useTheme()
  return (
    <Stack sx={{ alignItems: 'center', gap: 0.75, width: 64 }}>
      <IconButton
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        sx={{
          width: 56,
          height: 56,
          bgcolor: active ? md.primary : md.surfaceContainerHighest,
          color: active ? md.onPrimary : md.onSurface,
          '&:hover': { bgcolor: active ? md.primary : alpha(md.onSurface, 0.14) },
          '&.Mui-disabled': { bgcolor: alpha(md.onSurface, 0.08), color: alpha(md.onSurface, 0.38) },
        }}
      >
        {icon}
      </IconButton>
      <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center', lineHeight: 1.2 }}>
        {label}
      </Typography>
    </Stack>
  )
}

// -- Status --------------------------------------------------------------------------

export function StatusDot({ kind, dnd = false, size = 10 }: { kind: RegKind; dnd?: boolean; size?: number }) {
  const { md } = useTheme()
  const color = dnd && kind === 'ok' ? md.hangup : { ok: md.call, busy: '#e0a800', error: md.error, off: md.outline }[kind]
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        bgcolor: color,
        flexShrink: 0,
        ...(kind === 'busy' && {
          animation: 'pulse 1.4s ease-in-out infinite',
          '@keyframes pulse': { '50%': { opacity: 0.35 } },
        }),
      }}
    />
  )
}

export function EmptyState({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode
  title: string
  description?: string
  children?: ReactNode
}) {
  const { md } = useTheme()
  return (
    <Stack sx={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', p: 4, gap: 1.5, flex: 1 }}>
      <Box sx={{ color: md.onSurfaceVariant, opacity: 0.6, '& .MuiSvgIcon-root': { fontSize: 72 } }}>{icon}</Box>
      <Typography variant="h5">{title}</Typography>
      {description && (
        <Typography sx={{ color: 'text.secondary', maxWidth: 420 }}>{description}</Typography>
      )}
      {children && <Stack sx={{ gap: 1.5, mt: 1, alignItems: 'center' }}>{children}</Stack>}
    </Stack>
  )
}

/** Überschrift einer Gruppe in Listen und Einstellungen */
export function GroupTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', px: 1, pt: 2, pb: 1, minHeight: 40 }}>
      <Typography variant="overline" sx={{ color: 'primary.main', flex: 1 }}>
        {children}
      </Typography>
      {action}
    </Stack>
  )
}
