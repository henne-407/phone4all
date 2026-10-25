/** Zentrale Kalender: Kalender verwalten und Termine eintragen. Die Apps zeigen sie neben den eigenen Kalendern. */

import AddIcon from '@mui/icons-material/Add'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import type { CentralCalendar } from '../../../server/model'
import { api } from '../api'
import { CollectionPage, FormGrid, Full, Select } from '../components/common'
import { CalendarSourceFields, SourceState, useSourceStatus } from '../components/Sources'
import { usePbx } from '../state'

interface CalendarEvent {
  uid: string
  summary: string
  start: string
  end: string
  allDay: boolean
  location: string
  description: string
}

const COLORS = ['#1a73e8', '#0b8043', '#d50000', '#f4511e', '#8e24aa', '#f6bf26', '#039be5', '#616161']

function CalendarForm({ value, onChange }: { value: CentralCalendar; onChange: (v: CentralCalendar) => void }) {
  const set = <K extends keyof CentralCalendar>(k: K, v: CentralCalendar[K]): void => onChange({ ...value, [k]: v })
  return (
    <FormGrid>
      <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required autoFocus helperText="z. B. „Betrieb“, „Schichtplan“, „Besprechungsraum“" />
      <Select
        label="Art"
        value={value.kind}
        onChange={(v) => set('kind', v)}
        options={[
          ['events', 'Eigene Termine'],
          ['holidays', 'Feiertage des Bundeslandes (automatisch)'],
          ['subscription', 'Anderer Kalender (Abo, CalDAV) – nur lesen'],
        ]}
      />
      {value.kind === 'subscription' && <CalendarSourceFields value={value.source} onChange={(v) => set('source', v)} />}
      <Full>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Farbe
        </Typography>
        <Stack direction="row" sx={{ gap: 1 }}>
          {COLORS.map((c) => (
            <Box
              key={c}
              role="button"
              aria-label={c}
              onClick={() => set('color', c)}
              sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: c, cursor: 'pointer', outline: value.color === c ? '3px solid' : 'none', outlineColor: 'text.primary', outlineOffset: 2 }}
            />
          ))}
        </Stack>
      </Full>
      {value.kind === 'events' && (
        <Full>
          <FormControlLabel control={<Switch checked={value.writable} onChange={(e) => set('writable', e.target.checked)} />} label="Alle dürfen in der App Termine eintragen und ändern" />
        </Full>
      )}
    </FormGrid>
  )
}

const pad = (n: number): string => String(n).padStart(2, '0')
const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localDateTime = (d: Date): string => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const parseDate = (s: string): Date => (s.length === 10 ? new Date(`${s}T00:00`) : new Date(s))

function whenText(e: CalendarEvent): string {
  const start = parseDate(e.start)
  const day = (d: Date): string => d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })
  if (e.allDay) {
    const last = parseDate(e.end)
    last.setDate(last.getDate() - 1)
    return last > start ? `${day(start)} – ${day(last)}` : `${day(start)}, ganztägig`
  }
  const end = parseDate(e.end)
  const time = (d: Date): string => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return localDate(start) === localDate(end) ? `${day(start)}, ${time(start)}–${time(end)}` : `${day(start)} ${time(start)} – ${day(end)} ${time(end)}`
}

interface Draft {
  uid?: string
  summary: string
  allDay: boolean
  start: string
  end: string
  location: string
  description: string
}

function EventDialog({ calendar, draft, onClose }: { calendar: CentralCalendar; draft: Draft; onClose: (changed: boolean) => void }) {
  const { toast } = usePbx()
  const [v, setV] = useState(draft)
  const set = <K extends keyof Draft>(k: K, val: Draft[K]): void => setV({ ...v, [k]: val })
  const save = async (): Promise<void> => {
    let { start, end } = v
    if (v.allDay) {
      // Ende ist exklusiv: der Tag nach dem letzten Tag
      const e = new Date(`${end}T00:00`)
      e.setDate(e.getDate() + 1)
      end = localDate(e)
    } else {
      start = new Date(start).toISOString()
      end = new Date(end).toISOString()
    }
    try {
      await api.post(`/api/calendars/${calendar.id}/events`, { ...v, start, end })
      onClose(true)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const remove = async (): Promise<void> => {
    await api.del(`/api/calendars/${calendar.id}/events/${encodeURIComponent(v.uid!)}`)
    onClose(true)
  }
  const type = v.allDay ? 'date' : 'datetime-local'
  return (
    <Dialog open onClose={() => onClose(false)} fullWidth maxWidth="sm">
      <DialogTitle>{v.uid ? 'Termin bearbeiten' : `Termin in „${calendar.name}“`}</DialogTitle>
      <DialogContent>
        <FormGrid>
          <Full>
            <TextField label="Titel" value={v.summary} onChange={(e) => set('summary', e.target.value)} required autoFocus sx={{ mt: 1 }} />
          </Full>
          <Full>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={v.allDay}
              onChange={(_e, allDay: boolean | null) => {
                if (allDay === null) return
                const s = parseDate(v.start)
                const e = parseDate(v.end)
                setV({ ...v, allDay, start: allDay ? localDate(s) : localDateTime(new Date(s.setHours(9))), end: allDay ? localDate(e) : localDateTime(new Date(e.setHours(10))) })
              }}
            >
              <ToggleButton value={true}>Ganztägig</ToggleButton>
              <ToggleButton value={false}>Mit Uhrzeit</ToggleButton>
            </ToggleButtonGroup>
          </Full>
          <TextField type={type} label="Beginn" value={v.start} onChange={(e) => set('start', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField type={type} label={v.allDay ? 'Letzter Tag' : 'Ende'} value={v.end} onChange={(e) => set('end', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <Full>
            <TextField label="Ort" value={v.location} onChange={(e) => set('location', e.target.value)} />
          </Full>
          <Full>
            <TextField label="Beschreibung" value={v.description} onChange={(e) => set('description', e.target.value)} multiline minRows={2} />
          </Full>
        </FormGrid>
      </DialogContent>
      <DialogActions>
        {v.uid && (
          <Button color="error" onClick={() => void remove()} sx={{ mr: 'auto' }}>
            Löschen
          </Button>
        )}
        <Button onClick={() => onClose(false)}>Abbrechen</Button>
        <Button variant="contained" onClick={() => void save()} disabled={!v.summary.trim() || !v.start || !v.end}>
          Speichern
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function toDraft(e: CalendarEvent): Draft {
  if (e.allDay) {
    const last = parseDate(e.end)
    last.setDate(last.getDate() - 1)
    return { ...e, end: localDate(last) }
  }
  return { ...e, start: localDateTime(new Date(e.start)), end: localDateTime(new Date(e.end)) }
}

/** Kommende Termine aller Kalender; Klick öffnet den Termin. */
function Agenda() {
  const { config } = usePbx()
  const [events, setEvents] = useState<(CalendarEvent & { calendar: CentralCalendar })[] | null>(null)
  const [edit, setEdit] = useState<{ calendar: CentralCalendar; draft: Draft } | null>(null)
  const [target, setTarget] = useState('')
  const writable = config.calendars.filter((c) => c.kind === 'events')
  const cal = writable.find((c) => c.id === target) ?? writable[0]

  const load = async (): Promise<void> => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start.getTime() + 120 * 86400000)
    const q = `start=${start.toISOString()}&end=${end.toISOString()}`
    const lists = await Promise.all(
      config.calendars.map(async (c) => (await api.get<CalendarEvent[]>(`/api/calendars/${c.id}/events?${q}`)).map((e) => ({ ...e, calendar: c }))),
    )
    setEvents(lists.flat().sort((a, b) => parseDate(a.start).getTime() - parseDate(b.start).getTime()))
  }
  useEffect(() => {
    void load()
  }, [config.calendars])

  if (!config.calendars.length) return null
  const today = localDate(new Date())
  return (
    <Card sx={{ mt: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { sm: 'center' }, gap: 1.5, mb: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6">Nächste Termine</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Die kommenden vier Monate aus allen zentralen Kalendern
            </Typography>
          </Box>
          {writable.length > 1 && (
            <Select label="Eintragen in" value={cal?.id ?? ''} onChange={setTarget} options={writable.map((c): [string, string] => [c.id, c.name])} />
          )}
          {cal && (
            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setEdit({ calendar: cal, draft: { summary: '', allDay: true, start: today, end: today, location: '', description: '' } })}>
              Termin
            </Button>
          )}
        </Stack>
        {events && !events.length && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Keine Termine in den nächsten Monaten.
          </Typography>
        )}
        <List disablePadding>
          {(events ?? []).slice(0, 40).map((e) => (
            <ListItemButton
              key={`${e.calendar.id}/${e.uid}`}
              disabled={e.calendar.kind !== 'events'}
              onClick={() => setEdit({ calendar: e.calendar, draft: toDraft(e) })}
              sx={{ borderRadius: 2, gap: 2, '&.Mui-disabled': { opacity: 1 } }}
            >
              <Box sx={{ width: 4, alignSelf: 'stretch', borderRadius: 2, bgcolor: e.calendar.color, flexShrink: 0 }} />
              <ListItemText primary={e.summary} secondary={`${whenText(e)} · ${e.calendar.name}${e.location ? ` · ${e.location}` : ''}`} />
            </ListItemButton>
          ))}
        </List>
      </CardContent>
      {edit && (
        <EventDialog
          calendar={edit.calendar}
          draft={edit.draft}
          onClose={(changed) => {
            setEdit(null)
            if (changed) void load()
          }}
        />
      )}
    </Card>
  )
}

function kindText(c: CentralCalendar): string {
  if (c.kind === 'holidays') return 'Feiertage, automatisch'
  if (c.kind === 'subscription') return c.source.type === 'caldav' ? 'CalDAV, nur lesen' : 'Abo, nur lesen'
  return c.writable ? 'Alle können eintragen' : 'Nur hier änderbar'
}

export default function Calendars() {
  const { config } = usePbx()
  const [status] = useSourceStatus()
  return (
    <CollectionPage<CentralCalendar>
      kind="calendars"
      overline="Zusammenarbeit"
      title="Zentrale Kalender"
      singular="Kalender"
      description="Gemeinsame Kalender für alle Apps, z. B. Betriebsferien, Schichtplan oder Feiertage – auch aus anderen Kalendern (Abo-Link, CalDAV). Welche Kalender eine App zeigt, legt das App-Profil fest."
      emptyText="Lege z. B. einen Kalender „Betrieb“ für Betriebsferien und Termine an, die alle sehen sollen."
      emptyIcon={<CalendarMonthIcon />}
      columns={[
        {
          label: 'Name',
          render: (c) => (
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: c.color, flexShrink: 0 }} />
              <b>{c.name}</b>
            </Stack>
          ),
        },
        { label: 'Art', render: (c) => (c.kind === 'subscription' ? <SourceState status={status[c.id]} unit="Termine" /> : kindText(c)) },
        {
          label: 'App-Profile',
          render: (c) => {
            const profiles = config.appprofiles.filter((p) => !p.calendars.length || p.calendars.includes(c.id))
            return config.appprofiles.length ? `${profiles.length} von ${config.appprofiles.length}` : '–'
          },
          hideOnMobile: true,
        },
      ]}
      card={(c) => {
        const profiles = config.appprofiles.filter((p) => !p.calendars.length || p.calendars.includes(c.id))
        return (
          <Stack direction="row" sx={{ gap: 2, alignItems: 'center' }}>
            <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: c.color, flexShrink: 0, display: 'grid', placeItems: 'center', color: '#fff' }}>
              <CalendarMonthIcon />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" noWrap>
                {c.name}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {kindText(c)}
                {config.appprofiles.length > 0 && ` · in ${profiles.length} von ${config.appprofiles.length} Profilen`}
              </Typography>
              {c.kind === 'subscription' && <SourceState status={status[c.id]} unit="Termine" />}
            </Box>
          </Stack>
        )
      }}
      Form={CalendarForm}
      after={<Agenda />}
    />
  )
}
