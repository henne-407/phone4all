import AlarmIcon from '@mui/icons-material/Alarm'
import { Chip, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material'
import type { Reminder } from '../../../server/model'
import { CollectionPage, FormGrid, Full, Select } from '../components/common'
import { usePbx } from '../state'

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function when(r: Reminder): string {
  if (!r.days.length) return r.date ? `${new Date(`${r.date}T00:00`).toLocaleDateString('de-DE')} um ${r.time}` : `einmal um ${r.time}`
  const days = r.days.length === 7 ? 'täglich' : [...r.days].sort().map((d) => DAYS[d - 1]).join(', ')
  return `${days} um ${r.time}`
}

function ReminderForm({ value, onChange }: { value: Reminder; onChange: (v: Reminder) => void }) {
  const { config } = usePbx()
  const set = <K extends keyof Reminder>(k: K, v: Reminder[K]): void => onChange({ ...value, [k]: v })
  const once = !value.days.length
  const toggle = (d: number): void => set('days', value.days.includes(d) ? value.days.filter((x) => x !== d) : [...value.days, d].sort())
  return (
    <FormGrid>
      <Select
        label="Nebenstelle"
        value={value.extension}
        onChange={(v) => set('extension', v)}
        options={config.extensions.map((e) => [e.number, `${e.number} – ${e.name}`] as [string, string])}
      />
      <TextField label="Uhrzeit" type="time" value={value.time} onChange={(e) => set('time', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
      <Full>
        <FormControlLabel
          control={<Switch checked={once} onChange={(e) => onChange({ ...value, days: e.target.checked ? [] : [1, 2, 3, 4, 5], date: e.target.checked ? value.date || new Date().toISOString().slice(0, 10) : '' })} />}
          label="Nur einmal"
        />
      </Full>
      {once ? (
        <TextField label="Datum" type="date" value={value.date} onChange={(e) => set('date', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} helperText="Danach wird die Erinnerung gelöscht" />
      ) : (
        <Full>
          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
            {DAYS.map((d, i) => (
              <Chip key={d} label={d} color={value.days.includes(i + 1) ? 'primary' : 'default'} variant={value.days.includes(i + 1) ? 'filled' : 'outlined'} onClick={() => toggle(i + 1)} />
            ))}
          </Stack>
        </Full>
      )}
      <Full>
        <TextField
          label="Ansage"
          value={value.text}
          onChange={(e) => set('text', e.target.value)}
          multiline
          minRows={2}
          fullWidth
          helperText="Wird beim Abheben vorgelesen, z. B. „Teambesprechung in fünf Minuten“. Leer = nur ein Signalton. Braucht die Sprachausgabe (Ansagen und Musik)."
        />
      </Full>
      <Full>
        <FormControlLabel control={<Switch checked={value.enabled} onChange={(e) => set('enabled', e.target.checked)} />} label="Eingeschaltet" />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Am Telefon selbst: *55 und die Uhrzeit (z. B. *550730) stellt einen einmaligen Weckruf (heute oder, wenn die Zeit vorbei ist, morgen), *55 allein löscht die einmaligen.
        </Typography>
      </Full>
    </FormGrid>
  )
}

export default function Reminders() {
  const { config } = usePbx()
  const name = (n: string): string => {
    const e = config.extensions.find((x) => x.number === n)
    return e ? `${e.number} – ${e.name}` : n
  }
  return (
    <CollectionPage<Reminder>
      kind="reminders"
      overline="Personen"
      title="Erinnerungsanrufe"
      singular="Erinnerung"
      description="Das Telefon klingelt zur eingestellten Zeit und liest eine Ansage vor – als Weckruf, für Termine oder wiederkehrende Aufgaben."
      emptyIcon={<AlarmIcon />}
      emptyText="Noch keine Erinnerung eingerichtet."
      columns={[
        { label: 'Nebenstelle', render: (r) => <b>{name(r.extension)}</b> },
        { label: 'Wann', render: (r) => when(r) },
        { label: 'Ansage', render: (r) => r.text || 'Signalton', hideOnMobile: true },
        { label: 'Stand', render: (r) => (r.enabled ? 'An' : 'Aus') },
      ]}
      Form={ReminderForm}
    />
  )
}
