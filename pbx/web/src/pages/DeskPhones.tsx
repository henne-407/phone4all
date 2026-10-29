/** Tischtelefone: Yealink und Snom holen SIP-Konto, Telefonbuch und Funktionstasten von der Anlage. */

import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import DeskIcon from '@mui/icons-material/LocalPhone'
import DownloadIcon from '@mui/icons-material/Download'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import type { DeskKey, DeskKeyType, DeskPhone, DeskVendor } from '../../../server/model'
import { api } from '../api'
import { CollectionPage, ConfirmDialog, FormGrid, FormHeading, Full, Select, StatusDot } from '../components/common'
import { usePbx } from '../state'
import { useStatus } from '../useStatus'
import { CopyField } from './Dect'

interface DeskInfo {
  host: string
  phones: { id: string; url: string; seen: { time: number; ip: string; agent: string; mac: string } | null }[]
}

const VENDORS: [DeskVendor, string][] = [
  ['yealink', 'Yealink (T3x, T4x, T5x)'],
  ['snom', 'Snom (D1xx, D3xx, D7xx)'],
]

const KEY_TYPES: [DeskKeyType, string][] = [
  ['blf', 'Nebenstelle (Besetztlampe)'],
  ['speed', 'Kurzwahl'],
  ['park', 'Parkplatz'],
  ['dnd', 'Nicht stören'],
  ['none', 'Leer'],
]

const formatMac = (mac: string): string => mac.toUpperCase().match(/.{1,2}/g)?.join(':') ?? ''

function ago(time: number): string {
  const min = Math.round((Date.now() - time) / 60000)
  if (min < 1) return 'gerade eben'
  if (min < 60) return `vor ${min} Min.`
  const h = Math.round(min / 60)
  return h < 24 ? `vor ${h} Std.` : new Date(time).toLocaleString('de-DE')
}

function KeyRow({ value, onChange, onRemove, index }: { value: DeskKey; onChange: (k: DeskKey) => void; onRemove: () => void; index: number }) {
  const { config } = usePbx()
  const first = Number(config.parking.number) + 1
  const slots = config.parking.enabled ? Array.from({ length: config.parking.slots }, (_, i) => String(first + i)) : []
  const needsValue = value.type === 'blf' || value.type === 'speed' || value.type === 'park'
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, alignItems: { sm: 'center' } }}>
      <Typography sx={{ width: 60, flexShrink: 0, color: 'text.secondary' }}>Taste {index + 1}</Typography>
      <Box sx={{ flex: 1, display: 'grid' }}>
        <Select label="Art" value={value.type} onChange={(type) => onChange({ ...value, type, value: type === value.type ? value.value : '' })} options={KEY_TYPES} />
      </Box>
      <Box sx={{ flex: 1, display: 'grid' }}>
        {value.type === 'blf' ? (
          <Select label="Nebenstelle" value={value.value} onChange={(v) => onChange({ ...value, value: v })} options={[['', '–'], ...config.extensions.map((e): [string, string] => [e.number, `${e.number} · ${e.name}`])]} />
        ) : value.type === 'park' ? (
          <Select label="Parkplatz" value={value.value} onChange={(v) => onChange({ ...value, value: v })} options={[['', '–'], ...slots.map((s): [string, string] => [s, s])]} />
        ) : (
          <TextField label="Nummer" value={value.value} disabled={!needsValue} onChange={(e) => onChange({ ...value, value: e.target.value })} />
        )}
      </Box>
      <Box sx={{ flex: 1, display: 'grid' }}>
        <TextField label="Beschriftung" value={value.label} disabled={value.type === 'none'} onChange={(e) => onChange({ ...value, label: e.target.value })} placeholder="automatisch" />
      </Box>
      <Tooltip title="Entfernen">
        <IconButton aria-label="Entfernen" onClick={onRemove}>
          <CloseIcon />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}

function PhoneForm({ value, onChange }: { value: DeskPhone; onChange: (v: DeskPhone) => void }) {
  const { config } = usePbx()
  const set = <K extends keyof DeskPhone>(k: K, v: DeskPhone[K]): void => onChange({ ...value, [k]: v })
  const setKey = (i: number, k: DeskKey): void => set('keys', value.keys.map((x, j) => (j === i ? k : x)))
  return (
    <FormGrid>
      <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required autoFocus helperText="z. B. „Empfang“" />
      <Select label="Hersteller" value={value.vendor} onChange={(v) => set('vendor', v)} options={VENDORS} />
      <TextField
        label="MAC-Adresse"
        value={value.mac.length === 12 ? formatMac(value.mac) : value.mac}
        onChange={(e) => set('mac', e.target.value.replace(/[\s:.-]/g, '').toLowerCase())}
        required
        helperText="Steht auf der Unterseite des Telefons"
      />
      <Select
        label="Nebenstelle"
        value={value.extension}
        onChange={(v) => set('extension', v)}
        options={[['', '–'], ...config.extensions.map((e): [string, string] => [e.number, `${e.number} · ${e.name}`])]}
      />
      <Full>
        <FormHeading hint="Besetztlampen zeigen, wer gerade telefoniert; ein Druck ruft an, bei Klingeln holt er den Anruf heran.">Funktionstasten</FormHeading>
        <Stack sx={{ gap: 1.5 }}>
          {value.keys.map((k, i) => (
            <KeyRow key={i} index={i} value={k} onChange={(n) => setKey(i, n)} onRemove={() => set('keys', value.keys.filter((_, j) => j !== i))} />
          ))}
        </Stack>
        <Button startIcon={<AddIcon />} sx={{ mt: 1.5 }} onClick={() => set('keys', [...value.keys, { type: 'blf', value: '', label: '' }])}>
          Taste hinzufügen
        </Button>
      </Full>
      <Full>
        <FormHeading hint="Setzt beim nächsten Abruf das Passwort für die Weboberfläche des Telefons (Benutzer admin). Leer lassen, um nichts zu ändern.">Zugang zum Telefon</FormHeading>
        <TextField type="password" label="Neues Passwort des Telefons" value={value.admin_password} onChange={(e) => set('admin_password', e.target.value)} autoComplete="new-password" fullWidth />
      </Full>
    </FormGrid>
  )
}

function SetupDialog({ phone, info, onClose }: { phone: DeskPhone; info: DeskInfo; onClose: () => void }) {
  const { config, reload, toast } = usePbx()
  const [confirm, setConfirm] = useState(false)
  const url = info.phones.find((p) => p.id === phone.id)?.url ?? ''
  const yealink = phone.vendor === 'yealink'
  const renew = (): void =>
    void api
      .post(`/api/deskphones/${phone.id}/renew`)
      .then(reload)
      .then(() => toast('Neuer Link erzeugt'))
      .catch((e: Error) => toast(e.message, 'error'))
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{phone.name} einrichten</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2.5, pt: 1 }}>
          <Box>
            <FormHeading hint="Die Adresse des Telefons zeigt es selbst (OK-Taste bzw. Menü → Status) oder der Router unter den Netzwerkgeräten.">
              1. Weboberfläche des Telefons öffnen
            </FormHeading>
            <Typography variant="body2">
              {yealink ? (
                <>
                  Anmeldung mit admin (ab Werk Passwort admin). Unter <b>Einstellungen → Auto Provision</b> die Adresse als <b>Server URL</b> eintragen, speichern und{' '}
                  <b>Autoprovision Now</b> wählen.
                </>
              ) : (
                <>
                  Unter <b>Erweitert → Update</b> die Adresse mit angehängtem <code>snom.xml</code> als <b>Setting URL</b> eintragen, „Update Policy“ auf „Update automatically“
                  stellen, speichern und das Telefon neu starten.
                </>
              )}
            </Typography>
          </Box>
          <CopyField
            label={yealink ? 'Server URL' : 'Setting URL'}
            value={yealink ? url : `${url}snom.xml`}
            helperText={
              config.system.sip_host
                ? 'Mit der Adresse aus System → Allgemein.'
                : 'Das Telefon muss die Anlage unter dieser Adresse erreichen. Sonst unter System → Allgemein die Adresse der Anlage im LAN eintragen.'
            }
          />
          <Alert severity="info" variant="outlined">
            Viele Telefone auf einmal: Im Router (DHCP-Option 66) die Adresse eintragen – dann richten sich neue Telefone nach dem Einstecken selbst ein. Jedes Telefon bekommt nur
            seine eigene Einrichtung (geprüft über die MAC-Adresse).
          </Alert>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Das Telefon holt die Einrichtung danach jeden Tag neu; Änderungen hier sind spätestens am nächsten Morgen da (oder sofort nach einem Neustart des Telefons).
            {config.ldap.enabled ? ' Das zentrale Telefonbuch (LDAP) ist eingetragen.' : ''}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => setConfirm(true)} sx={{ mr: 'auto' }}>
          Neuen Link erzeugen
        </Button>
        <Button startIcon={<DownloadIcon />} href={`/api/deskphones/${phone.id}/file`}>
          Datei herunterladen
        </Button>
        <Button variant="contained" onClick={onClose}>
          Fertig
        </Button>
      </DialogActions>
      <ConfirmDialog
        open={confirm}
        title="Neuen Link erzeugen?"
        text="Der bisherige Link wird ungültig und muss im Telefon neu eingetragen werden."
        confirm="Erzeugen"
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          renew()
        }}
      />
    </Dialog>
  )
}

export default function DeskPhones() {
  const { config } = usePbx()
  const [status] = useStatus(10000)
  const [info, setInfo] = useState<DeskInfo | null>(null)
  const [setup, setSetup] = useState<DeskPhone | null>(null)
  const deps = config.deskphones.map((d) => d.id + d.token).join()
  useEffect(() => void api.get<DeskInfo>('/api/deskphones').then(setInfo).catch(() => undefined), [deps])
  const online = (n: string): boolean => (status?.endpoints.find((e) => e.number === n)?.contacts.length ?? 0) > 0
  return (
    <>
      <CollectionPage<DeskPhone>
        kind="deskphones"
        overline="Personen"
        title="Tischtelefone"
        singular="Tischtelefon"
        description="Yealink- und Snom-Telefone holen sich ihre Einrichtung von der Anlage: SIP-Konto, deutsche Sprache und Zeit, Telefonbuch und Funktionstasten mit Besetztanzeige. Durchsagen nehmen sie selbst an."
        newItem={() => ({ keys: [] })}
        emptyText="Nach dem Anlegen zeigt „Einrichten“, was im Telefon einzutragen ist."
        emptyIcon={<DeskIcon />}
        columns={[
          { label: 'Name', render: (d) => <b>{d.name}</b> },
          { label: 'Nebenstelle', render: (d) => `${d.extension} ${config.extensions.find((e) => e.number === d.extension)?.name ?? ''}` },
          { label: 'Telefon', render: (d) => info?.phones.find((p) => p.id === d.id)?.seen?.agent || VENDORS.find(([v]) => v === d.vendor)?.[1].split(' ')[0], hideOnMobile: true },
          {
            label: 'Abgerufen',
            render: (d) => {
              const seen = info?.phones.find((p) => p.id === d.id)?.seen
              return seen ? ago(seen.time) : 'noch nicht'
            },
            hideOnMobile: true,
          },
          { label: 'Angemeldet', render: (d) => <StatusDot color={online(d.extension) ? 'success' : 'default'} label={online(d.extension) ? 'ja' : 'nein'} /> },
        ]}
        extraActions={(d) => (
          <Button size="small" variant="outlined" disabled={!info} onClick={() => setSetup(d)}>
            Einrichten
          </Button>
        )}
        Form={PhoneForm}
      />
      {setup && info && <SetupDialog phone={config.deskphones.find((d) => d.id === setup.id) ?? setup} info={info} onClose={() => setSetup(null)} />}
    </>
  )
}
