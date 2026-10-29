/** Umleitungsregeln einer Nebenstelle: nach Zeitplan, Zeitsteuerung, Termin oder bei „Nicht stören“. */

import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { Box, Button, Card, IconButton, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import type { ForwardRule } from '../../../server/model'
import { type NumberOption, NumberPicker, Select } from './common'

const WHEN: [ForwardRule['when'], string][] = [
  ['schedule', 'Zu bestimmten Zeiten'],
  ['timecondition', 'Nach Zeitsteuerung'],
  ['dnd', 'Bei „Nicht stören“'],
  ['calendar', 'Bei Termin im Kalender'],
]

const ACTIONS: [NonNullable<ForwardRule['action']>, string][] = [
  ['forward', 'Umleiten'],
  ['dnd', 'Nicht stören einschalten'],
]

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

export function newRule(): ForwardRule {
  return { id: '', enabled: true, when: 'schedule', action: 'forward', days: [1, 2, 3, 4, 5], from: '18:00', to: '08:00', timecondition: '', tc_state: 'closed', target: '' }
}

export function ForwardRules({
  value,
  onChange,
  targets,
  timeconditions,
  calendars,
  disabled = false,
}: {
  value: ForwardRule[]
  onChange: (v: ForwardRule[]) => void
  targets: NumberOption[]
  timeconditions: { id: string; name: string }[]
  calendars: { id: string; name: string }[]
  disabled?: boolean
}) {
  const update = (i: number, patch: Partial<ForwardRule>): void => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <Stack sx={{ gap: 1.5 }}>
      {value.map((r, i) => (
        <Card key={r.id || i} variant="outlined" sx={{ p: 2, opacity: r.enabled ? 1 : 0.7 }}>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Switch checked={r.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} disabled={disabled} slotProps={{ input: { 'aria-label': 'Regel aktiv' } }} />
            <Typography variant="subtitle2" sx={{ flex: 1 }}>
              Regel {i + 1}
            </Typography>
            <Tooltip title="Regel löschen">
              <span>
                <IconButton size="small" onClick={() => onChange(value.filter((_r, j) => j !== i))} disabled={disabled}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
            <Select label="Wann" value={r.when} onChange={(when) => update(i, { when, action: when === 'dnd' ? 'forward' : r.action })} options={WHEN} />
            <Select
              label="Was"
              value={r.action ?? 'forward'}
              onChange={(action) => update(i, { action })}
              options={r.when === 'dnd' ? ACTIONS.slice(0, 1) : ACTIONS}
              helperText={r.action === 'dnd' ? 'Anrufe gehen zur Voicemail bzw. zur Weiterleitung bei besetzt' : undefined}
            />
            {r.action !== 'dnd' && (
              <NumberPicker label="Umleiten an" value={r.target} onChange={(target) => update(i, { target })} options={targets} helperText="Nebenstelle wählen oder Nummer eintippen" />
            )}
            {r.when === 'calendar' && (
              <>
                <Select
                  label="Kalender"
                  value={r.calendar ?? ''}
                  onChange={(calendar) => update(i, { calendar })}
                  options={[['', 'Bitte wählen'], ...calendars.map((c): [string, string] => [c.id, c.name])]}
                  helperText={calendars.length ? undefined : 'Noch kein zentraler Kalender angelegt'}
                />
                <TextField
                  label="Nur Termine mit"
                  value={r.keyword ?? ''}
                  onChange={(e) => update(i, { keyword: e.target.value })}
                  helperText="Wörter im Titel, z. B. „Urlaub Anna“; leer = jeder Termin"
                  disabled={disabled}
                />
              </>
            )}
            {r.when === 'schedule' && (
              <>
                <Box sx={{ gridColumn: '1 / -1' }}>
                  <ToggleButtonGroup
                    size="small"
                    value={r.days}
                    onChange={(_e, days: number[]) => update(i, { days: [...days].sort() })}
                    aria-label="Wochentage"
                    disabled={disabled}
                  >
                    {DAYS.map((d, j) => (
                      <ToggleButton key={d} value={j + 1} sx={{ px: 1.5 }}>
                        {d}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                </Box>
                <TextField type="time" label="Von" value={r.from} onChange={(e) => update(i, { from: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} disabled={disabled} />
                <TextField
                  type="time"
                  label="Bis"
                  value={r.to}
                  onChange={(e) => update(i, { to: e.target.value })}
                  slotProps={{ inputLabel: { shrink: true } }}
                  helperText={r.to <= r.from ? 'Über Mitternacht bis zum Folgetag' : undefined}
                  disabled={disabled}
                />
              </>
            )}
            {r.when === 'timecondition' && (
              <>
                <Select
                  label="Zeitsteuerung"
                  value={r.timecondition}
                  onChange={(timecondition) => update(i, { timecondition })}
                  options={[['', 'Bitte wählen'], ...timeconditions.map((t): [string, string] => [t.id, t.name])]}
                  helperText={timeconditions.length ? undefined : 'Noch keine Zeitsteuerung angelegt'}
                />
                <Select
                  label="Umleiten, wenn"
                  value={r.tc_state}
                  onChange={(tc_state) => update(i, { tc_state })}
                  options={[
                    ['closed', 'geschlossen (außerhalb der Zeiten, Feiertag)'],
                    ['open', 'geöffnet'],
                  ]}
                />
              </>
            )}
          </Box>
        </Card>
      ))}
      <Box>
        <Button startIcon={<AddIcon />} onClick={() => onChange([...value, newRule()])} disabled={disabled}>
          Regel hinzufügen
        </Button>
      </Box>
    </Stack>
  )
}
