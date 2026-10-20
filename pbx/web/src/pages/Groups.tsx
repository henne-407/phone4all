import { Autocomplete, Box, Chip, TextField, Typography } from '@mui/material'
import type { Group, GroupMode, QueueStrategy } from '../../../server/model'
import { CollectionPage, DestinationPicker, FormGrid, Full, NumberField, Select, describeDestination } from '../components/common'
import { usePbx } from '../state'

const MODES: [GroupMode, string][] = [
  ['all', 'Alle gleichzeitig'],
  ['sequential', 'Nacheinander (in Reihenfolge)'],
  ['queue', 'Warteschlange mit Wartemusik'],
]

const STRATEGIES: [QueueStrategy, string][] = [
  ['ringall', 'Alle freien gleichzeitig'],
  ['rrmemory', 'Reihum (gleichmäßig verteilen)'],
  ['leastrecent', 'Wer am längsten nicht telefoniert hat'],
  ['fewestcalls', 'Wer die wenigsten Anrufe hatte'],
  ['linear', 'Immer in fester Reihenfolge'],
  ['random', 'Zufällig'],
]

function GroupForm({ value, onChange }: { value: Group; onChange: (v: Group) => void }) {
  const { config } = usePbx()
  const set = <K extends keyof Group>(k: K, v: Group[K]): void => onChange({ ...value, [k]: v })
  const options = config.extensions.map((e) => e.number)
  const name = (n: string): string => config.extensions.find((e) => e.number === n)?.name ?? ''
  return (
    <Box>
      <FormGrid>
        <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
        <TextField label="Interne Rufnummer" value={value.number} onChange={(e) => set('number', e.target.value.replace(/\D/g, ''))} helperText="Optional, z. B. 20" />
        <Full>
          <Autocomplete
            multiple
            options={options}
            value={value.members}
            onChange={(_e, v) => set('members', v)}
            getOptionLabel={(n) => `${n} – ${name(n)}`}
            renderValue={(items, getItemProps) =>
              items.map((n, index) => {
                const { key, ...rest } = getItemProps({ index })
                return <Chip key={key} size="small" label={`${n} ${name(n)}`} {...rest} />
              })
            }
            renderInput={(p) => <TextField {...p} label="Mitglieder" helperText="Reihenfolge zählt bei „Nacheinander“" />}
          />
        </Full>
        <Select label="Klingeln" value={value.mode} onChange={(v) => set('mode', v)} options={MODES} />
        {value.mode === 'queue' ? (
          <Select label="Verteilung" value={value.strategy} onChange={(v) => set('strategy', v)} options={STRATEGIES} />
        ) : (
          <TextField label="Vor den Anrufernamen setzen" value={value.name_prefix} onChange={(e) => set('name_prefix', e.target.value)} helperText="z. B. „Vertrieb: “ – so sieht man, worüber der Anruf kommt" />
        )}
        {value.mode !== 'all' && (
          <NumberField label="Klingeldauer je Person (Sekunden)" value={value.member_seconds} onChange={(v) => set('member_seconds', v)} min={5} />
        )}
        <NumberField label={value.mode === 'queue' ? 'Höchstens warten (Sekunden)' : 'Gesamtdauer (Sekunden)'} value={value.timeout} onChange={(v) => set('timeout', v)} min={5} />
        <Select
          label="Ansage vorher"
          value={value.announcement}
          onChange={(v) => set('announcement', v)}
          options={[['', 'Keine'], ...config.announcements.map((a): [string, string] => [a.id, a.name])]}
        />
        {value.mode === 'queue' && (
          <TextField label="Vor den Anrufernamen setzen" value={value.name_prefix} onChange={(e) => set('name_prefix', e.target.value)} />
        )}
        <Full>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Wenn niemand abnimmt
          </Typography>
          <DestinationPicker label="Weiter zu" value={value.fallback} onChange={(d) => set('fallback', d)} />
        </Full>
      </FormGrid>
    </Box>
  )
}

export default function Groups() {
  const { config } = usePbx()
  return (
    <CollectionPage<Group>
      kind="groups"
      title="Gruppen"
      singular="Gruppe"
      description="Mehrere Nebenstellen unter einer Nummer: Sammelruf, Reihum oder Warteschlange mit Wartemusik. Gruppen sind Ziele für eingehende Rufnummern, Sprachmenüs und Zeitsteuerungen."
      emptyText="Noch keine Gruppen, z. B. „Zentrale“ mit allen Nebenstellen."
      columns={[
        { label: 'Nr.', render: (g) => <b>{g.number || '–'}</b> },
        { label: 'Name', render: (g) => g.name },
        { label: 'Klingeln', hideOnMobile: true, render: (g) => MODES.find(([m]) => m === g.mode)?.[1] },
        { label: 'Mitglieder', render: (g) => g.members.join(', ') || '–' },
        { label: 'Sonst', hideOnMobile: true, render: (g) => describeDestination(g.fallback, config) },
      ]}
      Form={GroupForm}
    />
  )
}
