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
import { type EmergencySettings, type OffsiteSettings, type ParkingSettings, type TranscriptionSettings, WEBHOOK_EVENTS, type Webhook } from '../../../server/model'
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
      <Transcription />
    </>
  )
}

interface TranscriptionInfo {
  binary: boolean
  models: string[]
  downloading: string
  error: string
  pending: number
  all: { id: string; name: string; size: number }[]
}

/** Voicemail als Text: whisper.cpp auf der Anlage oder eine OpenAI-kompatible Schnittstelle */
function Transcription() {
  const { config, saveSection, toast } = usePbx()
  const d = useDraft<TranscriptionSettings>(config.transcription)
  const t = d.draft
  const [info, setInfo] = useState<TranscriptionInfo | null>(null)
  const [test, setTest] = useState<{ busy: boolean; text?: string }>({ busy: false })
  const load = (): Promise<void> => api.get<TranscriptionInfo>('/api/transcription').then(setInfo)
  useEffect(() => void load().catch(() => undefined), [])
  // Während ein Modell lädt, den Stand abfragen
  useEffect(() => {
    if (!info?.downloading) return
    const timer = setInterval(() => void load().catch(() => undefined), 3000)
    return () => clearInterval(timer)
  }, [info?.downloading])
  const loaded = info?.models.includes(t.model)
  const runTest = (): void => {
    setTest({ busy: true })
    void api
      .post<{ text: string }>('/api/transcription/test', t)
      .then((r) => setTest({ busy: false, text: r.text || '(nichts erkannt)' }))
      .catch((e: Error) => {
        setTest({ busy: false })
        toast(e.message, 'error')
      })
  }
  return (
    <>
      <Section
        title="Voicemail als Text"
        description="Sprachnachrichten werden nach dem Aufsprechen in Text umgewandelt. Der Text steht in den Apps über der Nachricht und auf Wunsch in der Voicemail-E-Mail – so sieht man auf einen Blick, worum es geht."
      >
        <FormGrid>
          <Full>
            <FormControlLabel control={<Switch checked={t.enabled} onChange={(e) => d.set({ enabled: e.target.checked })} />} label="Voicemail als Text einschalten" />
          </Full>
          {t.enabled && (
            <>
              <Select
                label="Erkennung"
                value={t.engine}
                onChange={(v) => d.set({ engine: v })}
                options={[
                  ['local', 'Auf der Anlage (whisper.cpp, nichts verlässt das Haus)'],
                  ['api', 'Über eine Schnittstelle (OpenAI-kompatibel)'],
                ]}
              />
              {t.engine === 'local' ? (
                <Select
                  label="Sprachmodell"
                  value={t.model}
                  onChange={(v) => d.set({ model: v })}
                  options={info ? info.all.map((m) => [m.id, m.name] as [string, string]) : [[t.model, t.model]]}
                  helperText={
                    info?.downloading === t.model
                      ? 'Wird geladen …'
                      : loaded
                        ? 'Geladen'
                        : 'Wird beim Speichern aus dem Internet geladen (einmalig)'
                  }
                />
              ) : (
                <>
                  <TextField
                    label="Adresse"
                    value={t.api_url}
                    onChange={(e) => d.set({ api_url: e.target.value })}
                    helperText="Bis einschließlich /v1, z. B. http://speaches:8000/v1 oder https://api.openai.com/v1"
                  />
                  <TextField label="Modell" value={t.api_model} onChange={(e) => d.set({ api_model: e.target.value })} helperText="z. B. whisper-1 oder Systran/faster-whisper-small" />
                  <TextField label="API-Schlüssel" type="password" value={t.api_key} onChange={(e) => d.set({ api_key: e.target.value })} helperText="Leer lassen, wenn der Dienst keinen braucht" />
                </>
              )}
              <Full>
                <FormControlLabel
                  control={<Switch checked={t.email} onChange={(e) => d.set({ email: e.target.checked })} />}
                  label="Text in die Voicemail-E-Mail schreiben"
                />
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Die E-Mail kommt dann von der Anlage, sobald der Text fertig ist (meist nach wenigen Sekunden, auf einem Raspberry Pi bis etwa eine Minute).
                </Typography>
              </Full>
            </>
          )}
        </FormGrid>
        {t.engine === 'api' && t.enabled && /api\.openai\.com/i.test(t.api_url) && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Die Nachrichten werden dabei an OpenAI übertragen. Für Kundendaten besser die Erkennung auf der Anlage oder einen eigenen Server nutzen.
          </Alert>
        )}
        {info?.error && t.enabled && t.engine === 'local' && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {info.error}
          </Alert>
        )}
        {info && !info.binary && t.enabled && t.engine === 'local' && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            whisper.cpp ist in dieser Installation nicht vorhanden. Im Docker-Image ist es enthalten; sonst die Erkennung über eine Schnittstelle nutzen.
          </Alert>
        )}
        {t.enabled && (
          <Stack direction="row" spacing={2} sx={{ mt: 2, alignItems: 'center' }}>
            <Button variant="outlined" onClick={runTest} disabled={test.busy || (t.engine === 'local' && !loaded)}>
              {test.busy ? 'Wird erkannt …' : 'Probe'}
            </Button>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {test.text ? `Erkannt: „${test.text}“` : 'Spricht einen Satz mit der Sprachausgabe und wandelt ihn wieder in Text.'}
            </Typography>
          </Stack>
        )}
      </Section>
      <ChangesBar
        dirty={d.dirty}
        onApply={() => saveSection('transcription', t).then(() => void load().catch(() => undefined))}
        onDiscard={d.reset}
        text="Voicemail als Text: ungespeicherte Änderungen"
      />
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
                helperText="Empfohlen: Die Sicherung enthält alle Passwörter der Anlage. Ohne dieses Kennwort lässt sie sich nicht wiederherstellen – gut aufheben!"
              />
            </Full>
          </>
        )}
      </FormGrid>
      {o.enabled && !o.passphrase && (
        <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
          Ohne Kennwort liegen die Passwörter der SIP-Konten und Nebenstellen lesbar auf dem fremden Speicher.
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
  const { enabled, call_api, control } = config.integration
  const save = (patch: { call_api?: boolean; control?: boolean }): void =>
    void saveSection('integration', patch)
      .then(() => toast('Gespeichert'))
      .catch((err: Error) => toast(err.message, 'error'))
  return (
    <Section
      title="Anrufe und Schalten über die Schnittstelle"
      description="Andere Programme (CRM, Home Assistant, eigene Skripte) können einen Anruf auslösen – erst klingelt das Telefon der Nebenstelle, nach dem Abheben wählt die Anlage die Nummer – oder eine Ansage aus Text an eine Nebenstelle oder Gruppe schicken (z. B. „Der Wassermelder im Keller hat ausgelöst“). Mit „Schalten“ dürfen sie auch Nicht stören, Umleitungen und Zeitsteuerungen umstellen."
    >
      <FormControlLabel control={<Switch checked={call_api} disabled={!enabled} onChange={(e) => save({ call_api: e.target.checked })} />} label="Anrufe und Ansagen über die Schnittstelle erlauben" />
      <FormControlLabel control={<Switch checked={control} disabled={!enabled} onChange={(e) => save({ control: e.target.checked })} />} label="Schalten über die Schnittstelle erlauben (Nicht stören, Umleitung, Zeitsteuerung)" />
      {!enabled && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Dafür oben die Schnittstelle einschalten – sie nutzt denselben Zugriffsschlüssel.
        </Typography>
      )}
      {enabled && (call_api || control) && (
        <Box component="pre" sx={{ mt: 2, p: 2, bgcolor: 'background.default', borderRadius: 2, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {[
            call_api && `curl -X POST ${window.location.origin}/api/integration/call \\
  -H "Authorization: Bearer <Zugriffsschlüssel>" -H "Content-Type: application/json" \\
  -d '{"extension":"10","number":"030123456"}'`,
            call_api && `curl -X POST ${window.location.origin}/api/integration/announce … -d '{"target":"20","text":"Der Wassermelder hat ausgelöst"}'`,
            control && `curl -X POST ${window.location.origin}/api/integration/dnd … -d '{"extension":"10","enabled":true}'`,
            control && `curl -X POST ${window.location.origin}/api/integration/timecondition … -d '{"id":"<ID>","mode":"closed"}'`,
          ]
            .filter(Boolean)
            .join('\n\n')}
        </Box>
      )}
    </Section>
  )
}
