import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Chip,
  FormControlLabel,
  MenuItem,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useState } from 'react'
import type { NumberFormat, OutboundRoute, Trunk, Transport } from '../../../server/model'
import { ChipsInput, CollectionPage, DestinationPicker, FormGrid, Full, NumberField, Select, describeDestination } from '../components/common'
import { usePbx } from '../state'
import { useStatus } from '../useStatus'

const FORMATS: [NumberFormat, string][] = [
  ['e164', '+49301234567 (international mit +)'],
  ['e164_no_plus', '49301234567 (international ohne +)'],
  ['intl00', '0049301234567'],
  ['national', '0301234567 (national)'],
]

const TRANSPORTS: [Transport, string][] = [
  ['udp', 'UDP'],
  ['tcp', 'TCP'],
  ['tls', 'TLS (verschlüsselt)'],
]

const CODECS = ['opus', 'g722', 'alaw', 'ulaw', 'gsm']

const REG_LABEL: Record<string, [string, 'success' | 'error' | 'warning' | 'default']> = {
  Registered: ['Angemeldet', 'success'],
  Unregistered: ['Nicht angemeldet', 'warning'],
  Rejected: ['Abgelehnt', 'error'],
}

function TrunkForm({ value, onChange, isNew }: { value: Trunk; onChange: (v: Trunk) => void; isNew: boolean }) {
  const { providers } = usePbx()
  const set = <K extends keyof Trunk>(k: K, v: Trunk[K]): void => onChange({ ...value, [k]: v })
  const tpl = providers.find((p) => p.key === value.provider) ?? providers[providers.length - 1]
  const label = (field: keyof NonNullable<typeof tpl.labels>, fallback: string): string => tpl.labels?.[field] ?? fallback
  return (
    <Box>
      <FormGrid>
        <TextField
          select
          label="Anbieter"
          value={value.provider}
          onChange={(e) => {
            const p = providers.find((x) => x.key === e.target.value)!
            // Vorlage übernehmen; eingegebene Zugangsdaten bleiben erhalten
            onChange({ ...value, ...p.values, provider: p.key, name: value.name || p.name.split(' (')[0] } as Trunk)
          }}
        >
          {providers.map((p) => (
            <MenuItem key={p.key} value={p.key}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required />
        <Full>
          <Alert severity="info" variant="outlined">
            {tpl.help}
          </Alert>
        </Full>
        <TextField label={label('registrar', 'Server / Registrar')} value={value.registrar} onChange={(e) => set('registrar', e.target.value.trim())} required />
        <TextField label={label('outbound_proxy', 'Outbound-Proxy')} value={value.outbound_proxy} onChange={(e) => set('outbound_proxy', e.target.value.trim())} helperText="Meist leer" />
        <TextField label={label('username', 'Benutzername')} value={value.username} onChange={(e) => set('username', e.target.value.trim())} />
        <TextField label={label('auth_username', 'Anmeldename (falls abweichend)')} value={value.auth_username} onChange={(e) => set('auth_username', e.target.value.trim())} />
        <TextField
          label={label('password', 'Passwort')}
          type="password"
          value={value.password}
          onChange={(e) => set('password', e.target.value)}
          helperText={isNew ? undefined : 'Leer lassen = unverändert'}
        />
        <TextField label="Angezeigte Rufnummer" value={value.default_cid} onChange={(e) => set('default_cid', e.target.value)} helperText="Standard für Anrufe nach außen" />
        <Full>
          <ChipsInput label="Rufnummern dieses Kontos" value={value.numbers} onChange={(v) => set('numbers', v)} helperText="z. B. 030 123456 – Enter nach jeder Nummer. Für eingehende Rufnummern und die Absenderkennung." />
        </Full>
        <Full>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Eingehende Anrufe ohne eigene Regel
          </Typography>
          <DestinationPicker label="Weiter zu" value={value.inbound_default} onChange={(d) => set('inbound_default', d)} />
        </Full>
        <FormControlLabel control={<Switch checked={value.enabled} onChange={(e) => set('enabled', e.target.checked)} />} label="Aktiv" />
      </FormGrid>
      <Accordion disableGutters sx={{ bgcolor: 'transparent', '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
          <Typography variant="subtitle2">Erweitert</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0 }}>
          <FormGrid>
            <Select label="Transport" value={value.transport} onChange={(v) => set('transport', v)} options={TRANSPORTS} />
            <NumberField label="Port (0 = Standard)" value={value.port} onChange={(v) => set('port', v)} />
            <Select label="Rufnummernformat zum Anbieter" value={value.number_format} onChange={(v) => set('number_format', v)} options={FORMATS} />
            <Select
              label="Angerufene Nummer steht in"
              value={value.did_source}
              onChange={(v) => set('did_source', v)}
              options={[
                ['ruri', 'Request-URI (Standard)'],
                ['to', 'To-Kopfzeile'],
              ]}
            />
            <TextField label="From-Benutzer" value={value.from_user} onChange={(e) => set('from_user', e.target.value.trim())} helperText="Leer = Benutzername" />
            <TextField label="From-Domain" value={value.from_domain} onChange={(e) => set('from_domain', e.target.value.trim())} helperText="Leer = Server" />
            <Autocomplete
              multiple
              options={CODECS}
              value={value.codecs}
              onChange={(_e, v) => set('codecs', v)}
              renderInput={(p) => <TextField {...p} label="Codecs (Reihenfolge = Vorrang)" />}
            />
            <NumberField label="Gleichzeitige Gespräche (0 = unbegrenzt)" value={value.max_channels} onChange={(v) => set('max_channels', v)} />
            <FormControlLabel control={<Switch checked={value.register} onChange={(e) => set('register', e.target.checked)} />} label="Registrieren" />
            <FormControlLabel control={<Switch checked={value.ip_auth} onChange={(e) => set('ip_auth', e.target.checked)} />} label="Nur IP-Prüfung (fester SIP-Trunk)" />
            <FormControlLabel control={<Switch checked={value.srtp} onChange={(e) => set('srtp', e.target.checked)} />} label="Sprache verschlüsseln (SRTP)" />
            <FormControlLabel control={<Switch checked={value.forward_caller_id} onChange={(e) => set('forward_caller_id', e.target.checked)} />} label="Bei Weiterleitungen Anrufernummer zeigen (CLIP no screening)" />
            <Full>
              <TextField
                label="Zusätzliche PJSIP-Optionen"
                value={value.advanced}
                onChange={(e) => set('advanced', e.target.value)}
                multiline
                minRows={2}
                helperText="Eine Option je Zeile, z. B. „timers=no“ – nur wenn der Anbieter es verlangt"
                slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
              />
            </Full>
          </FormGrid>
        </AccordionDetails>
      </Accordion>
    </Box>
  )
}

function RouteForm({ value, onChange }: { value: OutboundRoute; onChange: (v: OutboundRoute) => void }) {
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

export default function Trunks() {
  const { config } = usePbx()
  const [tab, setTab] = useState(0)
  const [status] = useStatus(10000)
  return (
    <Box>
      <Tabs value={tab} onChange={(_e, v: number) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="SIP-Konten" />
        <Tab label="Wahlregeln" />
      </Tabs>
      {tab === 0 ? (
        <CollectionPage<Trunk>
          kind="trunks"
          title="SIP-Konten"
          singular="SIP-Konto"
          description="Verbindungen nach außen: Telefonanschluss, SIP-Trunk oder eine vorgeschaltete FRITZ!Box. Vorlagen für die gängigen Anbieter füllen Server und Formate vor."
          emptyText="Noch kein SIP-Konto. Ohne Konto telefoniert die Anlage nur intern."
          newItem={() => ({ provider: 'telekom', registrar: 'tel.t-online.de', number_format: 'e164', did_source: 'to', name: 'Telekom' })}
          columns={[
            { label: 'Name', render: (t) => <b>{t.name}</b> },
            { label: 'Server', hideOnMobile: true, render: (t) => t.registrar },
            { label: 'Rufnummern', hideOnMobile: true, render: (t) => t.numbers.join(', ') },
            {
              label: 'Status',
              render: (t) => {
                if (!t.enabled) return <Chip size="small" variant="outlined" label="Aus" />
                if (!t.register || t.ip_auth) return <Chip size="small" variant="outlined" label="Ohne Registrierung" />
                const s = status?.registrations.find((r) => r.trunk === t.id)?.status ?? ''
                const [text, color] = REG_LABEL[s] ?? [s || '…', 'default']
                return <Chip size="small" color={color} label={text} />
              },
            },
          ]}
          Form={TrunkForm}
        />
      ) : (
        <CollectionPage<OutboundRoute>
          kind="outbound"
          title="Wahlregeln"
          singular="Wahlregel"
          description="Welche Anrufe über welches SIP-Konto gehen. Die erste passende Regel gilt. Ohne Regeln nutzt die Anlage alle Konten der Reihe nach. Notrufe (110, 112) gehen immer raus."
          emptyText="Keine Regeln – alle Anrufe gehen über das erste erreichbare SIP-Konto."
          columns={[
            { label: 'Name', render: (r) => <b>{r.name}</b> },
            { label: 'Nummern', render: (r) => r.prefixes.join(', ') || 'alle' },
            { label: 'Über', render: (r) => r.trunks.map((id) => config.trunks.find((t) => t.id === id)?.name ?? '?').join(' → ') },
            { label: 'Für', hideOnMobile: true, render: (r) => r.extensions.join(', ') || 'alle' },
          ]}
          Form={RouteForm}
        />
      )}
      {tab === 0 && config.trunks.length > 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }}>
          Eingehende Anrufe ohne passende Regel gehen zu: {config.trunks.map((t) => `${t.name} → ${describeDestination(t.inbound_default, config)}`).join(' · ')}
        </Typography>
      )}
    </Box>
  )
}
