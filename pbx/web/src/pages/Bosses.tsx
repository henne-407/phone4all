import SupervisorAccountIcon from '@mui/icons-material/SupervisorAccount'
import { FormControlLabel, Switch, TextField, Typography } from '@mui/material'
import type { BossPair } from '../../../server/model'
import { ChipsInput, CollectionPage, FormGrid, Full, Select } from '../components/common'
import { usePbx } from '../state'

function BossForm({ value, onChange }: { value: BossPair; onChange: (v: BossPair) => void }) {
  const { config } = usePbx()
  const set = <K extends keyof BossPair>(k: K, v: BossPair[K]): void => onChange({ ...value, [k]: v })
  const exts = config.extensions.map((e) => [e.number, `${e.number} – ${e.name}`] as [string, string])
  return (
    <FormGrid>
      <Full>
        <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required autoFocus fullWidth helperText="z. B. Geschäftsführung" />
      </Full>
      <Select label="Chef" value={value.boss} onChange={(v) => set('boss', v)} options={exts} helperText="Anrufe für diese Nebenstelle gehen ans Sekretariat" />
      <Select label="Sekretariat" value={value.secretary} onChange={(v) => set('secretary', v)} options={exts} helperText="Sieht „Für <Chef>:“ vor dem Namen des Anrufers" />
      <Full>
        <Select
          label="Wer klingelt"
          value={value.mode}
          onChange={(v) => set('mode', v)}
          options={[
            ['secretary', 'Nur das Sekretariat'],
            ['both', 'Sekretariat und Chef gleichzeitig'],
          ]}
        />
      </Full>
      <Full>
        <ChipsInput
          label="Kommen immer direkt durch"
          value={value.vip}
          onChange={(v) => set('vip', v)}
          helperText="Rufnummern, die direkt beim Chef klingeln (z. B. Familie); mit * am Ende für alle Nummern, die so beginnen"
        />
      </Full>
      <Full>
        <FormControlLabel
          control={<Switch checked={value.internal_direct} onChange={(e) => set('internal_direct', e.target.checked)} />}
          label="Interne Anrufe von Kollegen kommen direkt durch"
        />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Das Sekretariat ruft den Chef immer direkt an. Der Chef schaltet das Sekretariat mit *83 oder in der App ein und aus; ist es aus, klingelt er selbst.
        </Typography>
      </Full>
    </FormGrid>
  )
}

export default function Bosses() {
  const { config } = usePbx()
  const name = (n: string): string => {
    const e = config.extensions.find((x) => x.number === n)
    return e ? `${e.number} – ${e.name}` : n || '–'
  }
  return (
    <CollectionPage<BossPair>
      kind="bosses"
      overline="Personen"
      title="Chef und Sekretariat"
      singular="Chef-Sekretariat-Paar"
      description="Anrufe für den Chef landen zuerst im Sekretariat. Das Sekretariat sieht, für wen der Anruf ist, und verbindet weiter. Ausgewählte Anrufer kommen direkt durch."
      emptyIcon={<SupervisorAccountIcon />}
      emptyText="Noch kein Chef-Sekretariat-Paar eingerichtet."
      columns={[
        { label: 'Name', render: (b) => <b>{b.name}</b> },
        { label: 'Chef', render: (b) => name(b.boss) },
        { label: 'Sekretariat', render: (b) => name(b.secretary) },
        { label: 'Klingelt', render: (b) => (b.mode === 'both' ? 'Beide' : 'Sekretariat'), hideOnMobile: true },
        { label: 'Direkt durch', render: (b) => b.vip.length || '–', hideOnMobile: true },
      ]}
      Form={BossForm}
    />
  )
}
