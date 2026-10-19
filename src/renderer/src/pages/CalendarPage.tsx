/** Kalender-Tab: Monatsansicht, Terminliste des Tages und (breit) die folgenden Termine. */

import AddIcon from '@mui/icons-material/Add'
import CallIcon from '@mui/icons-material/Call'
import CalendarIcon from '@mui/icons-material/CalendarMonth'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import RefreshIcon from '@mui/icons-material/Refresh'
import RepeatIcon from '@mui/icons-material/Repeat'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import { useCallback, useEffect, useRef, useState } from 'react'
import { addDays, covers, fmtDay, fmtEventTime, fmtMonth, sameDay, startOfDay } from '../../../shared/format'
import { findNumbers } from '../../../shared/numbers'
import type { CalEvent } from '../../../shared/types'
import { api } from '../api'
import { emit } from '../bus'
import { EmptyState } from '../components/common'
import { useApp } from '../state'

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function firstVisible(year: number, month: number): Date {
  const first = new Date(year, month, 1)
  return addDays(first, -((first.getDay() + 6) % 7))
}

export function EventRow({ ev, day, subtitlePrefix = '' }: { ev: CalEvent; day?: Date; subtitlePrefix?: string }) {
  const numbers = findNumbers(ev.summary, ev.location, ev.description)
  let subtitle = fmtEventTime(ev, day)
  if (ev.location) subtitle += ' · ' + ev.location
  return (
    <ListItem
      disablePadding
      secondaryAction={
        <Stack direction="row" sx={{ alignItems: 'center' }}>
          {ev.recurring && (
            <Tooltip title="Serientermin">
              <RepeatIcon fontSize="small" sx={{ color: 'text.disabled', mr: 1 }} />
            </Tooltip>
          )}
          {numbers.length > 0 && (
            <Tooltip title={`${numbers[0]} anrufen`}>
              <IconButton edge="end" sx={{ color: 'success.main' }} onClick={() => void api.dial(numbers[0])}>
                <CallIcon />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      }
    >
      <ListItemButton onClick={() => emit('open-event', { event: ev, isNew: false })} sx={{ pr: numbers.length ? 10 : 6 }}>
        <Tooltip title={ev.calendarName}>
          <Box sx={{ width: 6, alignSelf: 'stretch', borderRadius: 3, bgcolor: ev.color, mr: 2, my: 0.5, flexShrink: 0 }} />
        </Tooltip>
        <ListItemText
          primary={ev.summary}
          secondary={subtitlePrefix + subtitle}
          slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
        />
      </ListItemButton>
    </ListItem>
  )
}

function MonthView({
  year,
  month,
  selected,
  marks,
  onSelect,
  onShift,
}: {
  year: number
  month: number
  selected: Date
  marks: Map<number, string[]>
  onSelect: (d: Date) => void
  onShift: (delta: number) => void
}) {
  const { md } = useTheme()
  const today = new Date()
  const first = firstVisible(year, month)
  const wheel = useRef(0)
  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, mb: 1 }}>
        <Typography variant="h6" sx={{ flex: 1, pl: 1 }}>
          {fmtMonth(new Date(year, month, 1))}
        </Typography>
        <Button size="small" onClick={() => onSelect(startOfDay(new Date()))}>
          Heute
        </Button>
        <Tooltip title="Voriger Monat">
          <IconButton onClick={() => onShift(-1)}>
            <ChevronLeftIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Nächster Monat">
          <IconButton onClick={() => onShift(1)}>
            <ChevronRightIcon />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}
        onWheel={(e) => {
          // Mausrad blättert monatsweise (gebremst, damit Touchpads nicht davonrasen)
          wheel.current += e.deltaY
          if (Math.abs(wheel.current) > 60) {
            onShift(wheel.current > 0 ? 1 : -1)
            wheel.current = 0
          }
        }}
      >
        {WEEKDAYS.map((d) => (
          <Typography key={d} variant="caption" sx={{ textAlign: 'center', color: 'text.secondary', py: 0.5 }}>
            {d}
          </Typography>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const day = addDays(first, i)
          const isSelected = sameDay(day, selected)
          const isToday = sameDay(day, today)
          const other = day.getMonth() !== month
          const colors = marks.get(startOfDay(day).getTime()) ?? []
          return (
            <ButtonBase
              key={i}
              onClick={() => onSelect(day)}
              sx={{
                flexDirection: 'column',
                height: 48,
                borderRadius: 3,
                color: other ? alpha(md.onSurface, 0.38) : md.onSurface,
                '&:hover': { bgcolor: alpha(md.onSurface, 0.08) },
              }}
            >
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  bgcolor: isSelected ? md.primary : 'transparent',
                  color: isSelected ? md.onPrimary : isToday ? md.primary : 'inherit',
                  border: isToday && !isSelected ? `1px solid ${md.primary}` : 'none',
                  fontWeight: isToday ? 600 : 400,
                }}
              >
                {day.getDate()}
              </Box>
              <Stack direction="row" sx={{ gap: '2px', height: 6 }}>
                {colors.slice(0, 3).map((c, j) => (
                  <Box key={j} sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: c }} />
                ))}
              </Stack>
            </ButtonBase>
          )
        })}
      </Box>
    </Box>
  )
}

export function CalendarPage({ wide }: { wide: boolean }) {
  const { state } = useApp()
  const [selected, setSelected] = useState(startOfDay(new Date()))
  const [view, setView] = useState({ year: selected.getFullYear(), month: selected.getMonth() })
  const [events, setEvents] = useState<CalEvent[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const request = useRef(0)
  const enabled = state.calendars.filter((c) => c.enabled)
  const writable = enabled.filter((c) => c.writable)

  const load = useCallback(async () => {
    if (!enabled.length) return
    const req = ++request.current
    setLoading(true)
    const first = firstVisible(view.year, view.month)
    const r = await api.fetchEvents(first.getTime(), addDays(first, 42).getTime())
    if (req !== request.current) return
    setLoading(false)
    setEvents(r.events)
    setErrors(r.errors)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, enabled.length, state.eventsVersion, state.calendars])

  useEffect(() => {
    void load()
  }, [load])

  const marks = new Map<number, string[]>()
  const first = firstVisible(view.year, view.month)
  for (let i = 0; i < 42; i++) {
    const day = addDays(first, i)
    const colors = events.filter((e) => covers(e, day)).map((e) => e.color)
    if (colors.length) marks.set(day.getTime(), colors)
  }

  const select = (d: Date): void => {
    setSelected(d)
    setView({ year: d.getFullYear(), month: d.getMonth() })
  }
  const shift = (delta: number): void => setView((v) => {
    const d = new Date(v.year, v.month + delta, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  })

  const newEvent = (): void => {
    const now = new Date()
    let start: Date
    if (sameDay(selected, now)) {
      start = new Date(now)
      start.setHours(now.getHours() + 1, 0, 0, 0)
    } else {
      start = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), 9)
    }
    emit('open-event', { event: { start: start.getTime(), end: start.getTime() + 3600000 }, isNew: true })
  }

  if (state.calendarsLoading && !state.calendars.length) {
    return (
      <Stack sx={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Stack>
    )
  }
  if (!enabled.length) {
    return (
      <EmptyState
        icon={<CalendarIcon />}
        title="Kein Kalender verbunden"
        description={
          'Verbinde einen CalDAV-Kalender (z. B. Nextcloud, iCloud, mailbox.org)' +
          (state.platform.eds ? ' oder nutze Kalender aus GNOME Online-Konten.' : '.')
        }
      >
        <Button variant="contained" onClick={() => emit('open-preferences', 'calendar')}>
          Kalender einrichten
        </Button>
      </EmptyState>
    )
  }

  const dayEvents = events.filter((e) => covers(e, selected))
  const later = wide ? events.filter((e) => startOfDay(new Date(e.start)) > selected).slice(0, 10) : []
  const allErrors = [...state.calendarErrors, ...errors]

  return (
    <Box sx={{ overflowY: 'auto', flex: 1 }}>
      <Stack
        direction={wide ? 'row' : 'column'}
        sx={{ gap: wide ? 3 : 1.5, px: 1.5, pb: 3, maxWidth: wide ? 1400 : 560, mx: 'auto', alignItems: wide ? 'flex-start' : 'stretch' }}
      >
        <Box sx={{ width: wide ? 480 : 'auto', flexShrink: 0 }}>
          <MonthView year={view.year} month={view.month} selected={selected} marks={marks} onSelect={select} onShift={shift} />
        </Box>
        <Stack sx={{ flex: 1, gap: 1.5, minWidth: 0 }}>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1, pl: 0.5, pt: 0.5 }}>
            <Typography variant="h6" sx={{ flex: 1 }}>
              {fmtDay(selected)}
            </Typography>
            {loading && <CircularProgress size={20} />}
            <Tooltip title="Aktualisieren">
              <IconButton onClick={() => void api.refreshCalendars()}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            {writable.length > 0 && (
              <Button variant="contained" color="secondary" startIcon={<AddIcon />} onClick={newEvent}>
                Termin
              </Button>
            )}
          </Stack>
          {allErrors.length > 0 && <Alert severity="error">{allErrors.join('\n')}</Alert>}
          {dayEvents.length ? (
            <Card>
              <List disablePadding>
                {dayEvents.map((ev) => (
                  <EventRow key={ev.uid + ev.start} ev={ev} day={selected} />
                ))}
              </List>
            </Card>
          ) : (
            <Typography sx={{ color: 'text.secondary', textAlign: 'center', mt: 2 }}>Keine Termine</Typography>
          )}
          {later.length > 0 && (
            <>
              <Typography variant="h6" sx={{ pl: 0.5, mt: 1.5 }}>
                Demnächst
              </Typography>
              <Card>
                <List disablePadding>
                  {later.map((ev) => (
                    <EventRow
                      key={ev.uid + ev.start}
                      ev={ev}
                      day={startOfDay(new Date(ev.start))}
                      subtitlePrefix={`${fmtDay(new Date(ev.start), false)} · `}
                    />
                  ))}
                </List>
              </Card>
            </>
          )}
        </Stack>
      </Stack>
    </Box>
  )
}
