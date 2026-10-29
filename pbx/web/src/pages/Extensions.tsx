import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import LogoutIcon from '@mui/icons-material/Logout'
import MailOutlineIcon from '@mui/icons-material/MailOutlined'
import PersonIcon from '@mui/icons-material/Person'
import RefreshIcon from '@mui/icons-material/Refresh'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import {
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import type { AppDevice, Extension, Permission } from '../../../server/model'
import { api } from '../api'
import { CollectionPage, ConfirmDialog, FormGrid, Full, Initials, NumberField, NumberPicker, Select, StatusDot, internalNumberOptions } from '../components/common'
import { ForwardRules } from '../components/ForwardRules'
import { usePbx } from '../state'
import { useStatus } from '../useStatus'

const PERMISSIONS: [Permission, string][] = [
  ['internal', 'Nur intern (und Notruf)'],
  ['national', 'Deutschland (Festnetz und Mobil)'],
  ['international', 'Weltweit'],
]

function nextNumber(list: Extension[]): string {
  const used = new Set(list.map((e) => Number(e.number)))
  let n = 10
  while (used.has(n)) n++
  return String(n)
}

function copy(text: string, toast: (t: string) => void): void {
  void navigator.clipboard.writeText(text).then(() => toast('Kopiert'))
}

type Device = Omit<AppDevice, 'token'>

interface ProvisioningInfo {
  setup: string
  app: string
  pin: string
  pin_expires: number
  link_expires: number
  base: string
  devices: Device[]
}

function when(ms: number): string {
  return ms ? new Date(ms).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : 'noch nie'
}

function Provisioning({ ext }: { ext: Extension }) {
  const { toast, reload } = usePbx()
  const [info, setInfo] = useState<ProvisioningInfo | null>(null)
  const [qr, setQr] = useState('')
  const [logout, setLogout] = useState<Device | 'all' | null>(null)
  const load = (): void => void api.get<ProvisioningInfo>(`/api/extensions/${ext.id}/provisioning`).then(setInfo)
  useEffect(load, [ext.id, ext.provision_token, ext.provision_pin, ext.provision_pin_expires])
  useEffect(() => {
    if (info) void QRCode.toDataURL(info.setup, { margin: 1, width: 360 }).then(setQr)
  }, [info])
  if (!info) return null
  const invite = async (): Promise<void> => {
    try {
      await api.post(`/api/extensions/${ext.id}/invite`)
      load()
      toast(`Einladung an ${ext.email} gesendet`)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const renewPin = async (): Promise<void> => {
    await api.post(`/api/extensions/${ext.id}/renew?what=pin`)
    await reload()
    toast('Neue PIN erstellt')
  }
  const renew = async (): Promise<void> => {
    await api.post(`/api/extensions/${ext.id}/renew?what=link`)
    await reload()
    toast('Neuer Link und neue PIN erstellt; der alte Link gilt nicht mehr. Eingerichtete Geräte bleiben angemeldet.')
  }
  const signOut = async (): Promise<void> => {
    const target = logout
    setLogout(null)
    if (!target) return
    try {
      if (target === 'all') await api.post(`/api/extensions/${ext.id}/renew?what=devices`)
      else await api.del(`/api/extensions/${ext.id}/devices/${target.id}`)
      load()
      toast(target === 'all' ? 'Alle Geräte abgemeldet' : `„${target.name}“ abgemeldet`)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
        Phone4All automatisch einrichten
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Den Link öffnen oder in der App unter Einstellungen → Konto → „Von Telefonanlage einrichten“ die Nebenstelle
        und die PIN eingeben. Im selben Netz findet die App die Anlage von selbst. Auf dem Handy den QR-Code mit der
        App scannen.
      </Typography>
      {qr && (
        <Box component="img" src={qr} alt="QR-Code zur Einrichtung" sx={{ width: 180, height: 180, borderRadius: 2, bgcolor: '#fff', mb: 2 }} />
      )}
      <FormGrid>
        <TextField
          label="Einrichtungslink"
          value={info.link_expires ? info.setup : 'abgelaufen'}
          error={!info.link_expires}
          helperText={
            info.link_expires
              ? `Gilt bis ${new Date(info.link_expires).toLocaleString('de-DE')}; jedes Gerät erhält einen eigenen Zugang`
              : 'Für weitere Geräte den Link erneuern oder eine Einladung senden'
          }
          slotProps={{
            input: {
              readOnly: true,
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton aria-label="Kopieren" onClick={() => copy(info.setup, toast)}>
                    <ContentCopyIcon />
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          label="Einrichtungs-PIN"
          value={info.pin_expires ? info.pin : 'abgelaufen oder benutzt'}
          error={!info.pin_expires}
          helperText={
            info.pin_expires
              ? `Gilt einmal, bis ${new Date(info.pin_expires).toLocaleString('de-DE')}`
              : 'Für ein weiteres Gerät eine neue PIN erstellen'
          }
          slotProps={{
            input: {
              readOnly: true,
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton aria-label="Neue PIN" onClick={() => void renewPin()}>
                    <RefreshIcon />
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
      </FormGrid>
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
        <Button variant="outlined" startIcon={<MailOutlineIcon />} disabled={!ext.email} onClick={() => void invite()}>
          Einladung per E-Mail
        </Button>
        <Button href={info.app} variant="outlined" disabled={!info.link_expires}>
          Hier in Phone4All öffnen
        </Button>
        <Button startIcon={<RefreshIcon />} onClick={() => void renew()}>
          Link erneuern
        </Button>
      </Stack>
      <Typography variant="subtitle1" sx={{ mt: 3, mb: 0.5 }}>
        Eingerichtete Geräte
      </Typography>
      {info.devices.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Noch keine App eingerichtet.
        </Typography>
      ) : (
        <List dense disablePadding>
          {info.devices.map((d) => (
            <ListItem
              key={d.id}
              disableGutters
              secondaryAction={
                <Tooltip title="Abmelden">
                  <IconButton edge="end" aria-label={`${d.name} abmelden`} onClick={() => setLogout(d)}>
                    <LogoutIcon />
                  </IconButton>
                </Tooltip>
              }
            >
              <ListItemText
                primary={d.name}
                secondary={`Eingerichtet ${when(d.created)} · zuletzt ${when(d.seen)}${d.ip ? ` von ${d.ip}` : ''}`}
              />
            </ListItem>
          ))}
        </List>
      )}
      {info.devices.length > 1 && (
        <Button color="error" startIcon={<LogoutIcon />} onClick={() => setLogout('all')} sx={{ mt: 1 }}>
          Alle Geräte abmelden
        </Button>
      )}
      <ConfirmDialog
        open={logout !== null}
        title={logout === 'all' ? 'Alle Geräte abmelden?' : `„${logout?.name ?? ''}“ abmelden?`}
        text="Die App kann danach weder Profil, Telefonbuch noch Chat abrufen und muss neu eingerichtet werden. Das SIP-Passwort bleibt; bei einem verlorenen Gerät zusätzlich das Passwort erneuern."
        confirm="Abmelden"
        onClose={() => setLogout(null)}
        onConfirm={() => void signOut()}
      />
    </Box>
  )
}

function ExtensionForm({ value, onChange, isNew }: { value: Extension; onChange: (v: Extension) => void; isNew: boolean }) {
  const { config } = usePbx()
  const [show, setShow] = useState(false)
  const set = <K extends keyof Extension>(k: K, v: Extension[K]): void => onChange({ ...value, [k]: v })
  const numbers = config.trunks.flatMap((t) => t.numbers)
  return (
    <Box>
      <FormGrid>
        <TextField label="Nebenstelle" value={value.number} onChange={(e) => set('number', e.target.value.replace(/\D/g, ''))} required autoFocus={isNew} helperText="2–6 Ziffern" />
        <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required />
        <TextField label="E-Mail-Adresse" type="email" value={value.email} onChange={(e) => set('email', e.target.value)} helperText="Für Voicemail-Nachrichten und die Einladung" />
        <TextField
          label="SIP-Passwort"
          type={show ? 'text' : 'password'}
          value={value.secret}
          onChange={(e) => set('secret', e.target.value)}
          helperText={isNew ? 'Leer lassen: wird sicher erzeugt' : 'Wird bei der App-Einrichtung automatisch übertragen'}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton aria-label="Anzeigen" onClick={() => setShow(!show)}>
                    {show ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
        <Select
          label="Rufnummer nach außen"
          value={value.outbound_cid}
          onChange={(v) => set('outbound_cid', v)}
          options={[
            ['', 'Standardnummer des SIP-Kontos'],
            ...config.trunks.flatMap((t) => t.numbers.map((n): [string, string] => [n, `${n} (${t.name})`])),
            ...(value.outbound_cid && !numbers.includes(value.outbound_cid) ? [[value.outbound_cid, `${value.outbound_cid} (in keinem SIP-Konto)`] as [string, string]] : []),
          ]}
          helperText="Anrufe nach außen gehen über das SIP-Konto dieser Nummer"
        />
        <Select label="Darf anrufen" value={value.permission} onChange={(v) => set('permission', v)} options={PERMISSIONS} />
        <Select
          label="App-Profil"
          value={value.app_profile}
          onChange={(v) => set('app_profile', v)}
          options={[['', 'Keine Vorgaben'], ...config.appprofiles.map((p): [string, string] => [p.id, p.name])]}
          helperText="Legt fest, welche Ansichten die Phone4All-App zeigt"
        />
        <NumberField label="Klingeldauer (Sekunden)" value={value.ring_seconds} onChange={(v) => set('ring_seconds', v)} min={5} />
        <NumberField label="Geräte gleichzeitig" value={value.max_devices} onChange={(v) => set('max_devices', v)} min={1} helperText="z. B. App am PC, Tischtelefon, Handy" />
      </FormGrid>
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Weiterleitung und Voicemail
      </Typography>
      <FormGrid>
        <NumberPicker
          label="Bei besetzt weiterleiten an"
          value={value.forward.busy}
          onChange={(v) => set('forward', { ...value.forward, busy: v })}
          options={internalNumberOptions(config).filter((o) => o.value !== value.number)}
          helperText="Auswählen oder externe Nummer eintippen; leer = Voicemail"
        />
        <NumberPicker
          label="Ohne Antwort weiterleiten an"
          value={value.forward.noanswer}
          onChange={(v) => set('forward', { ...value.forward, noanswer: v })}
          options={internalNumberOptions(config).filter((o) => o.value !== value.number)}
          helperText="Leer = Voicemail (wenn eingeschaltet)"
        />
        <Full>
          <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
            Automatisch umleiten
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
            Die erste greifende Regel leitet alle Anrufe um. Eine Sofort-Umleitung (*21 oder in der App) geht immer vor.
          </Typography>
          <ForwardRules
            value={value.forward.rules}
            onChange={(rules) => set('forward', { ...value.forward, rules })}
            targets={internalNumberOptions(config).filter((o) => o.value !== value.number)}
            timeconditions={config.timeconditions}
            calendars={config.calendars.filter((c) => c.kind !== 'holidays')}
          />
        </Full>
        <FormControlLabel control={<Switch checked={value.voicemail.enabled} onChange={(e) => set('voicemail', { ...value.voicemail, enabled: e.target.checked })} />} label="Voicemail" />
        <TextField label="Voicemail-PIN" value={value.voicemail.pin} onChange={(e) => set('voicemail', { ...value.voicemail, pin: e.target.value.replace(/\D/g, '') })} disabled={!value.voicemail.enabled} helperText="Abhören mit *97 (am eigenen Telefon ohne PIN)" />
        <FormControlLabel control={<Switch checked={value.voicemail.attach} disabled={!value.voicemail.enabled} onChange={(e) => set('voicemail', { ...value.voicemail, attach: e.target.checked })} />} label="Nachricht als Anhang per E-Mail" />
        <FormControlLabel control={<Switch checked={value.allow_premium} onChange={(e) => set('allow_premium', e.target.checked)} />} label="Sonderrufnummern erlauben (0900, 0137, 118 …)" />
        <Full>
          <FormControlLabel control={<Switch checked={value.record} onChange={(e) => set('record', e.target.checked)} />} label="Gespräche aufzeichnen" />
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', ml: 6 }}>
            Nur mit Einwilligung aller Gesprächspartner zulässig (§ 201 StGB, DSGVO).
          </Typography>
        </Full>
      </FormGrid>
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle1">Handy klingelt mit</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        Anrufe für diese Nebenstelle klingeln zusätzlich auf dem Handy, über das SIP-Konto nach außen. Mit Bestätigung nimmt
        man am Handy mit der Taste 1 an – so landet der Anrufer nicht auf der Mailbox des Handys. In der App lässt es sich
        ein- und ausschalten.
      </Typography>
      <FormGrid>
        <FormControlLabel control={<Switch checked={value.mobile.enabled} onChange={(e) => set('mobile', { ...value.mobile, enabled: e.target.checked })} />} label="Handy klingelt mit" />
        <TextField label="Handynummer" value={value.mobile.number} onChange={(e) => set('mobile', { ...value.mobile, number: e.target.value })} helperText="z. B. 0171 2345678" />
        <NumberField label="Erst nach (Sekunden)" value={value.mobile.delay} onChange={(v) => set('mobile', { ...value.mobile, delay: v })} helperText="0 = sofort; danach klingeln Telefone und Handy gleichzeitig" />
        <FormControlLabel control={<Switch checked={value.mobile.confirm} onChange={(e) => set('mobile', { ...value.mobile, confirm: e.target.checked })} />} label="Am Handy mit Taste 1 annehmen" />
      </FormGrid>
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle1">Türsprechstelle</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        Ist diese Nebenstelle eine Türsprechstelle (z. B. 2N, DoorBird, Akuvox), zeigen die Apps im Gespräch mit ihr den Knopf
        „Tür öffnen“. Er sendet die Tasten, die an der Türsprechstelle als Öffnungscode eingestellt sind.
      </Typography>
      <FormGrid>
        <FormControlLabel control={<Switch checked={value.door.enabled} onChange={(e) => set('door', { ...value.door, enabled: e.target.checked })} />} label="Ist eine Türsprechstelle" />
        <TextField label="Tasten zum Öffnen" value={value.door.dtmf} disabled={!value.door.enabled} onChange={(e) => set('door', { ...value.door, dtmf: e.target.value.replace(/[^0-9*#]/g, '') })} helperText="z. B. *9 oder 1234#" />
      </FormGrid>
      {!isNew && value.id && (
        <>
          <Divider sx={{ my: 2 }} />
          <Provisioning ext={value} />
        </>
      )}
    </Box>
  )
}

export default function Extensions() {
  const { config } = usePbx()
  const [status] = useStatus(10000)
  const online = (n: string): number => status?.endpoints.find((e) => e.number === n)?.contacts.filter((c) => c.status !== 'Unreachable').length ?? 0
  return (
    <CollectionPage<Extension>
      kind="extensions"
      overline="Personen"
      title="Nebenstellen"
      singular="Nebenstelle"
      description="Jede Person bekommt eine interne Rufnummer. Darauf können sich mehrere Geräte anmelden – die Phone4All-App, Tischtelefone oder Softphones."
      emptyText="Noch keine Nebenstellen. Lege die erste an, z. B. 10 für dich selbst."
      emptyIcon={<PersonIcon />}
      newItem={() => ({ number: nextNumber(config.extensions) })}
      columns={[
        { label: 'Nr.', render: (e) => <b>{e.number}</b> },
        {
          label: 'Name',
          render: (e) => (
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
              <Initials name={e.name || e.number} size={30} />
              {e.name}
            </Stack>
          ),
        },
        { label: 'E-Mail', render: (e) => e.email || '–', hideOnMobile: true },
        {
          label: 'Geräte',
          render: (e) => {
            const n = online(e.number)
            return (
              <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusDot color={n ? 'success' : 'default'} label={n ? `${n} angemeldet` : 'keins'} />
                {status?.dnd[e.number] && <Chip size="small" color="warning" label="Nicht stören" />}
                {status?.cfu[e.number] && <Chip size="small" color="info" label={`→ ${status.cfu[e.number]}`} />}
                {e.mobile.enabled && <Chip size="small" variant="outlined" label="+ Handy" />}
                {e.door.enabled && <Chip size="small" variant="outlined" label="Tür" />}
              </Stack>
            )
          },
        },
        { label: 'Darf anrufen', render: (e) => PERMISSIONS.find(([p]) => p === e.permission)?.[1], hideOnMobile: true },
        { label: 'Voicemail', render: (e) => (e.voicemail.enabled ? 'an' : 'aus'), hideOnMobile: true },
        {
          label: 'Gruppen',
          render: (e) =>
            config.groups
              .filter((g) => g.members.includes(e.number))
              .map((g) => g.name)
              .join(', ') || '–',
          hideOnMobile: true,
        },
        { label: 'App-Profil', render: (e) => config.appprofiles.find((p) => p.id === e.app_profile)?.name ?? '–', hideOnMobile: true },
      ]}
      card={(e) => {
        const n = online(e.number)
        const groups = config.groups.filter((g) => g.members.includes(e.number))
        const profile = config.appprofiles.find((p) => p.id === e.app_profile)
        return (
          <Box>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <Initials name={e.name || e.number} size={44} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h6" noWrap>
                  {e.name}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }} noWrap>
                  {e.email || 'keine E-Mail'}
                </Typography>
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 700, color: 'primary.main' }}>
                {e.number}
              </Typography>
            </Stack>
            <StatusDot color={n ? 'success' : 'default'} label={n ? `${n} ${n === 1 ? 'Gerät' : 'Geräte'} angemeldet` : 'Kein Gerät angemeldet'} />
            <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap', mt: 1.5 }}>
              {status?.dnd[e.number] && <Chip size="small" color="warning" label="Nicht stören" />}
              {status?.cfu[e.number] && <Chip size="small" color="info" label={`Umgeleitet → ${status.cfu[e.number]}`} />}
              {e.voicemail.enabled && <Chip size="small" variant="outlined" label="Voicemail" />}
              {groups.map((g) => (
                <Chip key={g.id} size="small" variant="outlined" label={g.name} />
              ))}
              {profile && <Chip size="small" variant="outlined" color="primary" label={`App: ${profile.name}`} />}
            </Stack>
          </Box>
        )
      }}
      extraActions={(e) =>
        status?.dnd[e.number] ? (
          <Tooltip title="Nicht stören ausschalten">
            <Button size="small" onClick={() => void api.put(`/api/state/${e.number}`, { dnd: false })}>
              Stören erlauben
            </Button>
          </Tooltip>
        ) : null
      }
      Form={ExtensionForm}
    />
  )
}
