/** Weitere Tabs unter System: Funktionen (Parken, Notrufe), externe Sicherung, Webhooks und Anruf-Schnittstelle */

import AddIcon from '@mui/icons-material/Add'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import RestoreIcon from '@mui/icons-material/Restore'
import SendIcon from '@mui/icons-material/Send'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  FormGroup,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { type EmergencySettings, type OffsiteSettings, type ParkingSettings, WEBHOOK_EVENTS, type Webhook } from '../../../server/model'
import { api } from '../api'
import { ChangesBar, ChipsInput, ConfirmDialog, FormGrid, Full, NumberField, Section, Select, useDraft, useEditor } from '../components/common'
import { usePbx } from '../state'

// -- Funktionen: Parken und Notrufe -----------------------------------------------------

export function Features() {
  const { config, saveSection } = usePbx()
  const parking = useDraft<ParkingSettings>(config.parking)
  const emergency = useDraft<EmergencySettings>(config.emergency)
  const p = parking.draft
  const first = Number(p.number) + 1
  const extOptions = config.extensions.map((e) => e.number)
  const name = (n: string): string => config.extensions.find((e) => e.number === n)?.name ?? ''
  return (
    <>
      <Section
        title="Gespräche parken"
        description="Ein Gespräch auf einem Parkplatz ablegen und an einem anderen Telefon wieder aufnehmen – z. B. „Anruf für dich auf 701“. Weiterleiten an die Parknummer parkt; die Apps zeigen geparkte Gespräche an."
      >
        <FormGrid>
          <Full>
            <FormControlLabel control={<Switch checked={p.enabled} onChange={(e) => parking.set({ enabled: e.target.checked })} />} label="Parken einschalten" />
          </Full>
          {p.enabled && (
            <>
              <TextField label="Parknummer" value={p.number} onChange={(e) => parking.set({ number: e.target.value.replace(/\D/g, '') })} helperText={`Parkplätze: ${first} bis ${first + p.slots - 1}`} />
              <NumberField label="Anzahl Parkplätze" value={p.slots} onChange={(v) => parking.set({ slots: v })} min={1} />
              <NumberField label="Zurück nach (Sekunden)" value={p.seconds} onChange={(v) => parking.set({ seconds: v })} min={15} helperText="Holt niemand das Gespräch ab, klingelt es wieder bei dem, der geparkt hat" />
            </>
          )}
        </FormGrid>
      </Section>
      <ChangesBar dirty={parking.dirty} onApply={() => saveSection('parking', p)} onDiscard={parking.reset} text="Parken: ungespeicherte Änderungen" />
      <Section
        title="Benachrichtigung bei Notrufen"
        description="Wählt jemand 110 oder 112, erfahren es die hier eingetragenen Personen sofort – z. B. damit jemand die Rettungskräfte am Eingang empfängt. Der Notruf selbst geht wie immer ohne Verzögerung raus."
      >
        <FormGrid>
          <TextField
            label="E-Mail an"
            value={emergency.draft.notify_email}
            onChange={(e) => emergency.set({ notify_email: e.target.value })}
            helperText={config.mail.host ? 'Mehrere Adressen mit Komma trennen' : 'Dafür zuerst den E-Mail-Versand einrichten'}
          />
          <ChipsInput
            label="Messenger-Nachricht an Nebenstellen"
            value={emergency.draft.notify_exts}
            onChange={(v) => emergency.set({ notify_exts: v.map((x) => x.replace(/\s.*$/, '')) })}
            options={extOptions}
            helperText={emergency.draft.notify_exts.map((n) => [n, name(n)].filter(Boolean).join(' ')).join(', ') || 'Nur Nebenstellen mit Messenger'}
          />
        </FormGrid>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Außerdem erscheint der Notruf in Home Assistant (Ereignis <code>phone4all_emergency_call</code>) und bei Webhooks.
        </Typography>
      </Section>
      <ChangesBar dirty={emergency.dirty} onApply={() => saveSection('emergency', emergency.draft)} onDiscard={emergency.reset} text="Notrufe: ungespeicherte Änderungen" />
    </>
  )
}

// -- Externe Sicherung ------------------------------------------------------------------

interface OffsiteStatus {
  time: number
  ok: boolean
  file: string
  error: string
}

export function Offsite() {
  const { config, saveSection, toast, reload } = usePbx()
  const d = useDraft<OffsiteSettings>(config.offsite)
  const o = d.draft
  const [status, setStatus] = useState<OffsiteStatus | null>(null)
  const [files, setFiles] = useState<{ name: string; size: number }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [restore, setRestore] = useState<string | null>(null)
  useEffect(() => void api.get<OffsiteStatus>('/api/offsite').then(setStatus), [])
  const run = (): void => {
    setBusy(true)
    void api
      .post<OffsiteStatus>('/api/offsite/run')
      .then((s) => {
        setStatus(s)
        toast(s.ok ? `Gesichert: ${s.file}` : s.error, s.ok ? 'success' : 'error')
      })
      .catch((e: Error) => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }
  const list = (): void => {
    setBusy(true)
    void api
      .get<{ name: string; size: number }[]>('/api/offsite/files')
      .then(setFiles)
      .catch((e: Error) => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }
  const s3 = o.type === 's3'
  return (
    <Section
      title="Sicherung auf anderem Speicher"
      description="Die tägliche Sicherung zusätzlich auf eine Nextcloud, ein NAS (WebDAV) oder einen S3-Speicher kopieren. Geht die Anlage kaputt oder verloren, ist die Einrichtung nicht weg."
    >
      <FormGrid>
        <Full>
          <FormControlLabel control={<Switch checked={o.enabled} onChange={(e) => d.set({ enabled: e.target.checked })} />} label="Täglich extern sichern" />
        </Full>
        {o.enabled && (
          <>
            <Select
              label="Speicher"
              value={o.type}
              onChange={(v) => d.set({ type: v })}
              options={[
                ['webdav', 'WebDAV (Nextcloud, NAS, …)'],
                ['s3', 'S3 (Amazon, MinIO, Hetzner, …)'],
              ]}
            />
            <TextField
              label={s3 ? 'Adresse des Dienstes' : 'Adresse'}
              value={o.url}
              onChange={(e) => d.set({ url: e.target.value.trim() })}
              helperText={s3 ? 'z. B. https://s3.eu-central-1.amazonaws.com' : 'z. B. https://cloud.example.de/remote.php/dav/files/anna/'}
            />
            <TextField label={s3 ? 'Access Key' : 'Benutzer'} value={o.user} onChange={(e) => d.set({ user: e.target.value.trim() })} />
            <TextField label={s3 ? 'Secret Key' : 'Passwort'} type="password" value={o.password} onChange={(e) => d.set({ password: e.target.value })} helperText={s3 ? '' : 'Bei Nextcloud am besten ein App-Passwort'} />
            {s3 && (
              <>
                <TextField label="Bucket" value={o.bucket} onChange={(e) => d.set({ bucket: e.target.value.trim() })} />
                <TextField label="Region" value={o.region} onChange={(e) => d.set({ region: e.target.value.trim() })} helperText="Leer = us-east-1" />
              </>
            )}
            <TextField label="Ordner" value={o.folder} onChange={(e) => d.set({ folder: e.target.value.trim() })} helperText="Wird angelegt, falls er fehlt" />
            <NumberField label="Sicherungen behalten" value={o.keep} onChange={(v) => d.set({ keep: v })} min={1} />
            <Full>
              <TextField
                fullWidth
                label="Verschlüsseln mit Kennwort"
                type="password"
                value={o.passphrase}
                onChange={(e) => d.set({ passphrase: e.target.value })}
                helperText="Pflicht, mindestens 10 Zeichen: Die Sicherung enthält alle Passwörter der Anlage. Ohne dieses Kennwort lässt sie sich nicht wiederherstellen – gut aufheben!"
              />
            </Full>
          </>
        )}
      </FormGrid>
      {o.enabled && !o.passphrase && (
        <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
          Ohne Kennwort läuft die externe Sicherung nicht, sonst lägen die Passwörter der SIP-Konten und Nebenstellen lesbar auf dem fremden Speicher.
        </Alert>
      )}
      {config.offsite.enabled && (
        <>
          {status?.time ? (
            <Alert severity={status.ok ? 'success' : 'error'} sx={{ mb: 2 }}>
              {status.ok ? `Zuletzt gesichert ${new Date(status.time).toLocaleString('de-DE')}: ${status.file}` : `Fehlgeschlagen ${new Date(status.time).toLocaleString('de-DE')}: ${status.error}`}
            </Alert>
          ) : null}
          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
            <Button variant="outlined" startIcon={<CloudUploadIcon />} disabled={busy || d.dirty} onClick={run}>
              Jetzt extern sichern
            </Button>
            <Button disabled={busy || d.dirty} onClick={list}>
              Gesicherte Dateien anzeigen
            </Button>
          </Stack>
          {files && (
            <List dense>
              {files.map((f) => (
                <ListItem
                  key={f.name}
                  secondaryAction={
                    <Tooltip title="Wiederherstellen">
                      <IconButton onClick={() => setRestore(f.name)}>
                        <RestoreIcon />
                      </IconButton>
                    </Tooltip>
                  }
                >
                  <ListItemText primary={f.name} secondary={`${Math.round(f.size / 1024)} KB`} />
                </ListItem>
              ))}
              {!files.length && <Typography sx={{ color: 'text.secondary', mt: 1 }}>Noch keine Sicherungen am Ziel.</Typography>}
            </List>
          )}
        </>
      )}
      <ChangesBar dirty={d.dirty} onApply={() => saveSection('offsite', o)} onDiscard={d.reset} />
      <ConfirmDialog
        open={Boolean(restore)}
        title="Externe Sicherung wiederherstellen?"
        text="Die aktuelle Einrichtung wird ersetzt (und vorher lokal gesichert)."
        confirm="Wiederherstellen"
        onClose={() => setRestore(null)}
        onConfirm={() => {
          const name = restore
          setRestore(null)
          void api
            .post('/api/offsite/restore', { name })
            .then(reload)
            .then(() => toast('Wiederhergestellt'))
            .catch((e: Error) => toast(e.message, 'error'))
        }}
      />
    </Section>
  )
}

// -- Webhooks und Anruf-Schnittstelle ---------------------------------------------------

function WebhookForm({ value, onChange }: { value: Webhook; onChange: (v: Webhook) => void }) {
  const set = <K extends keyof Webhook>(k: K, v: Webhook[K]): void => onChange({ ...value, [k]: v })
  return (
    <FormGrid>
      <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required autoFocus helperText="z. B. „CRM“, „n8n“" />
      <FormControlLabel control={<Switch checked={value.enabled} onChange={(e) => set('enabled', e.target.checked)} />} label="Aktiv" />
      <Full>
        <TextField fullWidth label="Adresse" value={value.url} onChange={(e) => set('url', e.target.value.trim())} required helperText="Die Anlage schickt jedes Ereignis als JSON per POST an diese Adresse." />
      </Full>
      <Full>
        <Typography variant="subtitle2">Ereignisse (keins gewählt = alle)</Typography>
        <FormGroup row>
          {WEBHOOK_EVENTS.map(([key, label]) => (
            <FormControlLabel
              key={key}
              control={<Checkbox checked={value.events.includes(key)} onChange={(e) => set('events', e.target.checked ? [...value.events, key] : value.events.filter((x) => x !== key))} />}
              label={label}
            />
          ))}
        </FormGroup>
      </Full>
      {value.secret && (
        <Full>
          <TextField
            fullWidth
            label="Schlüssel für die Signatur"
            value={value.secret}
            slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace' } } }}
            onFocus={(e) => e.target.select()}
            helperText="Kopfzeile X-Phone4all-Signature: sha256=HMAC-SHA256(Schlüssel, Body) – damit prüft der Empfänger, dass die Nachricht von der Anlage kommt."
          />
        </Full>
      )}
    </FormGrid>
  )
}

interface WebhookStatus {
  time: number
  ok: boolean
  result: string
}

export function Webhooks() {
  const { config, toast } = usePbx()
  const editor = useEditor<Webhook>('webhooks', 'Webhook', WebhookForm, () => ({ enabled: true }))
  const [status, setStatus] = useState<Record<string, WebhookStatus>>({})
  const load = (): void => void api.get<{ status: Record<string, WebhookStatus> }>('/api/webhooks/status').then((r) => setStatus(r.status))
  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])
  const test = (id: string): void =>
    void api
      .post<WebhookStatus>(`/api/webhooks/${id}/test`)
      .then((s) => {
        toast(s.ok ? `Zugestellt (${s.result})` : `Fehler: ${s.result}`, s.ok ? 'success' : 'error')
        load()
      })
      .catch((e: Error) => toast(e.message, 'error'))
  const label = (key: string): string => WEBHOOK_EVENTS.find(([k]) => k === key)?.[1] ?? key
  return (
    <Section
      title="Webhooks"
      description="Anrufe, Voicemails, Sperren und Notrufe an andere Programme melden – z. B. an ein CRM, an n8n, Node-RED oder Zapier."
      action={
        <Button startIcon={<AddIcon />} onClick={() => editor.openNew()}>
          Webhook anlegen
        </Button>
      }
    >
      {config.webhooks.length ? (
        <List disablePadding>
          {config.webhooks.map((w) => {
            const s = status[w.id]
            return (
              <ListItem
                key={w.id}
                disablePadding
                secondaryAction={
                  <Tooltip title="Test senden">
                    <IconButton onClick={() => test(w.id)}>
                      <SendIcon />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemButton onClick={() => editor.openItem(w.id)}>
                  <ListItemText
                    primary={
                      <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span>{w.name}</span>
                        {!w.enabled && <Chip size="small" label="aus" />}
                        {s && <Chip size="small" variant="outlined" color={s.ok ? 'success' : 'error'} label={s.result} />}
                      </Stack>
                    }
                    secondary={`${w.url} · ${w.events.length ? w.events.map(label).join(', ') : 'alle Ereignisse'}`}
                  />
                </ListItemButton>
              </ListItem>
            )
          })}
        </List>
      ) : (
        <Typography sx={{ color: 'text.secondary' }}>Noch keine Webhooks.</Typography>
      )}
      <Box component="details" sx={{ mt: 2, color: 'text.secondary', fontSize: 14 }}>
        <summary>Beispiel einer Nachricht</summary>
        <Box component="pre" sx={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {`POST ${'<Adresse>'}
X-Phone4all-Event: call.ringing
X-Phone4all-Signature: sha256=…

{"event":"call.ringing","time":"2026-01-05T09:12:03.120Z","pbx":"${config.system.name}",
 "data":{"call":"1736068323.12","direction":"in","from":"+4930123456","from_name":"Anna Müller","extension":"10"}}`}
        </Box>
      </Box>
      {editor.dialog}
    </Section>
  )
}

export function CallApi() {
  const { config, saveSection, toast } = usePbx()
  const { enabled, call_api } = config.integration
  return (
    <Section
      title="Anrufe über die Schnittstelle"
      description="Andere Programme (CRM, Hausautomation, eigene Skripte) können einen Anruf auslösen: Erst klingelt das Telefon der Nebenstelle, nach dem Abheben wählt die Anlage die Nummer."
    >
      <FormControlLabel
        control={
          <Switch
            checked={call_api}
            disabled={!enabled}
            onChange={(e) =>
              void saveSection('integration', { call_api: e.target.checked })
                .then(() => toast('Gespeichert'))
                .catch((err: Error) => toast(err.message, 'error'))
            }
          />
        }
        label="Anrufe über die Schnittstelle erlauben"
      />
      {!enabled && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Dafür oben die Schnittstelle einschalten – sie nutzt denselben Zugriffsschlüssel.
        </Typography>
      )}
      {enabled && call_api && (
        <Box component="pre" sx={{ mt: 2, p: 2, bgcolor: 'background.default', borderRadius: 2, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {`curl -X POST ${window.location.origin}/api/integration/call \\
  -H "Authorization: Bearer <Zugriffsschlüssel>" \\
  -H "Content-Type: application/json" \\
  -d '{"extension":"10","number":"030123456"}'`}
        </Box>
      )}
    </Section>
  )
}
