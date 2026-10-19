/** Termin anlegen, ansehen oder bearbeiten. */

import CallIcon from '@mui/icons-material/Call'
import CircleIcon from '@mui/icons-material/Circle'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { findNumbers } from '../../../shared/numbers'
import type { CalEvent } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../state'

const pad = (n: number): string => String(n).padStart(2, '0')
const dateStr = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeStr = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`

function combine(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = (time || '00:00').split(':').map(Number)
  return new Date(y, m - 1, d, h || 0, min || 0).getTime()
}

export function EventDialog({
  event,
  isNew,
  onClose,
}: {
  event: Partial<CalEvent>
  isNew: boolean
  onClose: () => void
}) {
  const { state } = useApp()
  const writable = state.calendars.filter((c) => c.enabled && c.writable)
  const editable = isNew || Boolean(event.editable)
  const start0 = new Date(event.start ?? Date.now())
  const end0 = new Date(event.allDay ? (event.end ?? Date.now()) - 86400000 : (event.end ?? Date.now() + 3600000))

  const [summary, setSummary] = useState(event.summary ?? '')
  const [location, setLocation] = useState(event.location ?? '')
  const [description, setDescription] = useState(event.description ?? '')
  const [allDay, setAllDay] = useState(Boolean(event.allDay))
  const [startDate, setStartDate] = useState(dateStr(start0))
  const [startTime, setStartTime] = useState(timeStr(start0))
  const [endDate, setEndDate] = useState(dateStr(end0))
  const [endTime, setEndTime] = useState(timeStr(end0))
  const [calendarId, setCalendarId] = useState(
    event.calendarId ?? state.defaultCalendar ?? writable[0]?.id ?? '',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const duration = (event.end ?? 0) - (event.start ?? 0)
  const numbers = useMemo(() => findNumbers(summary, location, description), [summary, location, description])

  // Ende mitverschieben, damit die Dauer erhalten bleibt
  const moveStart = (date: string, time: string): void => {
    setStartDate(date)
    setStartTime(time)
    if (!date) return
    let end = new Date(combine(date, time) + Math.max(duration, 0))
    if (allDay) end = new Date(end.getTime() - 86400000)
    setEndDate(dateStr(end))
    setEndTime(timeStr(end))
  }

  const collect = (): CalEvent => {
    let start = combine(startDate, allDay ? '00:00' : startTime)
    let end = allDay ? combine(endDate, '00:00') + 86400000 : combine(endDate, endTime)
    if (end <= start) end = start + (allDay ? 86400000 : 30 * 60000)
    if (allDay) start = combine(startDate, '00:00')
    const cal = state.calendars.find((c) => c.id === calendarId)
    return {
      uid: event.uid ?? '',
      calendarId,
      calendarName: cal?.name ?? '',
      color: cal?.color ?? '',
      href: event.href ?? '',
      recurring: false,
      editable: true,
      summary: summary.trim(),
      location: location.trim(),
      description: description.trim(),
      allDay,
      start,
      end,
    }
  }

  const finish = (r: { ok: true } | { ok: false; error: string }): void => {
    setBusy(false)
    if (r.ok) onClose()
    else setError(r.error)
  }

  const save = async (): Promise<void> => {
    if (!summary.trim() || !calendarId) return
    setBusy(true)
    setError('')
    finish(await api.saveEvent(collect(), isNew))
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    finish(await api.deleteEvent(event as CalEvent))
  }

  const calendarChoices = isNew ? writable : state.calendars.filter((c) => c.id === event.calendarId)

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isNew ? 'Neuer Termin' : editable ? 'Termin bearbeiten' : 'Termin'}</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 1.5 }}>
          {!editable && (
            <Alert severity="info">
              {event.recurring
                ? 'Serientermine bitte in der Kalender-App bearbeiten.'
                : 'Dieser Kalender ist schreibgeschützt.'}
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {numbers.length > 0 && (
            <List disablePadding dense>
              {numbers.map((n) => (
                <ListItemButton
                  key={n}
                  onClick={() => {
                    onClose()
                    void api.dial(n)
                  }}
                >
                  <ListItemIcon sx={{ color: 'success.main' }}>
                    <CallIcon />
                  </ListItemIcon>
                  <ListItemText primary={n} secondary="Anrufen" />
                </ListItemButton>
              ))}
            </List>
          )}
          <TextField
            label="Titel"
            value={summary}
            autoFocus={editable}
            onChange={(e) => setSummary(e.target.value)}
            disabled={!editable}
          />
          <TextField
            label="Ort oder Einwahlnummer"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={!editable}
          />
          <FormControlLabel
            control={<Switch checked={allDay} onChange={(e) => setAllDay(e.target.checked)} disabled={!editable} />}
            label="Ganztägig"
          />
          <Stack direction="row" sx={{ gap: 1.5 }}>
            <TextField
              type="date"
              label="Beginn"
              value={startDate}
              onChange={(e) => moveStart(e.target.value, startTime)}
              disabled={!editable}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            {!allDay && (
              <TextField
                type="time"
                label="Uhrzeit"
                value={startTime}
                onChange={(e) => moveStart(startDate, e.target.value)}
                disabled={!editable}
                sx={{ maxWidth: 150 }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            )}
          </Stack>
          <Stack direction="row" sx={{ gap: 1.5 }}>
            <TextField
              type="date"
              label="Ende"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={!editable}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            {!allDay && (
              <TextField
                type="time"
                label="Uhrzeit"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={!editable}
                sx={{ maxWidth: 150 }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            )}
          </Stack>
          <TextField
            label="Notizen"
            multiline
            minRows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!editable}
          />
          <TextField
            select
            label="Kalender"
            value={calendarChoices.some((c) => c.id === calendarId) ? calendarId : ''}
            onChange={(e) => setCalendarId(e.target.value)}
            disabled={!isNew || calendarChoices.length < 2}
          >
            {calendarChoices.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                <CircleIcon sx={{ fontSize: 12, color: c.color, mr: 1.5 }} />
                {c.group ? `${c.name}  (${c.group})` : c.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        {!isNew && editable && (
          <Button color="error" disabled={busy} onClick={() => void remove()}>
            Löschen
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {editable ? (
          <>
            <Button onClick={onClose}>Abbrechen</Button>
            <Button variant="contained" disabled={busy || !summary.trim() || !calendarId} onClick={() => void save()}>
              {busy ? 'Speichert …' : 'Speichern'}
            </Button>
          </>
        ) : (
          <Button variant="contained" onClick={onClose}>
            Schließen
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
