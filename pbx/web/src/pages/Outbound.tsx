/** Wahlregeln: welche Anrufe über welches SIP-Konto gehen, als Kette dargestellt. */

import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import EmergencyIcon from '@mui/icons-material/Emergency'
import { Alert, Autocomplete, Box, Chip, Stack, TextField, Typography } from '@mui/material'
import type { OutboundRoute } from '../../../server/model'
import { ChipsInput, CollectionPage, FormGrid, Full } from '../components/common'
import { usePbx } from '../state'

export function RouteForm({ value, onChange }: { value: OutboundRoute; onChange: (v: OutboundRoute) => void }) {
  const { config } = usePbx()
  const set = <K extends keyof OutboundRoute>(k: K, v: OutboundRoute[K]): void => onChange({ ...value, [k]: v })
  const trunkName = (id: string): string => config.trunks.find((t) => t.id === id)?.name ?? id
  return (
    <FormGrid>
      <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required autoFocus />
      <ChipsInput label="Gewählte Nummer beginnt mit" value={value.prefixes} onChange={(v) => set('prefixes', v)} helperText="z. B. 015, 016, 017 für Mobilfunk oder 00 für Ausland; leer = alle" options={['015', '016', '017', '00', '0800', '110', '112']} />
      <Full>
        <Autocomplete
          multiple
          options={config.trunks.map((t) => t.id)}
          value={value.trunks}
          onChange={(_e, v) => set('trunks', v)}
          getOptionLabel={trunkName}
          renderInput={(p) => <TextField {...p} label="Über SIP-Konten" helperText="Reihenfolge = Ausweichreihenfolge, wenn ein Konto nicht erreichbar ist" />}
        />
      </Full>
      <Full>
        <Autocomplete
          multiple
          options={config.extensions.map((e) => e.number)}
          value={value.extensions}
          onChange={(_e, v) => set('extensions', v)}
          getOptionLabel={(n) => `${n} – ${config.extensions.find((e) => e.number === n)?.name ?? ''}`}
          renderInput={(p) => <TextField {...p} label="Nur für Nebenstellen" helperText="Leer = für alle" />}
        />
      </Full>
    </FormGrid>
  )
}

function Chain({ route }: { route: OutboundRoute }) {
  const { config } = usePbx()
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      {route.trunks.map((id, i) => (
        <Stack key={id} direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          {i > 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              sonst
            </Typography>
          )}
          <Chip color={i === 0 ? 'primary' : 'default'} variant={i === 0 ? 'filled' : 'outlined'} label={config.trunks.find((t) => t.id === id)?.name ?? '?'} />
        </Stack>
      ))}
      {!route.trunks.length && <Chip color="error" label="kein Konto gewählt" />}
    </Stack>
  )
}

export default function Outbound() {
  const { config } = usePbx()
  return (
    <CollectionPage<OutboundRoute>
      kind="outbound"
      overline="Nach außen"
      title="Wahlregeln"
      singular="Wahlregel"
      description="Welche Anrufe über welches SIP-Konto gehen. Die Regeln werden von oben nach unten geprüft, die erste passende gilt. Fällt ein Konto aus, nimmt die Anlage das nächste der Kette."
      emptyText="Ohne Regeln gehen alle Anrufe über das erste erreichbare SIP-Konto."
      before={
        <Alert severity="info" icon={<EmergencyIcon />} sx={{ mb: 2 }}>
          Notrufe (110, 112) gehen immer raus – auch ohne passende Regel und mit jeder Berechtigung.
        </Alert>
      }
      card={(r) => (
        <Box>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            {config.outbound.indexOf(r) + 1}. {r.name}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
            {r.extensions.length ? `Für ${r.extensions.join(', ')}` : 'Für alle Nebenstellen'}
          </Typography>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
            {(r.prefixes.length ? r.prefixes : ['alle Nummern']).map((p) => (
              <Chip key={p} size="small" variant="outlined" label={p === 'alle Nummern' ? p : `${p}…`} sx={{ fontFamily: p === 'alle Nummern' ? undefined : 'monospace' }} />
            ))}
            <ArrowForwardIcon sx={{ color: 'text.secondary' }} />
          </Stack>
          <Chain route={r} />
        </Box>
      )}
      Form={RouteForm}
    />
  )
}
