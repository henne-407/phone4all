import GroupsIcon from '@mui/icons-material/Groups'
import { Autocomplete, Box, Chip, Stack, TextField, Tooltip, Typography } from '@mui/material'
import type { Group, GroupMode, QueueStrategy } from '../../../server/model'
import { CollectionPage, Initials, DestinationPicker, FormGrid, FormHeading, Full, NumberField, Select, describeDestination } from '../components/common'
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
          <FormHeading>Wenn niemand abnimmt</FormHeading>
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
      overline="Personen"
      title="Gruppen"
      singular="Gruppe"
      description="Mehrere Nebenstellen unter einer Nummer: Sammelruf, Reihum oder Warteschlange mit Wartemusik. Gruppen sind Ziele in den Rufabfolgen."
      emptyText="Noch keine Gruppen, z. B. „Zentrale“ mit allen Nebenstellen."
      emptyIcon={<GroupsIcon />}
      card={(g) => (
        <Box>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            <Initials name={g.name} size={44} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6" noWrap>
                {g.name}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {g.number ? `Intern ${g.number}` : 'Ohne interne Nummer'} · {MODES.find(([m]) => m === g.mode)?.[1]}
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" sx={{ alignItems: 'center', mb: 1.5, pl: 0.5 }}>
            {g.members.map((n) => {
              const e = config.extensions.find((x) => x.number === n)
              return (
                <Tooltip key={n} title={`${n} ${e?.name ?? ''}`}>
                  <Box sx={{ ml: -0.75, border: 2, borderColor: 'background.paper', borderRadius: '50%' }}>
                    <Initials name={e?.name || n} size={30} />
                  </Box>
                </Tooltip>
              )
            })}
            <Typography variant="body2" sx={{ ml: 1, color: 'text.secondary' }}>
              {g.members.length ? `${g.members.length} ${g.members.length === 1 ? 'Mitglied' : 'Mitglieder'}` : 'Noch keine Mitglieder'}
            </Typography>
          </Stack>
          <Typography variant="body2">
            <b>Niemand nimmt ab:</b> {describeDestination(g.fallback, config)}
          </Typography>
        </Box>
      )}
      Form={GroupForm}
    />
  )
}
