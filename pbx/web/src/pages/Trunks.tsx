import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import CallIcon from '@mui/icons-material/Call'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { NumberFormat, Trunk, Transport } from '../../../server/model'
import { CardGrid, ChipsInput, CollectionPage, DestinationPicker, FormGrid, FormHeading, Full, Initials, NumberField, Select, StatusDot, describeDestination } from '../components/common'
import { go } from '../router'
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

export const REG_LABEL: Record<string, [string, 'success' | 'error' | 'warning' | 'default']> = {
  Registered: ['Angemeldet', 'success'],
  Unregistered: ['Nicht angemeldet', 'warning'],
  Rejected: ['Abgelehnt', 'error'],
}

function ProviderTiles({ onPick }: { onPick: (key: string) => void }) {
  const { providers } = usePbx()
  return (
    <Box>
      <Typography variant="body1" sx={{ mb: 2 }}>
        Bei welchem Anbieter ist der Anschluss? Die Vorlage füllt Server und Rufnummernformat vor.
      </Typography>
      <CardGrid min={220}>
        {providers.map((p) => (
          <Card key={p.key}>
            <CardActionArea onClick={() => onPick(p.key)} sx={{ p: 2, height: '100%' }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
                <Initials name={p.name.split(' (')[0]} size={36} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600, lineHeight: 1.3 }}>{p.name.split(' (')[0]}</Typography>
                  {p.name.includes(' (') && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.3 }}>
                      {p.name.slice(p.name.indexOf('(') + 1, -1)}
                    </Typography>
                  )}
                </Box>
              </Stack>
            </CardActionArea>
          </Card>
        ))}
      </CardGrid>
    </Box>
  )
}

function TrunkForm({ value, onChange, isNew }: { value: Trunk; onChange: (v: Trunk) => void; isNew: boolean }) {
  const { providers } = usePbx()
  const set = <K extends keyof Trunk>(k: K, v: Trunk[K]): void => onChange({ ...value, [k]: v })
  if (!value.provider) {
    return (
      <ProviderTiles
        onPick={(key) => {
          const p = providers.find((x) => x.key === key)!
          onChange({ ...value, ...p.values, provider: p.key, name: p.name.split(' (')[0] } as Trunk)
        }}
      />
    )
  }
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
        <Select
          label="Angezeigte Rufnummer"
          value={value.numbers.includes(value.default_cid) || !value.default_cid ? value.default_cid : ''}
          onChange={(v) => set('default_cid', v)}
          options={[['', value.numbers[0] ? `Erste Nummer (${value.numbers[0]})` : 'Erste Nummer des Kontos'], ...value.numbers.map((n): [string, string] => [n, n])]}
          helperText="Standard für Anrufe nach außen; Nummern unten eintragen"
        />
        <Full>
          <ChipsInput label="Rufnummern dieses Kontos" value={value.numbers} onChange={(v) => set('numbers', v)} helperText="z. B. 030 123456 – Enter nach jeder Nummer. Für eingehende Rufnummern und die Absenderkennung." />
        </Full>
        <Full>
          <FormHeading hint="Für Nummern, denen unter „Rufabfolgen“ kein eigener Ablauf zugeordnet ist">Eingehende Anrufe</FormHeading>
          <DestinationPicker label="Gehen zu" value={value.inbound_default} onChange={(d) => set('inbound_default', d)} />
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

export default function Trunks() {
  const { config, providers } = usePbx()
  const [status] = useStatus(10000)
  const state = (t: Trunk): [string, 'success' | 'error' | 'warning' | 'default'] => {
    if (!t.enabled) return ['Ausgeschaltet', 'default']
    if (!t.register || t.ip_auth) return ['Ohne Registrierung', 'default']
    const s = status?.registrations.find((r) => r.trunk === t.id)?.status ?? ''
    return REG_LABEL[s] ?? [s || 'Wird geprüft …', 'default']
  }
  return (
    <CollectionPage<Trunk>
      kind="trunks"
      page="trunks"
      overline="Nach außen"
      title="SIP-Konten"
      singular="SIP-Konto"
      description="Die Verbindungen ins Telefonnetz: Telefonanschluss, SIP-Trunk oder eine vorgeschaltete FRITZ!Box. Jede Karte zeigt den Anmeldestatus, die Rufnummern und wohin Anrufe gehen."
      emptyText="Ohne SIP-Konto telefoniert die Anlage nur intern. Vorlagen für Telekom, Vodafone, 1&1, sipgate und weitere füllen alles Wichtige vor."
      emptyIcon={<CallIcon />}
      newItem={() => ({ provider: '' })}
      card={(t) => {
        const [text, color] = state(t)
        const routes = config.outbound.filter((r) => r.trunks.includes(t.id))
        return (
          <Box>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, mb: 2 }}>
              <Initials name={t.name} size={44} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h6" noWrap>
                  {t.name}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }} noWrap>
                  {providers.find((p) => p.key === t.provider)?.name.split(' (')[0] ?? 'Eigener Anbieter'} · {t.registrar}
                </Typography>
              </Box>
            </Stack>
            <StatusDot color={color} label={text} />
            <Typography variant="overline" sx={{ display: 'block', mt: 2, color: 'text.secondary' }}>
              Rufnummern
            </Typography>
            <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap' }}>
              {t.numbers.length ? t.numbers.map((n) => <Chip key={n} size="small" label={n} />) : <Typography variant="body2">keine eingetragen</Typography>}
            </Stack>
            <Typography variant="overline" sx={{ display: 'block', mt: 2, color: 'text.secondary' }}>
              Anrufe
            </Typography>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Eingehend
              </Typography>
              <ArrowForwardIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              <Typography variant="body2">{describeDestination(t.inbound_default, config)}</Typography>
            </Stack>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Ausgehend
              </Typography>
              <ArrowForwardIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              <Typography variant="body2">
                {!config.outbound.length ? 'für alle Anrufe' : routes.length ? routes.map((r) => r.name).join(', ') : 'keine Wahlregel nutzt dieses Konto'}
              </Typography>
            </Stack>
          </Box>
        )
      }}
      extraActions={() => (
        <Button size="small" onClick={() => go('flows')}>
          Rufabfolgen ansehen
        </Button>
      )}
      Form={TrunkForm}
    />
  )
}
