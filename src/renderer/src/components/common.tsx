/** Wiederverwendbare Bausteine: Avatar, Wähltastatur, runde Knöpfe, Statuspunkt, leere Zustände. */

import CircleIcon from '@mui/icons-material/Circle'
import { Avatar, Box, Button, Fab, Stack, ToggleButton, Tooltip, Typography } from '@mui/material'
import { amber, blue, deepOrange, deepPurple, green, pink, red, teal } from '@mui/material/colors'
import { useTheme } from '@mui/material/styles'
import type { ReactNode } from 'react'
import type { RegKind } from '../../../shared/types'

// -- Avatar mit Initialen ------------------------------------------------------

const AVATAR_COLORS = [deepPurple, blue, teal, green, amber, deepOrange, red, pink]

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length || /^\+?\d/.test(name.trim())) return ''
  return ((words[0][0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase()
}

export function ContactAvatar({ name, size = 40 }: { name: string; size?: number }) {
  const theme = useTheme()
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const bg = AVATAR_COLORS[hash % AVATAR_COLORS.length][500]
  const text = initials(name)
  return (
    <Avatar sx={{ width: size, height: size, fontSize: size * 0.4, bgcolor: bg, color: theme.palette.getContrastText(bg) }}>
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
  const size = compact ? 64 : 76
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(3, ${size}px)`, gap: 1.5, justifyContent: 'center' }}>
      {KEYS.map(([digit, letters]) => (
        <Button
          key={digit}
          variant="outlined"
          color="inherit"
          onClick={() => onDigit(digit)}
          // Lange auf 0 drücken ergibt „+“
          onContextMenu={(e) => {
            e.preventDefault()
            if (digit === '0') onDigit('+')
          }}
          sx={{ height: compact ? 56 : 64, flexDirection: 'column', borderColor: 'divider' }}
          aria-label={digit}
        >
          <Typography variant={compact ? 'h6' : 'h5'} component="span" sx={{ lineHeight: 1.1 }}>
            {digit}
          </Typography>
          <Typography variant="caption" component="span" sx={{ color: 'text.secondary', lineHeight: 1.2, minHeight: '1.2em' }}>
            {letters}
          </Typography>
        </Button>
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
  autoFocus,
}: {
  kind: 'call' | 'hangup'
  icon: ReactNode
  label: string
  onClick: () => void
  autoFocus?: boolean
}) {
  return (
    <Tooltip title={label}>
      <Fab aria-label={label} onClick={onClick} autoFocus={autoFocus} color={kind === 'call' ? 'success' : 'error'}>
        {icon}
      </Fab>
    </Tooltip>
  )
}

/** Umschaltknopf mit Beschriftung darunter (Anrufansicht). */
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
  return (
    <Stack sx={{ alignItems: 'center', gap: 0.5, width: 70 }}>
      <ToggleButton value={label} aria-label={label} selected={active} disabled={disabled} color="primary" onClick={onClick}>
        {icon}
      </ToggleButton>
      <Typography variant="caption" noWrap sx={{ color: 'text.secondary', maxWidth: '100%' }}>
        {label}
      </Typography>
    </Stack>
  )
}

// -- Status --------------------------------------------------------------------------

export function StatusDot({ kind, dnd = false, size = 10 }: { kind: RegKind; dnd?: boolean; size?: number }) {
  const color = dnd && kind === 'ok' ? 'error' : ({ ok: 'success', busy: 'warning', error: 'error', off: 'disabled' } as const)[kind]
  return (
    <CircleIcon
      color={color}
      sx={{
        fontSize: size,
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
  return (
    <Stack sx={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', p: 4, gap: 1.5, flex: 1 }}>
      <Box sx={{ color: 'text.disabled', '& .MuiSvgIcon-root': { fontSize: 72 } }}>{icon}</Box>
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
