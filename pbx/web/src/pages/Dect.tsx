/** DECT-Telefone: Gigaset-Basen (N610, N670, N870 IP PRO) mit ihren Mobilteilen. */

import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DownloadIcon from '@mui/icons-material/Download'
import SettingsPhoneIcon from '@mui/icons-material/SettingsPhone'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Link,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { type ReactNode, useEffect, useState } from 'react'
import { DECT_MAX_HANDSETS, type DectBase } from '../../../server/model'
import { api } from '../api'
import { CollectionPage, ConfirmDialog, FormGrid, FormHeading, Full, Select, StatusDot } from '../components/common'
import { go } from '../router'
import { usePbx } from '../state'
import { useStatus } from '../useStatus'

export interface DectInfo {
  ldap: { listening: boolean; port: number; error: string }
  /** Adresse der Anlage im LAN (für Telefonbuch und SIP) */
  host: string
  bases: { id: string; url: string; seen: { time: number; ip: string; agent: string; mac: string } | null }[]
}

export function useDectInfo(deps: unknown[] = []): DectInfo | null {
  const [info, setInfo] = useState<DectInfo | null>(null)
  useEffect(() => {
    const load = (): void => void api.get<DectInfo>('/api/dect').then(setInfo).catch(() => undefined)
    load()
    // Der LDAP-Dienst startet nach dem Speichern mit kurzer Verzögerung
    const t = setTimeout(load, 1500)
    return () => clearTimeout(t)
  }, deps)
  return info
}

/** Filter für Gigaset-Telefonbücher: % steht für die Eingabe am Mobilteil */
export const LDAP_NAME_FILTER = '(|(cn=%)(sn=%)(o=%))'
export const LDAP_NUMBER_FILTER = '(|(telephoneNumber=%)(mobile=%))'

function useCopy(): (text: string) => void {
  const { toast } = usePbx()
  return (text) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => toast('Kopiert'))
      .catch(() => toast('Kopieren nicht möglich', 'error'))
}

/** Nur-Lese-Feld mit Kopierknopf */
export function CopyField({ label, value, helperText }: { label: string; value: string; helperText?: ReactNode }) {
  const copy = useCopy()
  return (
    <TextField
      label={label}
      value={value}
      helperText={helperText}
      onFocus={(e) => e.target.select()}
      slotProps={{
        input: {
          readOnly: true,
          sx: { fontFamily: 'monospace' },
          endAdornment: (
            <InputAdornment position="end">
              <IconButton aria-label="Kopieren" onClick={() => copy(value)} edge="end">
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  )
}

const formatMac = (mac: string): string => mac.toUpperCase().match(/.{1,2}/g)?.join(':') ?? ''

function BaseForm({ value, onChange }: { value: DectBase; onChange: (v: DectBase) => void }) {
  const { config } = usePbx()
  const set = <K extends keyof DectBase>(k: K, v: DectBase[K]): void => onChange({ ...value, [k]: v })
  // Nebenstellen an anderen Basen stehen hier nicht zur Wahl
  const taken = new Set(config.dect.filter((b) => b.id !== value.id).flatMap((b) => b.handsets))
  const setHandset = (i: number, n: string): void => {
    const list = [...value.handsets]
    list[i] = n
    // Freie Plätze am Ende fallen weg, in der Mitte bleiben sie (Nummer des Mobilteils)
    while (list.length && !list[list.length - 1]) list.pop()
    set('handsets', list)
  }
  const rows = value.handsets.length ? value.handsets : ['']
  return (
    <FormGrid>
      <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required autoFocus helperText="z. B. „Büro“ oder „Lager“" />
      <TextField
        label="MAC-Adresse"
        value={value.mac.length === 12 ? formatMac(value.mac) : value.mac}
        onChange={(e) => set('mac', e.target.value.replace(/[\s:.-]/g, '').toLowerCase())}
        helperText="Steht auf der Unterseite der Basis. Leer = jede Basis mit dem Link"
      />
      <Full>
        <FormHeading hint={`Jedes Mobilteil ist eine eigene Nebenstelle. Höchstens ${DECT_MAX_HANDSETS} Mobilteile.`}>Mobilteile</FormHeading>
        <Stack sx={{ gap: 1.5 }}>
          {rows.map((n, i) => {
            const options: [string, string][] = [
              ['', 'Frei'],
              ...config.extensions.filter((e) => e.number === n || (!taken.has(e.number) && !value.handsets.includes(e.number))).map((e): [string, string] => [e.number, `${e.number} · ${e.name}`]),
            ]
            return (
              <Stack key={i} direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                <Typography sx={{ width: 104, flexShrink: 0, color: 'text.secondary' }}>Mobilteil {i + 1}</Typography>
                <Box sx={{ flex: 1, display: 'grid' }}>
                  <Select label="Nebenstelle" value={n} onChange={(v) => setHandset(i, v)} options={options} />
                </Box>
                <Tooltip title="Entfernen">
                  <span>
                    <IconButton aria-label="Entfernen" disabled={!n} onClick={() => setHandset(i, '')}>
                      <CloseIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            )
          })}
        </Stack>
        {value.handsets.length > 0 && value.handsets.length < DECT_MAX_HANDSETS && (
          <Button startIcon={<AddIcon />} sx={{ mt: 1.5 }} onClick={() => set('handsets', [...value.handsets, ''])}>
            Mobilteil hinzufügen
          </Button>
        )}
      </Full>
      <Full>
        <FormHeading hint="Setzt beim nächsten Abruf das Passwort für die Weboberfläche der Basis (Benutzer admin). Leer lassen, um nichts zu ändern.">
          Zugang zur Basis
        </FormHeading>
        <TextField
          type="password"
          label="Neues Passwort der Basis"
          value={value.admin_password}
          onChange={(e) => set('admin_password', e.target.value)}
          autoComplete="new-password"
          fullWidth
        />
      </Full>
    </FormGrid>
  )
}

function ago(time: number): string {
  const min = Math.round((Date.now() - time) / 60000)
  if (min < 1) return 'gerade eben'
  if (min < 60) return `vor ${min} Min.`
  const h = Math.round(min / 60)
  return h < 24 ? `vor ${h} Std.` : new Date(time).toLocaleString('de-DE')
}

/** Schritt-für-Schritt-Anleitung für die Einrichtung an der Basis */
function SetupDialog({ base, info, onClose }: { base: DectBase; info: DectInfo; onClose: () => void }) {
  const { config, reload, toast } = usePbx()
  const [confirm, setConfirm] = useState(false)
  const url = info.bases.find((b) => b.id === base.id)?.url ?? ''
  const ldap = config.ldap
  const renew = (): void =>
    void api
      .post(`/api/dect/${base.id}/renew`)
      .then(reload)
      .then(() => toast('Neuer Link und neue PIN erzeugt'))
      .catch((e: Error) => toast(e.message, 'error'))
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{base.name} einrichten</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2.5, pt: 1 }}>
          <Box>
            <FormHeading hint="Die Adresse der Basis zeigt die FRITZ!Box oder der Router unter den Netzwerkgeräten. Anmeldung mit admin (ab Werk Passwort admin).">
              1. Weboberfläche der Basis öffnen
            </FormHeading>
            <Typography variant="body2">
              Unter <b>Einstellungen → System → Provisioning und Konfiguration</b> diese Adresse als <b>Provisioning-Server</b> eintragen, speichern und
              die Auto-Konfiguration starten (oder die Basis neu starten).
            </Typography>
          </Box>
          <CopyField
            label="Provisioning-Server"
            value={url}
            helperText={
              config.system.sip_host
                ? 'Mit der Adresse aus System → Allgemein.'
                : 'Die Basis muss die Anlage unter dieser Adresse erreichen. Sonst unter System → Allgemein die Adresse der Anlage im LAN eintragen.'
            }
          />
          <Box>
            <FormHeading hint="Nach jedem Abruf ist die Anmeldung 15 Minuten lang offen.">2. Mobilteile anmelden</FormHeading>
            <Typography variant="body2">
              Am Mobilteil <b>Menü → Einstellungen → Anmeldung → Mobilteil anmelden</b> wählen und die PIN <b style={{ fontFamily: 'monospace', fontSize: 16 }}>{base.pin}</b>{' '}
              eingeben. Die Mobilteile am besten in der Reihenfolge der Liste anmelden, dann passt die Zuordnung zu den Nebenstellen.
            </Typography>
          </Box>
          <Box>
            <FormHeading hint="Suchen im zentralen Telefonbuch am Mobilteil">3. Telefonbuch (LDAP)</FormHeading>
            {ldap.enabled ? (
              <>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  In der Basis unter <b>Einstellungen → Online-Telefonbücher → Firmen-Telefonbuch (LDAP)</b> ein Telefonbuch anlegen:
                </Typography>
                <FormGrid>
                  <CopyField label="Server" value={info.host} />
                  <CopyField label="Port" value={String(ldap.port)} />
                  <CopyField label="Suchbasis (BaseDN)" value="dc=phone4all" />
                  {ldap.password && <CopyField label="Benutzername" value="cn=telefonbuch,dc=phone4all" />}
                  <CopyField label="Namensfilter" value={LDAP_NAME_FILTER} />
                  <CopyField label="Nummernfilter" value={LDAP_NUMBER_FILTER} />
                  <CopyField label="Anzeigeformat" value="%cn" helperText="Vorname givenName, Nachname sn, Firma o, Telefon telephoneNumber, Mobil mobile" />
                  <CopyField label="Sichere Verbindung" value="Keine" />
                </FormGrid>
                {ldap.password && (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Als Kennwort das Telefonbuch-Kennwort von der Seite Kontakte eintragen. Alternativ meldet die Anmeldeart „SIP“ jedes Mobilteil mit seinem eigenen
                    SIP-Zugang an.
                  </Typography>
                )}
              </>
            ) : (
              <Alert
                severity="info"
                variant="outlined"
                action={
                  <Button color="inherit" onClick={() => go('phonebook')}>
                    Zu den Kontakten
                  </Button>
                }
              >
                Das LDAP-Telefonbuch ist ausgeschaltet. Es lässt sich auf der Seite Kontakte einschalten.
              </Alert>
            )}
          </Box>
          <Alert severity="info" variant="outlined">
            Rufnummern der Nebenstellen kommen von der Anlage: Bei neuer Voicemail blinkt die Nachrichtentaste (Abhören mit *97), Übergeben geht mit der R-Taste
            oder durch Auflegen. Mobilteile, die nicht hier stehen, löscht die Basis nicht – das geht in ihrer Weboberfläche.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => setConfirm(true)} sx={{ mr: 'auto' }}>
          Neuen Link erzeugen
        </Button>
        <Button startIcon={<DownloadIcon />} href={`/api/dect/${base.id}/file`}>
          Datei herunterladen
        </Button>
        <Button variant="contained" onClick={onClose}>
          Fertig
        </Button>
      </DialogActions>
      <ConfirmDialog
        open={confirm}
        title="Neuen Link und neue PIN erzeugen?"
        text="Der bisherige Provisioning-Server wird ungültig und muss in der Basis neu eingetragen werden."
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

export default function Dect() {
  const { config } = usePbx()
  const [status] = useStatus(10000)
  const info = useDectInfo([config.dect.map((b) => b.id + b.token).join()])
  const [setup, setSetup] = useState<DectBase | null>(null)
  const devices = (n: string): number => status?.endpoints.find((e) => e.number === n)?.contacts.length ?? 0
  return (
    <>
      <CollectionPage<DectBase>
        kind="dect"
        overline="Personen"
        title="DECT-Telefone"
        singular="DECT-Basis"
        description="Gigaset-Basen der Reihe N610, N670 und N870 IP PRO holen sich ihre Einrichtung von der Anlage: ein SIP-Konto je Mobilteil, Voicemail-Anzeige und Übergabe. Änderungen übernimmt die Basis beim nächsten Abruf."
        emptyText="Nach dem Anlegen zeigt „Einrichten“, was in der Basis einzutragen ist."
        emptyIcon={<SettingsPhoneIcon />}
        card={(b) => {
          const seen = info?.bases.find((x) => x.id === b.id)?.seen
          const list = b.handsets.map((n, i) => [i, n] as const).filter(([, n]) => n)
          return (
            <Box>
              <Typography variant="h6">{b.name}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
                {b.mac ? formatMac(b.mac) : 'Ohne MAC-Adresse'}
                {seen ? ` · abgerufen ${ago(seen.time)}${seen.agent ? ` · ${seen.agent}` : ''}` : ' · noch nicht abgerufen'}
              </Typography>
              {list.length ? (
                <Stack sx={{ gap: 0.75 }}>
                  {list.map(([i, n]) => {
                    const ext = config.extensions.find((e) => e.number === n)
                    const on = devices(n) > 0
                    return (
                      <Stack key={i} direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ width: 28, color: 'text.secondary' }}>
                          {i + 1}
                        </Typography>
                        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                          <b>{n}</b> {ext?.name}
                        </Typography>
                        <StatusDot color={on ? 'success' : 'default'} label={on ? 'angemeldet' : 'nicht angemeldet'} />
                      </Stack>
                    )
                  })}
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Noch keine Mobilteile zugeordnet
                </Typography>
              )}
            </Box>
          )
        }}
        extraActions={(b) => (
          <Button size="small" variant="outlined" disabled={!info} onClick={() => setSetup(b)}>
            Einrichten
          </Button>
        )}
        after={
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }}>
            Andere DECT-Basen (z. B. Gigaset N300, Yealink W-Serie) lassen sich von Hand mit den SIP-Daten der Nebenstellen einrichten. Das zentrale Telefonbuch
            steht per LDAP bereit, siehe <Link component="button" variant="body2" onClick={() => go('phonebook')}>Kontakte</Link>.
          </Typography>
        }
        Form={BaseForm}
      />
      {setup && info && <SetupDialog base={config.dect.find((b) => b.id === setup.id) ?? setup} info={info} onClose={() => setSetup(null)} />}
    </>
  )
}
