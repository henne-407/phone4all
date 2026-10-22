/** Einstellungen: SIP-Konto, Kalender, Kontakte und Allgemeines. */

import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import DeleteIcon from '@mui/icons-material/DeleteOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FileOpenIcon from '@mui/icons-material/FileOpen'
import LaunchIcon from '@mui/icons-material/Launch'
import PaletteIcon from '@mui/icons-material/Palette'
import PlayIcon from '@mui/icons-material/PlayArrow'
import RefreshIcon from '@mui/icons-material/Refresh'
import CircleIcon from '@mui/icons-material/Circle'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  ListItemButton,
  ListItemText,
  MenuItem,
  Radio,
  Stack,
  Tab,
  Tabs,
  ToggleButton,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { SCHEMES, STYLES, THEMES, swatch } from '../../../../shared/themes'
import type { AccountSettings, DesignStyle } from '../../../../shared/types'
import { api } from '../../api'
import { convertToWav, playWav } from '../../audio'
import { useApp } from '../../state'
import { DAV_KINDS, DavAccountDialog, type DavKind } from './DavAccountDialog'
import { PbxSetupDialog } from './PbxSetupDialog'
import { Group, Row, SwitchRow } from './parts'
import { SqlSourceDialog } from './SqlSourceDialog'

const TRANSPORTS = [
  ['udp', 'UDP'],
  ['tcp', 'TCP'],
  ['tls', 'TLS'],
]
const MEDIAENC = [
  ['', 'Keine'],
  ['srtp', 'SRTP (wenn möglich)'],
  ['srtp-mand', 'SRTP (erzwingen)'],
  ['dtls_srtp', 'DTLS-SRTP'],
]

// -- Konto ----------------------------------------------------------------------

function AccountTab({
  acc,
  setAcc,
  password,
  setPassword,
  onPbxApplied,
}: {
  acc: AccountSettings
  setAcc: (a: AccountSettings) => void
  password: string
  setPassword: (p: string) => void
  onPbxApplied: () => void
}) {
  const { state } = useApp()
  const pbx = state.settings.provisioning
  // Die Anlage kann die Kontodaten sperren; sie kommen dann nur noch aus dem Profil
  const locked = Boolean(pbx.pbx && pbx.policy?.lock_account)
  const [pbxSetup, setPbxSetup] = useState(false)
  const field = (key: keyof AccountSettings, label: string, extra: object = {}) => (
    <TextField key={key} label={label} value={acc[key] ?? ''} disabled={locked} onChange={(e) => setAcc({ ...acc, [key]: e.target.value })} {...extra} />
  )
  const num = (key: 'port' | 'local_port' | 'regint', label: string, helper: string, min = 0, max = 65535) => (
    <TextField
      label={label}
      type="number"
      helperText={helper}
      value={acc[key]}
      onChange={(e) => setAcc({ ...acc, [key]: Math.max(min, Math.min(max, Number(e.target.value) || 0)) })}
    />
  )
  return (
    <Stack sx={{ gap: 1.5 }}>
      <Alert
        severity={pbx.pbx ? 'success' : 'info'}
        icon={false}
        action={
          locked ? undefined : pbx.pbx ? (
            <Button color="inherit" size="small" onClick={() => void api.pbxDisconnect()}>
              Trennen
            </Button>
          ) : (
            <Button color="inherit" size="small" onClick={() => setPbxSetup(true)}>
              Einrichten
            </Button>
          )
        }
      >
        {pbx.pbx
          ? `Eingerichtet von „${pbx.pbx}“ als Nebenstelle ${pbx.extension}. Änderungen an der Anlage werden automatisch übernommen.${locked ? ' Die Kontodaten verwaltet die Anlage.' : ''}`
          : 'Phone4all-Telefonanlage? Dann richtet sich die App mit Nebenstelle und Einrichtungs-PIN von selbst ein.'}
      </Alert>
      {pbxSetup && <PbxSetupDialog onClose={() => setPbxSetup(false)} onApplied={onPbxApplied} />}
      <Typography variant="subtitle1">SIP-Konto</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Die Zugangsdaten findest du in der Oberfläche deiner Telefonanlage (z. B. FRITZ!Box: Telefonie → Telefoniegeräte →
        IP-Telefon).
      </Typography>
      {field('domain', 'Server / Domain  (z. B. fritz.box oder 192.168.178.1)', { autoFocus: !acc.domain })}
      {field('user', 'Benutzername / Durchwahl')}
      <TextField
        label="Passwort"
        type="password"
        disabled={locked}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={password.includes(';')}
        helperText={password.includes(';') ? 'Das Zeichen „;“ wird von baresip nicht unterstützt' : ' '}
      />
      {field('display_name', 'Anzeigename (optional)')}
      <Accordion disableGutters variant="outlined" sx={{ mt: 1 }} disabled={locked}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <ListItemText primary="Erweiterte Kontoeinstellungen" secondary="Nur nötig, wenn deine Anlage es verlangt" />
        </AccordionSummary>
        <AccordionDetails>
          <Stack sx={{ gap: 1.5 }}>
            {field('auth_user', 'Authentifizierungs-Benutzer (falls abweichend)')}
            {field('outbound', 'Outbound-Proxy (optional)')}
            {field('stun', 'STUN-Server (optional, z. B. stun.example.org)')}
            <TextField select label="Transport" value={acc.transport} onChange={(e) => setAcc({ ...acc, transport: e.target.value as AccountSettings['transport'] })}>
              {TRANSPORTS.map(([k, l]) => (
                <MenuItem key={k} value={k}>
                  {l}
                </MenuItem>
              ))}
            </TextField>
            {num('port', 'Port', '0 = Standard (5060, TLS 5061)')}
            {num('local_port', 'Lokaler SIP-Port', '0 = automatisch')}
            <TextField select label="Medienverschlüsselung" value={acc.mediaenc} onChange={(e) => setAcc({ ...acc, mediaenc: e.target.value })}>
              {MEDIAENC.map(([k, l]) => (
                <MenuItem key={k || 'none'} value={k}>
                  {l}
                </MenuItem>
              ))}
            </TextField>
            {num('regint', 'Registrierungsintervall (Sekunden)', '60 bis 3600', 60, 3600)}
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Stack>
  )
}

// -- Konten-Listen ---------------------------------------------------------------

function DavAccounts({ kind }: { kind: DavKind }) {
  const { state } = useApp()
  const [adding, setAdding] = useState(false)
  const info = DAV_KINDS[kind]
  const accounts = kind === 'caldav' ? state.settings.calendar.caldav : state.settings.addressbooks.carddav
  return (
    <>
      <Group
        title={info.group}
        action={
          <Tooltip title={`${info.title} hinzufügen`}>
            <IconButton onClick={() => setAdding(true)}>
              <AddIcon />
            </IconButton>
          </Tooltip>
        }
      >
        {accounts.length ? (
          accounts.map((c) => (
            <Row
              key={c.id}
              action={
                <Tooltip title="Konto entfernen">
                  <IconButton edge="end" onClick={() => void api.removeDavAccount(kind, c.id)}>
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
              }
            >
              <ListItemText primary={c.name || c.url} secondary={`${c.user} · ${c.url}`} />
            </Row>
          ))
        ) : (
          <ListItemButton onClick={() => setAdding(true)}>
            <ListItemText primary={`${info.title} hinzufügen`} secondary={info.hint} />
          </ListItemButton>
        )}
      </Group>
      {adding && <DavAccountDialog kind={kind} onClose={() => setAdding(false)} />}
    </>
  )
}

// -- Kalender ------------------------------------------------------------------------

function CalendarTab() {
  const { state } = useApp()
  const { settings, calendars } = state
  const writable = calendars.filter((c) => c.writable)
  const [reminder, setReminder] = useState(String(settings.calendar.reminder_minutes))
  return (
    <>
      <Group title="Kalender" description="Ausgeschaltete Kalender werden im Kalender-Tab nicht angezeigt.">
        {state.calendarsLoading && !calendars.length && <Row>Lade Kalender …</Row>}
        {!state.calendarsLoading && !calendars.length && (
          <Row>
            <ListItemText primary="Noch keine Kalender" secondary="Unten ein CalDAV-Konto hinzufügen" />
          </Row>
        )}
        {calendars.map((c) => (
          <SwitchRow
            key={c.id}
            title={c.name}
            subtitle={c.group + (c.writable ? '' : ' · nur lesen')}
            checked={c.enabled}
            onChange={(v) => void api.setCalendarEnabled(c.id, v)}
            prefix={<CircleIcon sx={{ fontSize: 12, color: c.color, mr: 2 }} />}
          />
        ))}
        {writable.length > 0 && (
          <Row>
            <TextField
              select
              size="small"
              label="Kalender für neue Termine"
              value={state.defaultCalendar ?? ''}
              onChange={(e) => void api.setDefaultCalendar(e.target.value)}
              sx={{ my: 1 }}
            >
              {writable.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          </Row>
        )}
        {state.calendarErrors.map((e) => (
          <Row key={e}>
            <Alert severity="error" sx={{ width: '100%' }}>
              {e}
            </Alert>
          </Row>
        ))}
      </Group>
      {state.platform.eds && (
        <Group
          title="GNOME Online-Konten"
          description="Google, Microsoft 365, Nextcloud u. a. – eingerichtet unter GNOME-Einstellungen → Online-Konten. Auch lokale Evolution-Kalender erscheinen hier."
        >
          <SwitchRow
            title="Kalender aus GNOME Online-Konten verwenden"
            checked={settings.calendar.use_eds}
            onChange={(v) => void api.setCalendarUseEds(v)}
          />
          <ListItemButton onClick={() => void api.openOnlineAccounts()}>
            <ListItemText primary="Online-Konten verwalten" />
            <LaunchIcon fontSize="small" />
          </ListItemButton>
        </Group>
      )}
      <DavAccounts kind="caldav" />
      <Group title="Erinnerungen">
        <Row>
          <TextField
            type="number"
            size="small"
            label="Vor Terminen erinnern (Minuten)"
            helperText="Benachrichtigung mit Anrufknopf, wenn der Termin eine Nummer enthält. 0 = aus"
            value={reminder}
            onChange={(e) => {
              setReminder(e.target.value)
              const v = Math.max(0, Math.min(240, Number(e.target.value) || 0))
              void api.setReminderMinutes(v)
            }}
            sx={{ my: 1 }}
          />
        </Row>
      </Group>
    </>
  )
}

// -- Kontakte ------------------------------------------------------------------------

function ContactsTab({ onClose }: { onClose: () => void }) {
  const { state } = useApp()
  const [sql, setSql] = useState<{ id?: string } | null>(null)
  const sources = state.settings.addressbooks.sql
  return (
    <>
      <Group title="Import" description="Vorhandene Kontakte werden ergänzt (gleiche Nummer oder gleicher Name), nichts wird überschrieben.">
        <ListItemButton
          onClick={() => {
            onClose()
            void api.importContacts()
          }}
        >
          <ListItemText
            primary="Aus Datei importieren"
            secondary="vCard (.vcf) oder CSV, z. B. Export aus Google Kontakte, iCloud, Outlook oder Thunderbird"
          />
          <FileOpenIcon />
        </ListItemButton>
      </Group>
      <Group
        title="Adressbücher"
        description="Kontakte aus Adressbüchern werden alle 30 Minuten abgeglichen, erscheinen in der Kontaktliste und dienen zur Anrufererkennung. Bearbeitet werden sie im Adressbuch."
        action={
          <Tooltip title="Jetzt abgleichen">
            <IconButton onClick={() => void api.syncContacts()}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        }
      >
        {state.syncing && !state.books.length && <Row>Adressbücher werden abgeglichen …</Row>}
        {!state.syncing && !state.books.length && <Row>Keine Adressbücher verbunden</Row>}
        {state.books.map((b) => (
          <SwitchRow
            key={b.id}
            title={b.name}
            subtitle={`${b.group} · ${b.count} Kontakt${b.count !== 1 ? 'e' : ''} mit Nummer`}
            checked={b.enabled}
            onChange={(v) => void api.setBookEnabled(b.id, v)}
          />
        ))}
        {state.bookErrors.map((e) => (
          <Row key={e}>
            <Alert severity="error" sx={{ width: '100%' }}>
              {e}
            </Alert>
          </Row>
        ))}
      </Group>
      {state.platform.eds && (
        <Group title="GNOME Online-Konten">
          <SwitchRow
            title="Adressbücher aus GNOME Online-Konten verwenden"
            subtitle="Google, Microsoft 365, Nextcloud u. a. sowie GNOME Kontakte"
            checked={state.settings.addressbooks.use_eds}
            onChange={(v) => void api.setBooksUseEds(v)}
          />
        </Group>
      )}
      <DavAccounts kind="carddav" />
      <Group
        title="SQL-Server-Datenbanken"
        description="Kontakte aus einer Microsoft-SQL-Server-Datenbank, z. B. CRM oder Warenwirtschaft (nur lesend; ein Datenbankbenutzer mit Leserechten genügt)."
        action={
          <Tooltip title="Datenbank hinzufügen">
            <IconButton onClick={() => setSql({})}>
              <AddIcon />
            </IconButton>
          </Tooltip>
        }
      >
        {sources.length ? (
          sources.map((c) => (
            <Row
              key={c.id}
              action={
                <Tooltip title="Datenbank entfernen">
                  <IconButton edge="end" onClick={() => void api.sqlRemove(c.id)}>
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
              }
            >
              <ListItemButton onClick={() => setSql({ id: c.id })} sx={{ mx: -2, my: -1 }}>
                <ListItemText
                  primary={c.name || c.database}
                  secondary={`${c.user}@${c.host}/${c.database} · ${c.mode === 'query' ? 'eigene Abfrage' : c.table}`}
                />
              </ListItemButton>
            </Row>
          ))
        ) : (
          <ListItemButton onClick={() => setSql({})}>
            <ListItemText primary="Datenbank hinzufügen" secondary="Microsoft SQL Server" />
          </ListItemButton>
        )}
      </Group>
      {sql && <SqlSourceDialog existing={sources.find((c) => c.id === sql.id)} onClose={() => setSql(null)} />}
    </>
  )
}

// -- Allgemein -----------------------------------------------------------------------

function GeneralTab() {
  const { state, toast } = useApp()
  const { settings } = state
  const alertDevice = state.devices.sinks.find((d) => d.id === (settings.audio.alert || settings.audio.sink))

  const preview = async (key: string): Promise<void> => {
    const data = await api.ringtoneData(key)
    if (data) await playWav(data, alertDevice)
  }

  const pickCustom = async (): Promise<void> => {
    const data = await api.chooseAudioFile()
    if (!data) return
    try {
      await api.saveCustomRingtone(await convertToWav(data))
      toast('Eigener Klingelton übernommen')
      void preview('custom')
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <>
      <Group title="Darstellung">
        <Row>
          <TextField
            select
            size="small"
            label="Designstil"
            value={settings.appearance.style}
            onChange={(e) => void api.setAppearance({ style: e.target.value as DesignStyle })}
            sx={{ my: 1 }}
          >
            {STYLES.map((s) => (
              <MenuItem key={s.key} value={s.key}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
        </Row>
        <Box sx={{ p: 2 }}>
          <Typography sx={{ mb: 1.5 }}>Farbthema</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 1 }}>
            {THEMES.map((t) => {
              const active = settings.appearance.theme === t.key
              return (
                <ToggleButton
                  key={t.key}
                  value={t.key}
                  selected={active}
                  onClick={() => void api.setAppearance({ theme: t.key })}
                  sx={{ flexDirection: 'column', gap: 0.75, border: 0, textTransform: 'none' }}
                >
                  <Avatar sx={{ bgcolor: swatch(t.key, state.platform.accent), color: 'common.white' }}>
                    {active ? <CheckIcon /> : t.key === 'system' ? <PaletteIcon /> : null}
                  </Avatar>
                  <Typography variant="caption">{t.name}</Typography>
                </ToggleButton>
              )
            })}
          </Box>
        </Box>
        <Row>
          <TextField
            select
            size="small"
            label="Hell oder dunkel"
            value={settings.appearance.scheme}
            onChange={(e) => void api.setAppearance({ scheme: e.target.value as 'system' | 'light' | 'dark' })}
            sx={{ my: 1 }}
          >
            {SCHEMES.map((s) => (
              <MenuItem key={s.key} value={s.key}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
        </Row>
        <SwitchRow
          title="Anrufe im Pop-up führen"
          subtitle="Annehmen, stummschalten, weiterleiten und auflegen im kleinen Anruffenster, ohne das Hauptfenster zu öffnen"
          checked={settings.mini_call}
          onChange={(v) => void api.setBehaviour({ mini_call: v })}
        />
      </Group>

      <Group title="Klingelton" description="Wird auf dem Gerät abgespielt, das unter „Klingeln auf“ gewählt ist.">
        {state.ringtones.map((r) => (
          <Row
            key={r.key}
            action={
              <Stack direction="row" sx={{ alignItems: 'center' }}>
                {r.key === 'custom' && (
                  <Button size="small" onClick={() => void pickCustom()}>
                    Datei wählen …
                  </Button>
                )}
                <Tooltip title="Probehören">
                  <span>
                    <IconButton edge="end" disabled={!r.available} onClick={() => void preview(r.key)}>
                      <PlayIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            }
          >
            <Radio
              checked={settings.ringtone === r.key}
              disabled={!r.available}
              onChange={() => {
                void api.setRingtone(r.key)
                void preview(r.key)
              }}
              sx={{ ml: -1, mr: 1 }}
            />
            <ListItemText primary={r.name} secondary={r.key === 'custom' && r.available ? 'Eigene Audiodatei' : r.description} />
          </Row>
        ))}
      </Group>

      <Group title="Verhalten">
        <SwitchRow
          title="Im Hintergrund weiterlaufen"
          subtitle="Beim Schließen des Fensters bleibst du erreichbar (Symbol im Infobereich)"
          checked={settings.run_in_background}
          onChange={(v) => void api.setBehaviour({ run_in_background: v })}
        />
        <SwitchRow
          title="Beim Anmelden starten"
          subtitle="Startet unsichtbar im Hintergrund"
          checked={settings.autostart}
          onChange={(v) => void api.setBehaviour({ autostart: v })}
        />
      </Group>

      <Group title="Audio">
        <Row>
          <ListItemText
            primary="Mikrofon und Lautsprecher"
            secondary="Auswahl über die Titelleiste oben im Hauptfenster (Mikrofon- und Lautsprecher-Symbol), inklusive Testton und Pegelanzeige."
          />
        </Row>
        <ListItemButton onClick={() => void api.openLog()}>
          <ListItemText primary="Protokoll der SIP-Engine öffnen" secondary="Hilft bei der Fehlersuche (baresip.log)" />
          <LaunchIcon fontSize="small" />
        </ListItemButton>
      </Group>
    </>
  )
}

// -- Dialog ----------------------------------------------------------------------------

const TABS = [
  ['account', 'Konto'],
  ['calendar', 'Kalender'],
  ['contacts', 'Kontakte'],
  ['general', 'Allgemein'],
]

export function PreferencesDialog({ page, onClose }: { page: string; onClose: () => void }) {
  const { state, toast } = useApp()
  const narrow = useMediaQuery('(max-width: 600px)')
  const [tab, setTab] = useState(TABS.some(([k]) => k === page) ? page : 'account')
  const [acc, setAcc] = useState<AccountSettings>({ ...state.settings.account })
  const [password, setPassword] = useState<string | null>(null)
  const [initialPassword, setInitialPassword] = useState('')

  const reloadAccount = async (): Promise<void> => {
    const p = await api.getPassword()
    setPassword(p)
    setInitialPassword(p)
    setAcc({ ...(await api.getState()).settings.account })
  }

  useEffect(() => {
    void reloadAccount()
  }, [])

  // Kontodaten beim Schließen übernehmen (verbindet bei Änderungen neu)
  const close = async (): Promise<void> => {
    const trimmed = Object.fromEntries(
      Object.entries(acc).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]),
    ) as unknown as AccountSettings
    const changed = JSON.stringify(trimmed) !== JSON.stringify(state.settings.account) || (password ?? '') !== initialPassword
    if (changed && password !== null) {
      const secure = await api.saveAccount(trimmed, password)
      if (!secure) toast('Kein Schlüsselbund verfügbar – Passwort unverschlüsselt gespeichert (nur für dich lesbar)')
    }
    onClose()
  }

  return (
    <Dialog
      open
      onClose={() => void close()}
      fullWidth
      maxWidth="md"
      fullScreen={narrow}
      slotProps={{ paper: { sx: { height: narrow ? '100%' : 'min(820px, 92vh)' } } }}
    >
      <Box sx={{ px: 3, pt: 2.5 }}>
        <Typography variant="h5">Einstellungen</Typography>
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" sx={{ mt: 1 }}>
          {TABS.map(([k, l]) => (
            <Tab key={k} value={k} label={l} />
          ))}
        </Tabs>
      </Box>
      <DialogContent dividers sx={{ px: 3 }}>
        {tab === 'account' && password !== null && (
          <AccountTab acc={acc} setAcc={setAcc} password={password} setPassword={setPassword} onPbxApplied={() => void reloadAccount()} />
        )}
        {tab === 'calendar' && <CalendarTab />}
        {tab === 'contacts' && <ContactsTab onClose={() => void close()} />}
        {tab === 'general' && <GeneralTab />}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button variant="contained" onClick={() => void close()}>
          Fertig
        </Button>
      </DialogActions>
    </Dialog>
  )
}
