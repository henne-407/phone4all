/**
 * Titelleiste: Anmeldung, „Nicht stören“, Rufumleitung, Mikrofon, Lautsprecher und Hauptmenü.
 * Sie ist zugleich die Fensterleiste (verschiebbar); unter Windows/Linux liegen die
 * Fensterknöpfe rechts darüber, unter macOS die Ampel links.
 */

import AccountIcon from '@mui/icons-material/AccountCircle'
import LogoutIcon from '@mui/icons-material/Logout'
import LoginIcon from '@mui/icons-material/Login'
import MicIcon from '@mui/icons-material/Mic'
import MoreIcon from '@mui/icons-material/MoreVert'
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff'
import PhoneForwardedIcon from '@mui/icons-material/PhoneForwarded'
import PlayIcon from '@mui/icons-material/PlayArrow'
import RefreshIcon from '@mui/icons-material/Refresh'
import SpeakerIcon from '@mui/icons-material/VolumeUp'
import SystemUpdateIcon from '@mui/icons-material/SystemUpdateAlt'
import {
  Box,
  Button,
  Divider,
  IconButton,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  MenuList,
  Popover,
  Radio,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { type ReactNode, useEffect, useState } from 'react'
import type { AudioDevice } from '../../../shared/types'
import { api, platform } from '../api'
import { playTestTone, startLevelMeter } from '../audio'
import { emit } from '../bus'
import { useApp } from '../state'
import { StatusDot } from './common'
import { ForwardPopover, ForwardRulesDialog, forwardLabel } from './Forward'

const noDrag = { WebkitAppRegion: 'no-drag' } as const

function Chip({
  icon,
  label,
  tooltip,
  active = false,
  color = 'error',
  compact,
  onClick,
}: {
  icon: ReactNode
  label: string
  tooltip: string
  active?: boolean
  color?: 'error' | 'primary'
  compact: boolean
  onClick: (e: React.MouseEvent<HTMLElement>) => void
}) {
  return (
    <Tooltip title={tooltip}>
      {compact ? (
        <IconButton onClick={onClick} aria-label={tooltip} color={active ? color : 'inherit'} sx={noDrag}>
          {icon}
        </IconButton>
      ) : (
        <Button
          onClick={onClick}
          aria-label={tooltip}
          size="small"
          variant={active ? 'contained' : 'text'}
          color={active ? color : 'inherit'}
          startIcon={icon}
          sx={{ ...noDrag, maxWidth: 220 }}
        >
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </Box>
        </Button>
      )}
    </Tooltip>
  )
}

const shortName = (d: AudioDevice | undefined, list: AudioDevice[], current: string): string => {
  if (!current) return list.find((x) => x.isDefault)?.name ?? 'Systemstandard'
  return d?.name ?? 'Nicht verbunden'
}

function DeviceList({
  devices,
  current,
  defaultLabel,
  onSelect,
}: {
  devices: AudioDevice[]
  current: string
  defaultLabel: string
  onSelect: (id: string) => void
}) {
  const entries = [{ id: '', name: defaultLabel }, ...devices]
  // MenuItem braucht ab MUI 9 eine umgebende MenuList, sonst bricht das Rendern ab
  return (
    <MenuList dense disablePadding>
      {entries.map((d) => (
        <MenuItem key={d.id || 'default'} dense onClick={() => onSelect(d.id)}>
          <Radio checked={d.id === current} size="small" sx={{ p: 0.5, mr: 1 }} />
          <ListItemText primary={d.name} slotProps={{ primary: { noWrap: true } }} />
        </MenuItem>
      ))}
    </MenuList>
  )
}

function MicPopover({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const { state } = useApp()
  const [level, setLevel] = useState(0)
  const current = state.settings.audio.source
  const sources = state.devices.sources
  const def = sources.find((d) => d.isDefault)?.name

  useEffect(() => {
    if (!anchor) return
    let stop: (() => void) | null = null
    let cancelled = false
    void startLevelMeter(
      sources.find((d) => d.id === current),
      setLevel,
    ).then((s) => (cancelled ? s() : (stop = s)))
    return () => {
      cancelled = true
      stop?.()
    }
  }, [anchor, current, sources])

  return (
    <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
      <Box sx={{ p: 1.5, width: 340 }}>
        <Typography variant="subtitle1" sx={{ px: 1, pb: 0.5 }}>
          Mikrofon
        </Typography>
        <DeviceList
          devices={sources}
          current={current}
          defaultLabel={def ? `Systemstandard (${def})` : 'Systemstandard'}
          onSelect={(id) => void api.setAudio('source', id)}
        />
        <Divider sx={{ my: 1 }} />
        <Typography variant="caption" sx={{ px: 1, color: 'text.secondary' }}>
          Pegel – sprich zum Testen
        </Typography>
        <LinearProgress variant="determinate" value={level * 100} sx={{ mx: 1, my: 1 }} />
      </Box>
    </Popover>
  )
}

function SpeakerPopover({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const { state } = useApp()
  const { sink, alert } = state.settings.audio
  const sinks = state.devices.sinks
  const def = sinks.find((d) => d.isDefault)?.name
  const defaultLabel = def ? `Systemstandard (${def})` : 'Systemstandard'
  const test = (id: string): void => void playTestTone(sinks.find((d) => d.id === id) ?? sinks.find((d) => d.isDefault))
  return (
    <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
      <Box sx={{ p: 1.5, width: 340, maxHeight: '80vh' }}>
        <Typography variant="subtitle1" sx={{ px: 1, pb: 0.5 }}>
          Lautsprecher (Gespräch)
        </Typography>
        <DeviceList devices={sinks} current={sink} defaultLabel={defaultLabel} onSelect={(id) => void api.setAudio('sink', id)} />
        <Button size="small" startIcon={<PlayIcon />} onClick={() => test(sink)} sx={{ ml: 0.5 }}>
          Testton abspielen
        </Button>
        <Divider sx={{ my: 1 }} />
        <Typography variant="subtitle1" sx={{ px: 1, pb: 0.5 }}>
          Klingeln auf
        </Typography>
        <DeviceList devices={sinks} current={alert} defaultLabel="Wie Lautsprecher" onSelect={(id) => void api.setAudio('alert', id)} />
        <Button size="small" startIcon={<PlayIcon />} onClick={() => test(alert || sink)} sx={{ ml: 0.5 }}>
          Testton abspielen
        </Button>
      </Box>
    </Popover>
  )
}

export function TopBar({ compact, showTitle }: { compact: boolean; showTitle: boolean }) {
  const { state } = useApp()
  const [menu, setMenu] = useState<null | 'account' | 'forward' | 'mic' | 'speaker' | 'main'>(null)
  const [rules, setRules] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const open = (name: typeof menu) => (e: React.MouseEvent<HTMLElement>) => {
    setAnchor(e.currentTarget)
    setMenu(name)
    if (name === 'mic' || name === 'speaker') void api.refreshDevices()
  }
  const close = (): void => setMenu(null)

  const { reg, settings } = state
  const acc = settings.account
  const user = acc.display_name || acc.user || 'Kein Konto'
  const label = !acc.domain
    ? 'Kein Konto'
    : ({ ok: user, busy: 'Verbinde …', error: 'Fehler', off: 'Abgemeldet' } as const)[reg.kind]
  const audio = settings.audio
  const mic = state.devices.sources.find((d) => d.id === audio.source)
  const spk = state.devices.sinks.find((d) => d.id === audio.sink)
  const mac = platform === 'darwin'
  const fwd = state.forward
  // Ohne Recht nur anzeigen, wenn eine Umleitung greift (z. B. von der Anlage geschaltet)
  const showForward = fwd && (fwd.active || fwd.permissions.some((p) => p === 'forward' || p === 'forward_rules'))

  return (
    <Box
      sx={{
        WebkitAppRegion: 'drag',
        height: 48,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        bgcolor: 'background.default',
        // Platz für die Fensterknöpfe (Window Controls Overlay bzw. macOS-Ampel)
        pl: mac ? '78px' : 1,
        pr: mac ? 1 : 'calc(100vw - env(titlebar-area-width, 100vw) - env(titlebar-area-x, 0px) + 8px)',
      }}
    >
      <Chip
        icon={<StatusDot kind={reg.kind} dnd={settings.dnd} />}
        label={label}
        tooltip={reg.text}
        compact={false}
        onClick={open('account')}
      />
      <Chip
        icon={<NotificationsOffIcon />}
        label="Nicht stören"
        tooltip="Nicht stören: Anrufe abweisen"
        active={settings.dnd}
        compact={compact}
        onClick={() => void api.setDnd(!settings.dnd)}
      />
      {fwd && showForward && (
        <Chip
          icon={<PhoneForwardedIcon />}
          label={fwd.active ? `→ ${forwardLabel(fwd, fwd.active)}` : 'Umleitung'}
          tooltip={fwd.active ? `Rufumleitung an ${forwardLabel(fwd, fwd.active)}` : 'Rufumleitung'}
          active={Boolean(fwd.active)}
          color="primary"
          compact={compact}
          onClick={open('forward')}
        />
      )}
      <Box sx={{ flex: 1, textAlign: 'center', overflow: 'hidden' }}>
        {showTitle && (
          <Typography variant="subtitle1" noWrap sx={{ color: 'text.primary' }}>
            Phone4All
          </Typography>
        )}
      </Box>
      {state.platform.audioDevices && (
        <>
          <Chip
            icon={<MicIcon />}
            label={shortName(mic, state.devices.sources, audio.source)}
            tooltip="Mikrofon"
            compact={compact}
            onClick={open('mic')}
          />
          <Chip
            icon={<SpeakerIcon />}
            label={shortName(spk, state.devices.sinks, audio.sink)}
            tooltip="Lautsprecher und Klingelton"
            compact={compact}
            onClick={open('speaker')}
          />
        </>
      )}
      {['available', 'downloading', 'ready'].includes(state.update.status) && state.update.latest && (
        <Tooltip title={`Update auf ${state.update.latest.version}`}>
          <IconButton onClick={() => emit('open-preferences', 'general')} sx={noDrag} color="primary" aria-label="Update">
            <SystemUpdateIcon />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Hauptmenü">
        <IconButton onClick={open('main')} sx={noDrag} aria-label="Hauptmenü">
          <MoreIcon />
        </IconButton>
      </Tooltip>

      <Menu anchorEl={anchor} open={menu === 'account'} onClose={close}>
        <Box sx={{ px: 2, py: 1, maxWidth: 320 }}>
          <Typography variant="subtitle1">{reg.text}</Typography>
          {acc.domain && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {acc.user}@{acc.domain}
            </Typography>
          )}
        </Box>
        <Divider />
        <MenuItem
          onClick={() => {
            close()
            void api.restartEngine()
          }}
        >
          <ListItemIcon>
            <RefreshIcon />
          </ListItemIcon>
          Neu anmelden
        </MenuItem>
        <MenuItem
          onClick={() => {
            close()
            void api.setRegistered(!settings.registered)
          }}
        >
          <ListItemIcon>{settings.registered ? <LogoutIcon /> : <LoginIcon />}</ListItemIcon>
          {settings.registered ? 'Abmelden' : 'Anmelden'}
        </MenuItem>
        <MenuItem
          onClick={() => {
            close()
            emit('open-preferences', 'account')
          }}
        >
          <ListItemIcon>
            <AccountIcon />
          </ListItemIcon>
          Konto bearbeiten …
        </MenuItem>
      </Menu>

      <ForwardPopover anchor={menu === 'forward' ? anchor : null} onClose={close} onRules={() => setRules(true)} />
      <ForwardRulesDialog open={rules} onClose={() => setRules(false)} />
      <MicPopover anchor={menu === 'mic' ? anchor : null} onClose={close} />
      <SpeakerPopover anchor={menu === 'speaker' ? anchor : null} onClose={close} />

      <Menu anchorEl={anchor} open={menu === 'main'} onClose={close}>
        {[
          ['Einstellungen', () => emit('open-preferences', 'account')],
          ...(state.settings.provisioning.policy?.lock_layout ? [] : [['Startseite anpassen', () => emit('customize-home')] as const]),
          ['Verlauf löschen', () => void api.clearHistory()],
          ['Neu verbinden', () => void api.restartEngine()],
          ['Diagnose', () => emit('open-preferences', 'diagnose')],
          ['Nach Updates suchen', () => emit('open-preferences', 'general')],
          null,
          ['Über Phone4All', () => emit('about')],
          ['Beenden', () => void api.quit()],
        ].map((item, i) =>
          item ? (
            <MenuItem
              key={item[0] as string}
              onClick={() => {
                close()
                ;(item[1] as () => void)()
              }}
            >
              {item[0] as string}
            </MenuItem>
          ) : (
            <Divider key={i} />
          ),
        )}
      </Menu>
      <Stack />
    </Box>
  )
}
