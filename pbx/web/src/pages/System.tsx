import DownloadIcon from '@mui/icons-material/Download'
import RestoreIcon from '@mui/icons-material/Restore'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MailSettings, SecuritySettings, SystemSettings, UpdateSettings } from '../../../server/model'
import { type UpdateInfo, api } from '../api'
import { ChipsInput, ConfirmDialog, FormGrid, Full, NumberField, PageHeader, Section, Select } from '../components/common'
import { usePbx } from '../state'
import { useStatus } from '../useStatus'

function useDraft<T>(initial: T): [T, (patch: Partial<T>) => void, (v: T) => void] {
  const [draft, setDraft] = useState(initial)
  useEffect(() => setDraft(initial), [initial])
  return [draft, (patch) => setDraft((d) => ({ ...d, ...patch })), setDraft]
}

function SaveBar({ onSave }: { onSave: () => Promise<void> }) {
  const { toast } = usePbx()
  return (
    <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
      <Button
        variant="contained"
        onClick={() =>
          void onSave()
            .then(() => toast('Gespeichert'))
            .catch((e: Error) => toast(e.message, 'error'))
        }
      >
        Speichern
      </Button>
    </Stack>
  )
}

function General() {
  const { config, states, saveSection } = usePbx()
  const [s, set] = useDraft<SystemSettings>(config.system)
  return (
    <Section title="Allgemein">
      <FormGrid>
        <TextField label="Name der Anlage" value={s.name} onChange={(e) => set({ name: e.target.value })} />
        <TextField label="Adresse für Telefone" value={s.sip_host} onChange={(e) => set({ sip_host: e.target.value.trim() })} helperText="Leer = Adresse, unter der die Weboberfläche aufgerufen wird" />
        <TextField label="Ländervorwahl" value={s.country_code} onChange={(e) => set({ country_code: e.target.value.replace(/\D/g, '') })} />
        <TextField label="Ortsvorwahl ohne 0" value={s.area_code} onChange={(e) => set({ area_code: e.target.value.replace(/\D/g, '') })} helperText="Damit Ortsgespräche ohne Vorwahl gewählt werden können, z. B. 30" />
        <TextField select label="Bundesland (Feiertage)" value={s.state} onChange={(e) => set({ state: e.target.value })}>
          {Object.entries(states).map(([k, v]) => (
            <MenuItem key={k} value={k}>
              {v}
            </MenuItem>
          ))}
        </TextField>
        <TextField label="Zeitzone" value={s.timezone} onChange={(e) => set({ timezone: e.target.value })} />
      </FormGrid>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Netzwerk
      </Typography>
      <FormGrid>
        <NumberField label="SIP-Port" value={s.sip_port} onChange={(v) => set({ sip_port: v })} />
        <NumberField label="SIP-TLS-Port" value={s.tls_port} onChange={(v) => set({ tls_port: v })} />
        <NumberField label="RTP von" value={s.rtp_start} onChange={(v) => set({ rtp_start: v })} />
        <NumberField label="RTP bis" value={s.rtp_end} onChange={(v) => set({ rtp_end: v })} />
        <TextField label="Öffentliche Adresse (NAT)" value={s.external_address} onChange={(e) => set({ external_address: e.target.value.trim() })} helperText="Nur nötig, wenn Telefone von außen über den Router kommen" />
        <ChipsInput label="Lokale Netze" value={s.local_nets} onChange={(v) => set({ local_nets: v })} />
        <Full>
          <ChipsInput label="Codecs für Nebenstellen" value={s.codecs} onChange={(v) => set({ codecs: v })} options={['opus', 'g722', 'alaw', 'ulaw', 'gsm']} helperText="Reihenfolge = Vorrang. Opus und G.722 klingen deutlich besser (HD-Telefonie)." />
        </Full>
      </FormGrid>
      <SaveBar onSave={() => saveSection('system', s)} />
    </Section>
  )
}

function Mail() {
  const { config, saveSection, toast } = usePbx()
  const initial = useMemo(() => ({ ...config.mail, password: '' }), [config.mail])
  const [m, set] = useDraft<MailSettings>(initial)
  const [to, setTo] = useState('')
  return (
    <Section title="E-Mail" description="Für Voicemail-Nachrichten und Einladungen an neue Nebenstellen.">
      <FormGrid>
        <TextField label="SMTP-Server" value={m.host} onChange={(e) => set({ host: e.target.value.trim() })} />
        <NumberField label="Port" value={m.port} onChange={(v) => set({ port: v })} />
        <Select
          label="Verschlüsselung"
          value={m.tls}
          onChange={(v) => set({ tls: v })}
          options={[
            ['starttls', 'STARTTLS (Port 587)'],
            ['tls', 'SSL/TLS (Port 465)'],
            ['none', 'Keine'],
          ]}
        />
        <TextField label="Absender" value={m.from} onChange={(e) => set({ from: e.target.value.trim() })} helperText="z. B. telefon@firma.de" />
        <TextField label="Benutzer" value={m.user} onChange={(e) => set({ user: e.target.value.trim() })} />
        <TextField label="Passwort" type="password" value={m.password} onChange={(e) => set({ password: e.target.value })} helperText={config.mail.password ? 'Leer lassen = unverändert' : undefined} />
      </FormGrid>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2, alignItems: { sm: 'center' } }}>
        <TextField size="small" label="Test an" value={to} onChange={(e) => setTo(e.target.value)} sx={{ maxWidth: 320 }} />
        <Button
          onClick={() =>
            void api
              .post('/api/mail/test', { to })
              .then(() => toast('Test-E-Mail gesendet'))
              .catch((e: Error) => toast(e.message, 'error'))
          }
        >
          Test senden
        </Button>
        <Box sx={{ flex: 1 }} />
        <SaveBar onSave={() => saveSection('mail', m)} />
      </Stack>
    </Section>
  )
}

function Security() {
  const { config, saveSection } = usePbx()
  const [s, set] = useDraft<SecuritySettings>(config.security)
  const [status, refresh] = useStatus(10000)
  return (
    <>
      <Section title="Schutz vor Angriffen" description="SIP-Scanner probieren im Internet ständig Passwörter durch. Die Anlage sperrt Adressen nach mehreren Fehlversuchen.">
        <FormGrid columns={3}>
          <Full>
            <FormControlLabel control={<Switch checked={s.ban_enabled} onChange={(e) => set({ ban_enabled: e.target.checked })} />} label="Automatisch sperren" />
          </Full>
          <NumberField label="Nach Fehlversuchen" value={s.ban_after} onChange={(v) => set({ ban_after: v })} min={1} />
          <NumberField label="innerhalb (Minuten)" value={s.ban_window} onChange={(v) => set({ ban_window: v })} min={1} />
          <NumberField label="Sperrdauer (Minuten)" value={s.ban_minutes} onChange={(v) => set({ ban_minutes: v })} min={1} />
          <Full>
            <ChipsInput label="Nie sperren" value={s.whitelist} onChange={(v) => set({ whitelist: v })} helperText="IP-Adressen oder Netze wie 192.168.1.0/24" />
          </Full>
          <Full>
            <ChipsInput label="Nebenstellen nur aus diesen Netzen" value={s.extension_nets} onChange={(v) => set({ extension_nets: v })} helperText="Leer = von überall (z. B. Homeoffice). Mit 192.168.0.0/16 nur aus dem Büro-LAN." />
          </Full>
        </FormGrid>
        <SaveBar onSave={() => saveSection('security', s)} />
      </Section>
      <Section title="Gesperrte Adressen">
        {status?.bans.length ? (
          <List dense>
            {status.bans.map((b) => (
              <ListItem
                key={b.ip}
                secondaryAction={
                  <Button onClick={() => void api.post('/api/unban', { ip: b.ip }).then(refresh)}>Freigeben</Button>
                }
              >
                <ListItemText primary={b.ip} secondary={`${b.reason} · bis ${new Date(b.until).toLocaleString('de-DE')}`} />
              </ListItem>
            ))}
          </List>
        ) : (
          <Typography sx={{ color: 'text.secondary' }}>Keine.</Typography>
        )}
      </Section>
    </>
  )
}

function Backup() {
  const { toast, reload } = usePbx()
  const [secrets, setSecrets] = useState(true)
  const [files, setFiles] = useState(true)
  const [backups, setBackups] = useState<{ name: string; size: number; time: number }[]>([])
  const [restore, setRestore] = useState<string | null>(null)
  const [importData, setImportData] = useState<unknown>(null)
  const ref = useRef<HTMLInputElement>(null)
  const load = (): void => void api.get<typeof backups>('/api/backups').then(setBackups)
  useEffect(load, [])
  return (
    <>
      <Section title="Konfiguration exportieren" description="Die gesamte Einrichtung als Datei – zum Aufheben, für eine zweite Anlage oder den Umzug auf neue Hardware.">
        <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControlLabel control={<Checkbox checked={secrets} onChange={(e) => setSecrets(e.target.checked)} />} label="Mit Passwörtern" />
          <FormControlLabel control={<Checkbox checked={files} onChange={(e) => setFiles(e.target.checked)} />} label="Mit Ansagen und Wartemusik" />
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" startIcon={<DownloadIcon />} href={`/api/export?secrets=${secrets ? 1 : 0}&files=${files ? 1 : 0}`}>
            Exportieren
          </Button>
        </Stack>
        {secrets && (
          <Alert severity="warning" variant="outlined" sx={{ mt: 2 }}>
            Die Datei enthält dann alle Passwörter im Klartext – sicher aufbewahren.
          </Alert>
        )}
      </Section>
      <Section title="Konfiguration importieren" description="Ersetzt die aktuelle Einrichtung. Vorher wird automatisch gesichert. Fehlende Passwörter werden aus der aktuellen Einrichtung übernommen oder neu erzeugt.">
        <input
          ref={ref}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f)
              void f.text().then((t) => {
                try {
                  setImportData(JSON.parse(t))
                } catch {
                  toast('Die Datei ist kein gültiger Export.', 'error')
                }
              })
          }}
        />
        <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => ref.current?.click()}>
          Datei wählen …
        </Button>
      </Section>
      <Section title="Automatische Sicherungen" description="Täglich sowie vor jedem Import, jeder Wiederherstellung und jedem Update. Die letzten 30 bleiben erhalten.">
        <Button sx={{ mb: 1 }} onClick={() => void api.post('/api/backups').then(load)}>
          Jetzt sichern
        </Button>
        <List dense>
          {backups.map((b) => (
            <ListItem
              key={b.name}
              secondaryAction={
                <Stack direction="row">
                  <Tooltip title="Herunterladen">
                    <IconButton href={`/api/backups/${b.name}`}>
                      <DownloadIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Wiederherstellen">
                    <IconButton onClick={() => setRestore(b.name)}>
                      <RestoreIcon />
                    </IconButton>
                  </Tooltip>
                </Stack>
              }
            >
              <ListItemText primary={new Date(b.time).toLocaleString('de-DE')} secondary={b.name} />
            </ListItem>
          ))}
        </List>
      </Section>
      <ConfirmDialog
        open={Boolean(restore)}
        title="Sicherung wiederherstellen?"
        text="Die aktuelle Einrichtung wird ersetzt (und vorher gesichert)."
        confirm="Wiederherstellen"
        onClose={() => setRestore(null)}
        onConfirm={() => {
          const name = restore
          setRestore(null)
          void api
            .post(`/api/backups/${name}/restore`)
            .then(reload)
            .then(() => toast('Wiederhergestellt'))
            .then(load)
            .catch((e: Error) => toast(e.message, 'error'))
        }}
      />
      <ConfirmDialog
        open={Boolean(importData)}
        title="Konfiguration importieren?"
        text="Die aktuelle Einrichtung wird ersetzt (und vorher gesichert)."
        confirm="Importieren"
        onClose={() => setImportData(null)}
        onConfirm={() => {
          const data = importData
          setImportData(null)
          void api
            .post('/api/import', data)
            .then(reload)
            .then(() => toast('Importiert'))
            .then(load)
            .catch((e: Error) => toast(e.message, 'error'))
        }}
      />
    </>
  )
}

function Updates() {
  const { config, saveSection, toast } = usePbx()
  const [u, set] = useDraft<UpdateSettings>(config.updates)
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const check = (): void => {
    setChecking(true)
    void api
      .get<UpdateInfo>('/api/updates?check=1')
      .then(setInfo)
      .finally(() => setChecking(false))
  }
  useEffect(() => void api.get<UpdateInfo>('/api/updates').then(setInfo), [])
  return (
    <>
      <Section title="Aktualisierung" description="Neue Versionen kommen mit Sicherheitsupdates für Asterisk und das System. Vor jedem Update wird die Konfiguration gesichert; laufende Gespräche brechen ab, deshalb automatische Updates nur nachts.">
        <Stack direction="row" sx={{ gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
          <Chip label={`Installiert: ${info?.current ?? '…'}`} />
          {info?.latest && <Chip color={info.available ? 'primary' : 'default'} label={`Neueste: ${info.latest.version}`} />}
          <Button onClick={check} disabled={checking}>
            Jetzt prüfen
          </Button>
        </Stack>
        {info?.error && (
          <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
            Prüfung fehlgeschlagen: {info.error}
          </Alert>
        )}
        {info?.available && info.latest && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle1">Neu in {info.latest.version}</Typography>
            <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: 'text.secondary', maxHeight: 240, overflow: 'auto' }}>
              {info.latest.notes || 'Keine Beschreibung.'}
            </Typography>
            {info.canApply ? (
              <Button
                variant="contained"
                sx={{ mt: 1 }}
                disabled={applying}
                onClick={() => {
                  setApplying(true)
                  void api
                    .post('/api/updates/apply')
                    .then(() => toast('Update läuft – die Weboberfläche ist gleich wieder da.', 'info'))
                    .catch((e: Error) => {
                      setApplying(false)
                      toast(e.message, 'error')
                    })
                }}
              >
                Jetzt aktualisieren
              </Button>
            ) : (
              <Alert severity="info" variant="outlined" sx={{ mt: 1 }}>
                {info.reason} Manuell im Ordner der Anlage: <code>docker compose pull &amp;&amp; docker compose up -d</code>
              </Alert>
            )}
          </Box>
        )}
        <FormGrid columns={3}>
          <Select
            label="Kanal"
            value={u.channel}
            onChange={(v) => set({ channel: v })}
            options={[
              ['stable', 'Stabil'],
              ['beta', 'Beta (neue Funktionen früher)'],
            ]}
          />
          <FormControlLabel control={<Switch checked={u.auto} onChange={(e) => set({ auto: e.target.checked })} />} label="Automatisch installieren" />
          <NumberField label="Um (Uhr)" value={u.hour} onChange={(v) => set({ hour: Math.min(23, v) })} />
        </FormGrid>
        <SaveBar onSave={() => saveSection('updates', u)} />
      </Section>
    </>
  )
}

function Access() {
  const { config, saveSection, toast } = usePbx()
  const [old, setOld] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  return (
    <>
      <Section title="Passwort der Weboberfläche">
        <FormGrid columns={3}>
          <TextField type="password" label="Bisheriges Passwort" value={old} onChange={(e) => setOld(e.target.value)} />
          <TextField type="password" label="Neues Passwort" value={pw} onChange={(e) => setPw(e.target.value)} helperText="Mindestens 10 Zeichen" />
          <TextField type="password" label="Wiederholen" value={pw2} onChange={(e) => setPw2(e.target.value)} error={Boolean(pw2) && pw !== pw2} />
        </FormGrid>
        <SaveBar
          onSave={async () => {
            if (pw !== pw2) throw new Error('Die Passwörter stimmen nicht überein.')
            await api.post('/api/password', { old, password: pw })
            setOld('')
            setPw('')
            setPw2('')
          }}
        />
      </Section>
      <Section title="Automatische Einrichtung der App" description="Die SIP-Telefon-App sucht im lokalen Netz nach der Anlage (UDP-Port 15060).">
        <FormControlLabel
          control={
            <Switch
              checked={config.provisioning.discovery}
              onChange={(e) =>
                void saveSection('provisioning', { discovery: e.target.checked })
                  .then(() => toast('Gespeichert'))
                  .catch((err: Error) => toast(err.message, 'error'))
              }
            />
          }
          label="Im lokalen Netz auffindbar"
        />
      </Section>
    </>
  )
}

function HomeAssistant() {
  const { config, saveSection, reload, toast } = usePbx()
  const [confirm, setConfirm] = useState(false)
  const { enabled, token } = config.integration
  const copy = (text: string): void =>
    void navigator.clipboard
      .writeText(text)
      .then(() => toast('Kopiert'))
      .catch(() => toast('Kopieren nicht möglich', 'error'))
  const renew = (): void =>
    void api
      .post('/api/integration/token')
      .then(reload)
      .then(() => toast('Neuer Schlüssel erzeugt'))
      .catch((e: Error) => toast(e.message, 'error'))
  return (
    <Section
      title="Home Assistant"
      description="Verpasste Anrufe, abgemeldete SIP-Konten und andere Probleme in Home Assistant anzeigen und für Automationen nutzen. Die Integration „Phone4all“ liegt im Ordner custom_components des Projekts (über HACS installierbar)."
    >
      <FormControlLabel
        control={
          <Switch
            checked={enabled}
            onChange={(e) =>
              void saveSection('integration', { enabled: e.target.checked })
                .then(() => toast('Gespeichert'))
                .catch((err: Error) => toast(err.message, 'error'))
            }
          />
        }
        label="Schnittstelle für Home Assistant einschalten"
      />
      {enabled && (
        <Stack sx={{ gap: 2, mt: 2 }}>
          <TextField
            label="Adresse der Anlage"
            value={window.location.origin}
            slotProps={{ input: { readOnly: true } }}
            helperText="Über einen Reverse-Proxy (z. B. Pangolin) die HTTPS-Adresse eintragen, unter der Home Assistant die Anlage erreicht."
            onFocus={(e) => e.target.select()}
          />
          <TextField
            label="Zugriffsschlüssel"
            value={token}
            slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace' } } }}
            onFocus={(e) => e.target.select()}
          />
          <Stack direction="row" sx={{ gap: 1 }}>
            <Button variant="contained" onClick={() => copy(token)}>
              Schlüssel kopieren
            </Button>
            <Button onClick={() => setConfirm(true)}>Neuen Schlüssel erzeugen</Button>
          </Stack>
          <Alert severity="info" variant="outlined">
            In Home Assistant unter <b>Einstellungen → Geräte &amp; Dienste → Integration hinzufügen → Phone4all</b> Adresse und Schlüssel
            eintragen. Home Assistant fragt die Anlage alle 15 Sekunden unter <code>/api/integration/status</code> ab. Steht ein
            Reverse-Proxy mit eigener Anmeldung davor, diesen Pfad dort freigeben – der Schlüssel schützt ihn.
          </Alert>
        </Stack>
      )}
      <ConfirmDialog
        open={confirm}
        title="Neuen Schlüssel erzeugen?"
        text="Der bisherige Schlüssel wird ungültig. Home Assistant muss danach mit dem neuen Schlüssel neu eingerichtet werden."
        confirm="Erzeugen"
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          renew()
        }}
      />
    </Section>
  )
}

function Log() {
  const { toast } = usePbx()
  const [text, setText] = useState('')
  const [confirm, setConfirm] = useState(false)
  const load = (): void => void api.text('/api/log').then(setText)
  useEffect(load, [])
  return (
    <Section
      title="Protokoll"
      description="Warnungen und Fehler von Asterisk – hilfreich, wenn sich ein SIP-Konto nicht anmeldet."
      action={
        <Stack direction="row" sx={{ gap: 1 }}>
          <Button onClick={load}>Aktualisieren</Button>
          <Button color="error" onClick={() => setConfirm(true)}>
            Neu starten
          </Button>
        </Stack>
      }
    >
      <Box component="pre" sx={{ m: 0, p: 2, bgcolor: 'background.default', borderRadius: 2, overflow: 'auto', maxHeight: 520, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {text || 'Leer.'}
      </Box>
      <ConfirmDialog
        open={confirm}
        title="Telefonanlage neu starten?"
        text="Laufende Gespräche werden getrennt."
        confirm="Neu starten"
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          void api.post('/api/asterisk/restart').then(() => toast('Wird neu gestartet'))
        }}
      />
    </Section>
  )
}

const TABS: [string, () => React.JSX.Element][] = [
  ['Allgemein', General],
  ['E-Mail', Mail],
  ['Sicherheit', Security],
  ['Sicherung', Backup],
  ['Aktualisierung', Updates],
  ['Zugang', Access],
  ['Home Assistant', HomeAssistant],
  ['Protokoll', Log],
]

export default function System() {
  const [tab, setTab] = useState(0)
  const Page = TABS[tab][1]
  return (
    <Box>
      <PageHeader overline="System" title="Einstellungen und Wartung" description="Name, E-Mail, Sicherheit, Sicherungen, Updates und Home Assistant." />
      <Tabs value={tab} onChange={(_e, v: number) => setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
        {TABS.map(([label]) => (
          <Tab key={label} label={label} />
        ))}
      </Tabs>
      <Page />
    </Box>
  )
}
