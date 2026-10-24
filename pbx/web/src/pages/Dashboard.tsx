import CallIcon from '@mui/icons-material/Call'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PersonIcon from '@mui/icons-material/Person'
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk'
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart'
import ShieldIcon from '@mui/icons-material/Shield'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import { Alert, Box, Button, Card, CardActionArea, CardContent, Chip, List, ListItem, ListItemIcon, ListItemText, Stack, Typography, useTheme } from '@mui/material'
import type { ReactNode } from 'react'
import { PageHeader, formatDuration } from '../components/common'
import { go } from '../router'
import { usePbx } from '../state'
import { useStatus } from '../useStatus'

function Stat({ label, value, sub, color, icon, onClick }: { label: string; value: ReactNode; sub?: ReactNode; color: string; icon: ReactNode; onClick?: () => void }) {
  return (
    <Card sx={{ flex: '1 1 220px', '&:hover': onClick ? { borderColor: 'primary.main' } : undefined }}>
      <CardActionArea onClick={onClick} disabled={!onClick} sx={{ height: '100%' }}>
        <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Box sx={{ width: 48, height: 48, borderRadius: 3, bgcolor: color, color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>{icon}</Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
              {label}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
              {value}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {sub}
            </Typography>
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

const FEATURES: [string, string][] = [
  ['*97', 'Eigene Voicemail abhören'],
  ['*98', 'Andere Voicemail abhören'],
  ['*76', 'Nicht stören ein/aus'],
  ['*21 + Nummer', 'Alle Anrufe weiterleiten (*21 allein: aus)'],
  ['*8', 'Anruf in der Gruppe heranholen'],
  ['** + Nebenstelle', 'Anruf einer Nebenstelle heranholen'],
  ['*31 + Nummer', 'Anonym anrufen'],
  ['*28 + Nr.', 'Zeitsteuerung umschalten (Nachtschaltung)'],
  ['*43', 'Echo-Test (Mikrofon prüfen)'],
]

export default function Dashboard() {
  const { config, version } = usePbx()
  const theme = useTheme()
  const [status] = useStatus(4000)
  const extOnline = config.extensions.filter((e) => status?.endpoints.some((x) => x.number === e.number && x.contacts.some((c) => c.status !== 'Unreachable'))).length
  const regTrunks = config.trunks.filter((t) => t.enabled && t.register && !t.ip_auth)
  const registered = regTrunks.filter((t) => status?.registrations.find((r) => r.trunk === t.id)?.status === 'Registered').length
  const calls = status?.calls ?? []
  /** „10 Anna“ für Nebenstellen, „Name (Nummer)“ für externe Anrufer */
  const party = (num: string, name: string): string => {
    const ext = config.extensions.find((e) => e.number === num)
    if (ext) return `${ext.number} ${ext.name}`
    return name && name !== num ? `${name} (${num})` : num
  }
  const problems = status?.watchdog.checks.filter((c) => c.level !== 'ok') ?? []
  const worst = problems.some((c) => c.level === 'error') ? 'error' : problems.length ? 'warning' : 'ok'
  const steps: [boolean, string, string][] = [
    [config.extensions.length > 0, 'Nebenstellen anlegen', 'extensions'],
    [config.trunks.length > 0, 'SIP-Konto für Anrufe nach außen einrichten', 'trunks'],
    [config.inbound.length > 0 || config.trunks.some((t) => t.inbound_default.type !== 'hangup'), 'Festlegen, wohin eingehende Anrufe gehen', 'flows'],
    [Boolean(config.mail.host), 'E-Mail-Versand für Voicemail und Einladungen', 'system'],
    [config.appprofiles.length > 0 || config.calendars.length > 0, 'Optional: App-Profile und zentrale Kalender für die Apps', 'appprofiles'],
  ]
  return (
    <Box>
      <PageHeader overline="Übersicht" title={config.system.name} description={`Telefonanlage · Version ${version}`} />
      {status?.update.available && (
        <Alert severity="info" sx={{ mb: 2 }} action={<Button onClick={() => go('system')}>Ansehen</Button>}>
          Version {status.update.latest?.version} ist verfügbar.
        </Alert>
      )}
      {status && status.asterisk !== 'running' && (
        <Alert severity={status.asterisk === 'starting' ? 'info' : 'error'} sx={{ mb: 2 }}>
          {status.asterisk === 'starting' ? 'Die Telefonanlage startet …' : status.message || 'Die Telefonanlage läuft nicht.'}
        </Alert>
      )}
      <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Stat
          label="Nebenstellen online"
          value={`${extOnline} / ${config.extensions.length}`}
          sub="mit mindestens einem Gerät"
          color={theme.m3.node.extension}
          icon={<PersonIcon />}
          onClick={() => go('extensions')}
        />
        <Stat
          label="SIP-Konten angemeldet"
          value={`${registered} / ${regTrunks.length}`}
          color={registered < regTrunks.length ? theme.palette.warning.main : theme.m3.node.number}
          icon={<CallIcon />}
          sub={registered < regTrunks.length ? 'Zugangsdaten prüfen' : 'alles in Ordnung'}
          onClick={() => go('trunks')}
        />
        <Stat
          label="Gespräche jetzt"
          value={calls.length}
          color={theme.palette.primary.main}
          icon={<PhoneInTalkIcon />}
          sub={status?.uptime ? `Anlage läuft seit ${formatDuration(Number(status.uptime))}` : ''}
          onClick={() => go('calls')}
        />
        <Stat
          label="Gesperrte Adressen"
          value={status?.bans.length ?? 0}
          color={status?.bans.length ? theme.palette.error.main : theme.m3.node.hangup}
          icon={<ShieldIcon />}
          sub="nach Fehlanmeldungen"
          onClick={() => go('system', 'sicherheit')}
        />
        <Stat
          label="Diagnose"
          value={worst === 'ok' ? 'In Ordnung' : worst === 'error' ? 'Störung' : 'Warnung'}
          color={worst === 'ok' ? theme.m3.node.number : worst === 'error' ? theme.palette.error.main : theme.palette.warning.main}
          icon={<MonitorHeartIcon />}
          sub={problems.length ? problems.map((c) => c.name).join(', ') : `${status?.watchdog.repairs ?? 0} Störungen selbst behoben`}
          onClick={() => go('system', 'diagnose')}
        />
      </Stack>
      {steps.some(([done]) => !done) && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="h6">Erste Schritte</Typography>
            <List dense>
              {steps.map(([done, text, page]) => (
                <ListItem key={text} secondaryAction={!done && <Button onClick={() => go(page)}>Öffnen</Button>}>
                  <ListItemIcon>{done ? <CheckCircleIcon color="success" /> : <RadioButtonUncheckedIcon />}</ListItemIcon>
                  <ListItemText primary={text} />
                </ListItem>
              ))}
            </List>
          </CardContent>
        </Card>
      )}
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 2, alignItems: 'flex-start' }}>
        <Card sx={{ flex: 1, width: '100%' }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Laufende Gespräche
            </Typography>
            {calls.length === 0 && <Typography sx={{ color: 'text.secondary' }}>Gerade wird nicht telefoniert.</Typography>}
            <List dense disablePadding>
              {calls.map((c) => {
                const answered = c.channels.some((x) => x.state === 'Up') && c.channels.length > 1
                return (
                  <ListItem key={c.id} disableGutters>
                    <ListItemText
                      primary={`${party(c.from, c.fromName) || 'Anonym'} → ${party(c.to, c.toName) || '…'}`}
                      secondary={`${answered ? 'Verbunden' : 'Klingelt / im Menü'} · ${formatDuration(Math.max(...c.channels.map((x) => x.duration)))}`}
                    />
                  </ListItem>
                )
              })}
            </List>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1, width: '100%' }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Funktionen am Telefon
            </Typography>
            {FEATURES.map(([code, text]) => (
              <Stack key={code} direction="row" sx={{ py: 0.5, gap: 2 }}>
                <Chip size="small" label={code} sx={{ minWidth: 110, fontFamily: 'monospace' }} />
                <Typography variant="body2">{text}</Typography>
              </Stack>
            ))}
          </CardContent>
        </Card>
      </Stack>
    </Box>
  )
}
