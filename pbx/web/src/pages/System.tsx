import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import DownloadIcon from '@mui/icons-material/Download'
import ErrorIcon from '@mui/icons-material/Error'
import InfoIcon from '@mui/icons-material/Info'
import WarningIcon from '@mui/icons-material/Warning'
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
  ListItemIcon,
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
import type { MailSettings, RemoteSettings, SecuritySettings, SystemSettings, UpdateSettings, WatchdogSettings } from '../../../server/model'
import { type UpdateInfo, type WatchEvent, type WatchdogResponse, api } from '../api'
import { ChangesBar, ChipsInput, ConfirmDialog, confirmDiscard, FormGrid, Full, NumberField, PageHeader, PermissionChecks, Section, Select, useDraft } from '../components/common'
import { takeEditRequest } from '../router'
import { usePbx } from '../state'
import { useStatus } from '../useStatus'

function General() {
  const { config, states, saveSection } = usePbx()
  const d = useDraft<SystemSettings>(config.system)
  const { draft: s, set } = d
  return (
    <>
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
      </Section>
      <ChangesBar dirty={d.dirty} onApply={() => saveSection('system', s)} onDiscard={d.reset} />
    </>
  )
}

function Mail() {
  const { config, saveSection, toast } = usePbx()
  const initial = useMemo(() => ({ ...config.mail, password: '' }), [config.mail])
  const d = useDraft<MailSettings>(initial)
  const { draft: m, set } = d
  const [to, setTo] = useState('')
  return (
    <>
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
        </Stack>
      </Section>
      <ChangesBar dirty={d.dirty} onApply={() => saveSection('mail', m)} onDiscard={d.reset} />
    </>
  )
}

function Security() {
  const { config, saveSection } = usePbx()
  const d = useDraft<SecuritySettings>(config.security)
  const { draft: s, set } = d
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
          <Full>
            <ChipsInput
              label="Vertrauenswürdige Proxys"
              value={s.trusted_proxies}
              onChange={(v) => set({ trusted_proxies: v })}
              helperText="Nur diesen Adressen glaubt die Anlage die Kopfzeile X-Forwarded-For (z. B. Newt von Pangolin). Standard: lokal und Docker-Netze."
            />
          </Full>
          {status?.proxy_hints
            .filter((h) => !s.trusted_proxies.includes(h.ip))
            .map((h) => (
              <Full key={h.ip}>
                <Alert
                  severity="info"
                  action={
                    <Button color="inherit" size="small" onClick={() => set({ trusted_proxies: [...s.trusted_proxies, h.ip] })}>
                      Eintragen
                    </Button>
                  }
                >
                  {h.ip} schickt X-Forwarded-For (zuletzt {new Date(h.time).toLocaleString('de-DE')}). Ist das Ihr Reverse-Proxy, hier eintragen, damit Sperren die Adresse des Handys treffen und nicht den Proxy.
                </Alert>
              </Full>
            ))}
        </FormGrid>
      </Section>
      <Section
        title="Schutz vor Gebührenbetrug"
        description="Begrenzt den Schaden, falls ein Zugang in falsche Hände gerät: Betrüger rufen meist nachts mit vielen Gesprächen gleichzeitig teure Ziele an."
      >
        {config.security.outbound_stop ? (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={
              <Button color="inherit" onClick={() => void saveSection('security', { ...config.security, outbound_stop: false })}>
                Freigeben
              </Button>
            }
          >
            Notbremse aktiv: Gespräche nach außen sind gesperrt, nur Notrufe gehen durch.
          </Alert>
        ) : (
          <Button color="error" variant="outlined" sx={{ mb: 2 }} onClick={() => void saveSection('security', { ...config.security, outbound_stop: true })}>
            Notbremse ziehen
          </Button>
        )}
        <FormGrid columns={3}>
          <NumberField label="Gleichzeitig je Nebenstelle" value={s.max_calls_ext} onChange={(v) => set({ max_calls_ext: v })} min={0} helperText="Gespräche nach außen, 0 = unbegrenzt" />
          <NumberField label="Gleichzeitig für die Anlage" value={s.max_calls_total} onChange={(v) => set({ max_calls_total: v })} min={0} helperText="0 = unbegrenzt" />
          <NumberField label="Auslandsgespräche pro Tag" value={s.international_per_day} onChange={(v) => set({ international_per_day: v })} min={0} helperText="Danach greift die Notbremse, 0 = unbegrenzt" />
          <Full>
            <ChipsInput
              label="Erlaubte Länder (Recht „international“)"
              value={s.countries}
              onChange={(v) => set({ countries: v })}
              helperText="Ländervorwahlen ohne 00, z. B. 43 für Österreich, 1 für USA/Kanada. * = alle Länder."
            />
          </Full>
          <Full>
            <ChipsInput
              label="Sonderrufnummern"
              value={s.premium_prefixes}
              onChange={(v) => set({ premium_prefixes: v })}
              helperText="Nur für Nebenstellen mit „Sonderrufnummern erlaubt“. Vorwahlen wie 0900 oder 00881 (Satellit)."
            />
          </Full>
          <Full>
            <FormControlLabel control={<Switch checked={s.international_daytime} onChange={(e) => set({ international_daytime: e.target.checked })} />} label="Ausland nur von 6 bis 22 Uhr" />
          </Full>
          <Full>
            <FormControlLabel control={<Switch checked={s.forward_international} onChange={(e) => set({ forward_international: e.target.checked })} />} label="Umleitungen und Rufabfolgen dürfen ins Ausland weiterleiten" />
          </Full>
        </FormGrid>
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
      <ChangesBar dirty={d.dirty} onApply={() => saveSection('security', { ...s, outbound_stop: config.security.outbound_stop })} onDiscard={d.reset} />
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

/** Nach dem Update: warten, bis der neue Container antwortet (andere Version oder Neustart), dann neu laden. */
function waitForRestart(version: string): void {
  let down = false
  const started = Date.now()
  const poll = (): void => {
    if (Date.now() - started > 600000) return
    api
      .get<UpdateInfo>('/api/updates')
      .then((i) => {
        if (down || i.current !== version) window.location.reload()
        else setTimeout(poll, 3000)
      })
      .catch(() => {
        down = true
        setTimeout(poll, 3000)
      })
  }
  setTimeout(poll, 5000)
}

function Updates() {
  const { config, saveSection, toast } = usePbx()
  const d = useDraft<UpdateSettings>(config.updates)
  const { draft: u, set } = d
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
  useEffect(() => void api.get<UpdateInfo>('/api/updates?check=1').then(setInfo), [])
  const apply = (): void => {
    setApplying(true)
    void api
      .post('/api/updates/apply')
      .then(() => {
        toast('Update läuft – die Seite lädt neu, sobald die Anlage wieder da ist.', 'info')
        waitForRestart(info?.current ?? '')
      })
      .catch((e: Error) => {
        setApplying(false)
        toast(e.message, 'error')
      })
  }
  return (
    <>
      <Section title="Aktualisierung" description="Neue Versionen kommen mit Sicherheitsupdates für Asterisk und das System. Vor jedem Update wird die Konfiguration gesichert; laufende Gespräche brechen ab, deshalb automatische Updates nur nachts.">
        <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
          <Chip label={`Installiert: ${info?.current ?? '…'}`} />
          {info?.latest && <Chip color={info.available ? 'primary' : 'default'} label={`Neueste: ${info.latest.version}`} />}
          <Box sx={{ flex: 1 }} />
          <Button onClick={check} disabled={checking}>
            Jetzt prüfen
          </Button>
          <Button variant={info?.available ? 'contained' : 'outlined'} disabled={!info?.canApply || applying} onClick={apply}>
            {applying ? 'Update läuft …' : info?.available && info.latest ? `Auf ${info.latest.version} aktualisieren` : 'Neu laden und neu starten'}
          </Button>
        </Stack>
        {info?.error && (
          <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
            Prüfung fehlgeschlagen: {info.error}
          </Alert>
        )}
        {info && !info.canApply && (
          <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
            Update aus der Weboberfläche nicht möglich: {info.reason || 'noch nicht geprüft.'} Die Anlage braucht den Docker-Socket (
            <code>/var/run/docker.sock:/var/run/docker.sock</code> unter <code>volumes</code>) und muss per docker compose bzw. als TrueNAS-App laufen. Bis dahin
            manuell: <code>docker compose pull &amp;&amp; docker compose up -d</code>
          </Alert>
        )}
        {info?.canApply && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            Aktualisiert über das Compose-Projekt „{info.project}“: neues Image laden, Container neu erstellen. Die Weboberfläche ist nach etwa einer Minute wieder da.
          </Typography>
        )}
        {info?.available && info.latest && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle1">Neu in {info.latest.version}</Typography>
            <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: 'text.secondary', maxHeight: 240, overflow: 'auto' }}>
              {info.latest.notes || 'Keine Beschreibung.'}
            </Typography>
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
      </Section>
      <ChangesBar dirty={d.dirty} onApply={() => saveSection('updates', u)} onDiscard={d.reset} />
    </>
  )
}

function Access() {
  const { config, saveSection, toast } = usePbx()
  const d = useDraft(config.provisioning)
  const { draft: p, set } = d
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
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            disabled={!old || !pw}
            onClick={() => {
              if (pw !== pw2) return toast('Die Passwörter stimmen nicht überein.', 'error')
              void api
                .post('/api/password', { old, password: pw })
                .then(() => {
                  setOld('')
                  setPw('')
                  setPw2('')
                  toast('Passwort geändert')
                })
                .catch((e: Error) => toast(e.message, 'error'))
            }}
          >
            Passwort ändern
          </Button>
        </Stack>
      </Section>
      <Section title="Automatische Einrichtung der App" description="Die Phone4All-App sucht im lokalen Netz nach der Anlage (UDP-Port 15060).">
        <FormControlLabel control={<Switch checked={p.discovery} onChange={(e) => set({ discovery: e.target.checked })} />} label="Im lokalen Netz auffindbar" />
        <FormControlLabel
          control={<Switch checked={p.pin_remote} onChange={(e) => set({ pin_remote: e.target.checked })} />}
          label="Einrichtung per PIN auch von außerhalb (sonst nur per Einrichtungslink)"
          sx={{ display: 'flex' }}
        />
      </Section>
      <Section
        title="Rechte in der App"
        description="Was jede Nebenstelle in der Phone4All-App selbst einstellen darf. Unter Gruppen lassen sich einzelnen Gruppen weitere Rechte geben."
      >
        <PermissionChecks value={p.permissions} onChange={(permissions) => set({ permissions })} />
      </Section>
      <ChangesBar dirty={d.dirty} onApply={() => saveSection('provisioning', p)} onDiscard={d.reset} />
    </>
  )
}

const TURN_STATE: Record<string, [string, 'success' | 'default' | 'error' | 'warning']> = {
  running: ['TURN-Server läuft', 'success'],
  off: ['TURN-Server aus', 'default'],
  missing: ['TURN-Server nicht installiert', 'warning'],
  error: ['TURN-Server gestört', 'error'],
}

function Remote() {
  const { config, saveSection } = usePbx()
  const d = useDraft<RemoteSettings>(config.remote)
  const { draft: r, set } = d
  const [status] = useStatus(10000)
  const host = (() => {
    try {
      return new URL(r.public_url).hostname
    } catch {
      return 'telefon.example.de'
    }
  })()
  const turn = status?.remote ? TURN_STATE[status.remote.turn] : null
  return (
    <>
      <Section
        title="Mobil-App von unterwegs"
        description="Die Phone4All-App für Android und iPhone erreicht die Anlage nur über HTTPS: Einrichtung, Kontakte und Kalender wie bisher, SIP als WebSocket unter /ws. Die Sprache ist per DTLS-SRTP verschlüsselt und läuft über den eingebauten TURN-Server."
      >
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mb: 2 }}>
          {turn && <Chip color={turn[1]} variant="outlined" label={turn[0]} />}
          {status?.remote && <Chip variant="outlined" label={`Verbundene Apps: ${status.remote.connections}`} />}
        </Stack>
        <FormGrid>
          <Full>
            <FormControlLabel control={<Switch checked={r.enabled} onChange={(e) => set({ enabled: e.target.checked })} />} label="Mobil-App zulassen (SIP über WebSocket, WebRTC)" />
          </Full>
          <Full>
            <TextField
              fullWidth
              label="Öffentliche Adresse"
              placeholder="https://telefon.example.de"
              value={r.public_url}
              onChange={(e) => set({ public_url: e.target.value.trim() })}
              helperText="Adresse des Reverse-Proxys (z. B. Pangolin). Einrichtungslinks, QR-Codes und Einladungen zeigen dann dorthin, auch wenn Sie die Weboberfläche im LAN öffnen."
            />
          </Full>
          <Full>
            <FormControlLabel control={<Switch checked={r.turn} onChange={(e) => set({ turn: e.target.checked })} />} label="Eingebauter TURN-Server für die Sprache" />
          </Full>
          <NumberField label="TURN-Port" value={r.turn_port} onChange={(v) => set({ turn_port: v })} min={1} />
          <TextField label="TURN-Adresse für die App" placeholder={`${host}:${r.turn_port}`} value={r.turn_host} onChange={(e) => set({ turn_host: e.target.value.trim() })} helperText="Leer = Name der öffentlichen Adresse mit TURN-Port" />
        </FormGrid>
      </Section>
      <Section title="Einrichtung in Pangolin" description="So gelangt die App über einen Pangolin-Reverse-Proxy zur Anlage. Andere Proxys (Traefik, Caddy, nginx) funktionieren genauso, sie müssen WebSockets durchreichen.">
        <Box component="ol" sx={{ m: 0, pl: 3, '& li': { mb: 1.5 } }}>
          <li>
            <Typography variant="body2">
              <b>HTTP-Ressource</b> anlegen, z. B. <code>{host}</code>, Ziel <code>http://&lt;Adresse der Anlage&gt;:8080</code>. Pangolin stellt das Zertifikat aus.
            </Typography>
          </li>
          <li>
            <Typography variant="body2">
              Unter <b>Regeln</b> für die Pfade <code>/provision/*</code>, <code>/setup/*</code> und <code>/ws</code> die Anmeldung umgehen
              („Bypass Auth“). Die App meldet sich dort mit ihrem geheimen Einrichtungslink bzw. SIP-Passwort an; die Weboberfläche bleibt hinter der
              Pangolin-Anmeldung.
            </Typography>
          </li>
          <li>
            <Typography variant="body2">
              <b>TCP- und UDP-Ressource</b> (Raw) auf Port <code>{r.turn_port}</code> zur Anlage, Port <code>{r.turn_port}</code>, für die Sprache. Dazu müssen
              Raw-Ressourcen in Pangolin aktiviert und der Port am Pangolin-Server offen sein.
            </Typography>
          </li>
          <li>
            <Typography variant="body2">
              Oben die öffentliche Adresse <code>https://{host}</code> eintragen und speichern. Dann in der App den QR-Code der Nebenstelle scannen
              (<i>Nebenstellen → Bearbeiten</i>).
            </Typography>
          </li>
        </Box>
      </Section>
      <ChangesBar dirty={d.dirty} onApply={() => saveSection('remote', r)} onDiscard={d.reset} />
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

/** Symbol für Zustand und Ereignisse des Watchdogs */
export function LevelIcon({ level }: { level: WatchEvent['level'] }) {
  if (level === 'ok') return <CheckCircleIcon color="success" />
  if (level === 'warning') return <WarningIcon color="warning" />
  if (level === 'error') return <ErrorIcon color="error" />
  return <InfoIcon color="info" />
}

function since(ms: number): string {
  if (!ms) return ''
  return `seit ${new Date(ms).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`
}

function Diagnose() {
  const { config, saveSection, toast } = usePbx()
  const d = useDraft<WatchdogSettings>(config.watchdog)
  const { draft: w, set } = d
  const [data, setData] = useState<WatchdogResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const load = (): void => void api.get<WatchdogResponse>('/api/watchdog').then(setData).catch(() => undefined)
  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])
  const checkNow = (): void => {
    setBusy(true)
    void api
      .post<WatchdogResponse>('/api/watchdog/check')
      .then(setData)
      .catch((e: Error) => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <Section
        title="Zustand"
        description={
          data?.checked
            ? `Der Watchdog prüft alle 30 Sekunden. Zuletzt: ${new Date(data.checked).toLocaleTimeString('de-DE')} · ${data.repairs} Störungen seit dem Start selbst behoben.`
            : 'Der Watchdog prüft alle 30 Sekunden.'
        }
        action={
          <Button onClick={checkNow} disabled={busy}>
            Jetzt prüfen
          </Button>
        }
      >
        <List dense disablePadding>
          {data?.checks.map((c) => (
            <ListItem key={c.id} disableGutters>
              <ListItemIcon>
                <LevelIcon level={c.level} />
              </ListItemIcon>
              <ListItemText primary={c.name} secondary={[c.text, c.level !== 'ok' ? since(c.since) : ''].filter(Boolean).join(' · ')} />
            </ListItem>
          ))}
        </List>
        {data && !data.auto_repair && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            Die Selbstheilung ist ausgeschaltet – Störungen werden nur gemeldet.
          </Alert>
        )}
      </Section>
      <Section title="Watchdog" description="Überwacht Asterisk, die Anmeldung der SIP-Konten und den Speicherplatz. Hängt Asterisk, wird es neu gestartet; abgemeldete SIP-Konten werden mit wachsendem Abstand neu angemeldet.">
        <FormGrid>
          <Full>
            <FormControlLabel control={<Switch checked={w.auto_repair} onChange={(e) => set({ auto_repair: e.target.checked })} />} label="Störungen automatisch beheben" />
          </Full>
          <NumberField label="SIP-Konto neu anmelden nach (Minuten)" value={w.trunk_grace} onChange={(v) => set({ trunk_grace: v })} min={1} helperText="So lange darf ein Konto abgemeldet sein" />
          <TextField
            label="Störungen per E-Mail an"
            value={w.notify_email}
            onChange={(e) => set({ notify_email: e.target.value.trim() })}
            helperText={config.mail.host ? 'Leer = keine E-Mails' : 'Dafür zuerst den E-Mail-Versand einrichten'}
          />
        </FormGrid>
      </Section>
      <Section
        title="Ereignisse"
        description="Störungen und was der Watchdog dagegen getan hat, neueste zuerst."
        action={
          <Button color="error" disabled={!data?.events.length} onClick={() => void api.del('/api/watchdog/events').then(load)}>
            Leeren
          </Button>
        }
      >
        {data?.events.length ? (
          <List dense disablePadding sx={{ maxHeight: 520, overflow: 'auto' }}>
            {data.events.map((e, i) => (
              <ListItem key={i} disableGutters>
                <ListItemIcon>
                  <LevelIcon level={e.level} />
                </ListItemIcon>
                <ListItemText primary={e.text} secondary={new Date(e.time).toLocaleString('de-DE')} />
              </ListItem>
            ))}
          </List>
        ) : (
          <Typography sx={{ color: 'text.secondary' }}>Keine Ereignisse.</Typography>
        )}
      </Section>
      <ChangesBar dirty={d.dirty} onApply={() => saveSection('watchdog', w)} onDiscard={d.reset} />
    </>
  )
}

const TABS: [string, () => React.JSX.Element][] = [
  ['Allgemein', General],
  ['E-Mail', Mail],
  ['Sicherheit', Security],
  ['Sicherung', Backup],
  ['Aktualisierung', Updates],
  ['Zugang', Access],
  ['Fernzugriff', Remote],
  ['Diagnose', Diagnose],
  ['Home Assistant', HomeAssistant],
  ['Protokoll', Log],
]

export default function System() {
  // #/system?edit=diagnose öffnet direkt den Tab (z. B. von der Übersicht)
  const [tab, setTab] = useState(() => {
    const wanted = takeEditRequest('system')
    return Math.max(0, TABS.findIndex(([label]) => label.toLowerCase() === wanted))
  })
  // Auch wenn die Seite schon offen ist (z. B. Update-Hinweis im Menü)
  useEffect(() => {
    const on = (): void => {
      const wanted = takeEditRequest('system')
      const i = TABS.findIndex(([label]) => label.toLowerCase() === wanted)
      if (i >= 0) setTab(i)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const Page = TABS[tab][1]
  return (
    <Box>
      <PageHeader overline="System" title="Einstellungen und Wartung" description="Name, E-Mail, Sicherheit, Sicherungen, Updates, Diagnose und Home Assistant." />
      <Tabs value={tab} onChange={(_e, v: number) => confirmDiscard() && setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
        {TABS.map(([label]) => (
          <Tab key={label} label={label} />
        ))}
      </Tabs>
      <Page />
    </Box>
  )
}
