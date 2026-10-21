import { FormControlLabel, Switch, TextField } from '@mui/material'
import type { Conference } from '../../../server/model'
import { CollectionPage, FormGrid, Full, NumberField } from '../components/common'

function ConferenceForm({ value, onChange }: { value: Conference; onChange: (v: Conference) => void }) {
  const set = <K extends keyof Conference>(k: K, v: Conference[K]): void => onChange({ ...value, [k]: v })
  return (
    <FormGrid>
      <TextField label="Rufnummer" value={value.number} onChange={(e) => set('number', e.target.value.replace(/\D/g, ''))} required autoFocus helperText="z. B. 800" />
      <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} />
      <TextField label="PIN für Teilnehmer" value={value.pin} onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))} helperText="Leer = ohne PIN" />
      <TextField label="PIN für Moderation" value={value.admin_pin} onChange={(e) => set('admin_pin', e.target.value.replace(/\D/g, ''))} helperText="Moderatoren dürfen Teilnehmer stummschalten" />
      <NumberField label="Höchstens Teilnehmer (0 = 50)" value={value.max_members} onChange={(v) => set('max_members', v)} />
      <Full>
        <FormControlLabel control={<Switch checked={value.record} onChange={(e) => set('record', e.target.checked)} />} label="Konferenz aufzeichnen (nur mit Einwilligung aller)" />
      </Full>
    </FormGrid>
  )
}

export default function Conferences() {
  return (
    <CollectionPage<Conference>
      kind="conferences"
      overline="Zusammenarbeit"
      title="Konferenzräume"
      singular="Konferenzraum"
      description="Telefonkonferenzen für beliebig viele Teilnehmer, intern und – als Ziel einer Rufnummer – auch von außen erreichbar."
      columns={[
        { label: 'Nr.', render: (c) => <b>{c.number}</b> },
        { label: 'Name', render: (c) => c.name },
        { label: 'PIN', render: (c) => (c.pin ? 'ja' : 'nein') },
      ]}
      Form={ConferenceForm}
    />
  )
}
