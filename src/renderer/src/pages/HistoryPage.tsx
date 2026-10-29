/** Anrufverlauf mit Filtern; in breiten Fenstern mit Statistik-Seitenleiste. */

import BlockIcon from '@mui/icons-material/Block'
import CallIcon from '@mui/icons-material/Call'
import CallMadeIcon from '@mui/icons-material/CallMade'
import CallMissedIcon from '@mui/icons-material/CallMissed'
import CallReceivedIcon from '@mui/icons-material/CallReceived'
import EventIcon from '@mui/icons-material/EventAvailable'
import HistoryIcon from '@mui/icons-material/History'
import MoreIcon from '@mui/icons-material/MoreVert'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import {
  Badge,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { formatDuration, formatTalk, formatTime } from '../../../shared/format'
import { frequent, summary } from '../../../shared/stats'
import type { HistoryRow } from '../../../shared/types'
import { api } from '../api'
import { emit } from '../bus'
import { ContactAvatar, EmptyState } from '../components/common'
import { VoicemailList } from '../components/VoicemailList'
import { useApp } from '../state'

export function HistoryItem({ entry }: { entry: HistoryRow }) {
  const { state, toast } = useApp()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [block, setBlock] = useState(false)
  // Sperren in der Anlage: nur Anrufer von außen, nur mit Recht
  const canBlock = state.settings.provisioning.permissions.includes('block_numbers') && entry.direction === 'in' && entry.number.replace(/\D/g, '').length > 5
  const name = entry.contactName || entry.name || entry.number
  const details = [formatTime(entry.time)]
  if (entry.missed) details.push('Verpasst')
  if (entry.duration) details.push(formatDuration(entry.duration))
  if (name !== entry.number) details.unshift(entry.number)
  const Icon = entry.missed ? CallMissedIcon : entry.direction === 'in' ? CallReceivedIcon : CallMadeIcon
  return (
    <ListItem
      disablePadding
      secondaryAction={
        <IconButton edge="end" aria-label="Weitere Aktionen" onClick={(e) => setAnchor(e.currentTarget)}>
          <MoreIcon />
        </IconButton>
      }
    >
      <Tooltip title="Zurückrufen" placement="top-start">
        <ListItemButton onClick={() => void api.dial(entry.number)} sx={{ pr: 7 }}>
          <ListItemIcon sx={{ minWidth: 40, color: entry.missed ? 'error.main' : 'text.secondary' }}>
            <Icon />
          </ListItemIcon>
          <ListItemText
            primary={name}
            secondary={details.join(' · ')}
            slotProps={{
              primary: { noWrap: true, sx: { color: entry.missed ? 'error.main' : undefined } },
              secondary: { noWrap: true },
            }}
          />
        </ListItemButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem
          onClick={() => {
            setAnchor(null)
            void api.scheduleCallback(entry.number, name !== entry.number ? name : '')
          }}
        >
          <ListItemIcon>
            <EventIcon />
          </ListItemIcon>
          Rückruf planen
        </MenuItem>
        {!entry.contactId && (
          <MenuItem
            onClick={() => {
              setAnchor(null)
              emit('edit-contact', { name: entry.name || '', phone: entry.number })
            }}
          >
            <ListItemIcon>
              <PersonAddIcon />
            </ListItemIcon>
            Als Kontakt speichern
          </MenuItem>
        )}
        {canBlock && (
          <MenuItem
            onClick={() => {
              setAnchor(null)
              setBlock(true)
            }}
          >
            <ListItemIcon>
              <BlockIcon />
            </ListItemIcon>
            Nummer sperren …
          </MenuItem>
        )}
      </Menu>
      <Dialog open={block} onClose={() => setBlock(false)} maxWidth="xs">
        <DialogTitle>{name} sperren?</DialogTitle>
        <DialogContent>
          <DialogContentText>Anrufe von {entry.number} kommen danach bei niemandem in der Telefonanlage mehr durch. Aufheben lässt sich die Sperre in der Weboberfläche der Anlage.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBlock(false)}>Abbrechen</Button>
          <Button
            color="error"
            onClick={() => {
              setBlock(false)
              void api.pbxBlock(entry.number, name !== entry.number ? name : '').then((r) => toast(r.ok ? 'Nummer gesperrt' : r.error))
            }}
          >
            Sperren
          </Button>
        </DialogActions>
      </Dialog>
    </ListItem>
  )
}

const FILTERS: [string, string, (e: HistoryRow) => boolean][] = [
  ['all', 'Alle', () => true],
  ['missed', 'Verpasst', (e) => e.missed],
  ['in', 'Eingehend', (e) => e.direction === 'in' && !e.missed],
  ['out', 'Ausgehend', (e) => e.direction === 'out'],
]

export function StatTile({ value, caption, alert = false }: { value: string | number; caption: string; alert?: boolean }) {
  return (
    <Paper variant="outlined" sx={{ px: 1.5, py: 1.25, minWidth: 0 }}>
      <Typography variant="h5" sx={{ color: alert ? 'error.main' : 'text.primary' }} noWrap>
        {value}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
        {caption}
      </Typography>
    </Paper>
  )
}

function SidePanel({ history }: { history: HistoryRow[] }) {
  const top = frequent(history, 8, 30)
  return (
    <Stack sx={{ width: 360, flexShrink: 0, gap: 2, overflowY: 'auto', pb: 3, pr: 2 }}>
      {(
        [
          ['Heute', 0],
          ['Letzte 7 Tage', 6],
        ] as const
      ).map(([title, days]) => {
        const s = summary(history, days)
        return (
          <Card key={title} sx={{ p: 2, flexShrink: 0 }}>
            <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
              {title}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
              <StatTile value={s.incoming} caption="Angenommen" />
              <StatTile value={s.outgoing} caption="Ausgehend" />
              <StatTile value={s.missed} caption="Verpasst" alert={s.missed > 0} />
              <StatTile value={formatTalk(s.talk)} caption="Gesprächszeit" />
            </Box>
          </Card>
        )
      })}
      <Card sx={{ p: 2, flexShrink: 0 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Häufigste Kontakte (30 Tage)
        </Typography>
        {top.length ? (
          <List dense disablePadding>
            {top.map((f) => (
              <ListItem
                key={f.number}
                disablePadding
                secondaryAction={
                  <IconButton edge="end" aria-label={`${f.number} anrufen`} onClick={() => void api.dial(f.number)} sx={{ color: 'success.main' }}>
                    <CallIcon />
                  </IconButton>
                }
              >
                <ListItemAvatar sx={{ minWidth: 44 }}>
                  <ContactAvatar name={f.name !== f.number ? f.name : ''} size={32} />
                </ListItemAvatar>
                <ListItemText primary={f.name} secondary={`${f.count} Anruf${f.count !== 1 ? 'e' : ''}`} slotProps={{ primary: { noWrap: true } }} />
              </ListItem>
            ))}
          </List>
        ) : (
          <Typography sx={{ color: 'text.secondary' }}>Noch keine Daten.</Typography>
        )}
      </Card>
    </Stack>
  )
}

export function HistoryPage({ wide }: { wide: boolean }) {
  const { state, history } = useApp()
  const [filter, setFilter] = useState('all')
  const voicemail = state.voicemail
  const showVoicemail = filter === 'voicemail' && voicemail
  const fn = FILTERS.find(([k]) => k === filter)?.[2] ?? (() => true)
  const entries = history.filter(fn)

  useEffect(() => {
    void api.markHistorySeen()
  }, [history])

  return (
    <Stack direction="row" sx={{ flex: 1, minHeight: 0, gap: 2 }}>
      <Stack sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" sx={{ gap: 1, justifyContent: 'center', py: 1.5, flexWrap: 'wrap' }}>
          {FILTERS.map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              variant={filter === key ? 'filled' : 'outlined'}
              color={filter === key ? 'secondary' : 'default'}
              onClick={() => setFilter(key)}
            />
          ))}
          {voicemail && (
            <Badge color="error" badgeContent={voicemail.unread} overlap="rectangular">
              <Chip
                label="Voicemail"
                variant={filter === 'voicemail' ? 'filled' : 'outlined'}
                color={filter === 'voicemail' ? 'secondary' : 'default'}
                onClick={() => setFilter('voicemail')}
              />
            </Badge>
          )}
        </Stack>
        {showVoicemail ? (
          <VoicemailList wide={wide} />
        ) : entries.length ? (
          <Box sx={{ overflowY: 'auto', flex: 1, px: 2, pb: 2 }}>
            <Card sx={{ maxWidth: wide ? 900 : 560, mx: 'auto' }}>
              <List disablePadding>
                {entries.map((e) => (
                  <HistoryItem key={`${e.time}-${e.number}`} entry={e} />
                ))}
              </List>
            </Card>
          </Box>
        ) : (
          <EmptyState icon={<HistoryIcon />} title="Keine Anrufe" description="Hier erscheinen deine ein- und ausgehenden Anrufe." />
        )}
      </Stack>
      {wide && <SidePanel history={history} />}
    </Stack>
  )
}
