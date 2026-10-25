/** Externe Kontakt- und Kalenderquellen: Formularfelder, Stand des Abgleichs. */

import CloudSyncIcon from '@mui/icons-material/CloudSync'
import SyncIcon from '@mui/icons-material/Sync'
import { Box, Button, Chip, IconButton, List, ListItem, ListItemButton, ListItemText, Stack, Switch, TextField, Tooltip } from '@mui/material'
import { useEffect, useState } from 'react'
import type { CalendarSource, ContactSource } from '../../../server/model'
import { api } from '../api'
import { usePbx } from '../state'
import { FormGrid, Full, NumberField, Section, Select, StatusDot, useEditor } from './common'

export interface SourceStatus {
  synced: number
  error: string
  count: number
  running: boolean
}

/** Stand aller Quellen, regelmäßig aufgefrischt */
export function useSourceStatus(): [Record<string, SourceStatus>, (id: string) => Promise<void>] {
  const [status, setStatus] = useState<Record<string, SourceStatus>>({})
  const load = (): void => void api.get<Record<string, SourceStatus>>('/api/sources').then(setStatus).catch(() => undefined)
  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])
  const sync = async (id: string): Promise<void> => {
    setStatus((s) => ({ ...s, [id]: { ...(s[id] ?? { synced: 0, error: '', count: 0 }), running: true } }))
    const next = await api.post<SourceStatus>(`/api/sources/${id}/sync`)
    setStatus((s) => ({ ...s, [id]: next }))
  }
  return [status, sync]
}

export function SourceState({ status, unit }: { status: SourceStatus | undefined; unit: string }) {
  if (!status || (!status.synced && !status.running)) return <StatusDot color="default" label="noch nicht gelesen" />
  if (status.running) return <StatusDot color="warning" label="wird gelesen …" />
  if (status.error) return <StatusDot color="error" label={status.error} />
  const time = new Date(status.synced).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return <StatusDot color="success" label={`${status.count} ${unit} · ${time}`} />
}

/** Zugangsdaten eines Servers (CardDAV, CalDAV, Datei mit Anmeldung) */
function Login({ user, password, onChange }: { user: string; password: string; onChange: (v: { user?: string; password?: string }) => void }) {
  return (
    <>
      <TextField label="Benutzer" value={user} onChange={(e) => onChange({ user: e.target.value })} autoComplete="off" helperText="Leer = ohne Anmeldung" />
      <TextField label="Passwort" type="password" value={password} onChange={(e) => onChange({ password: e.target.value })} autoComplete="new-password" helperText="Bei Nextcloud & Co. ein App-Passwort" />
    </>
  )
}

export function CalendarSourceFields({ value, onChange }: { value: CalendarSource; onChange: (v: CalendarSource) => void }) {
  const set = (patch: Partial<CalendarSource>): void => onChange({ ...value, ...patch })
  return (
    <>
      <Select
        label="Quelle"
        value={value.type}
        onChange={(type) => set({ type })}
        options={[
          ['ics', 'Kalender-Abo (ICS / webcal)'],
          ['caldav', 'CalDAV-Kalender'],
        ]}
      />
      <NumberField label="Alle … Minuten lesen" value={value.refresh_minutes} onChange={(refresh_minutes) => set({ refresh_minutes })} min={5} />
      <Full>
        <TextField
          fullWidth
          label="Adresse"
          value={value.url}
          onChange={(e) => set({ url: e.target.value })}
          helperText={
            value.type === 'ics'
              ? 'z. B. Freigabe-Link aus Google, Outlook/Exchange oder Nextcloud (…/calendars/…?export)'
              : 'Adresse des Kalenders, z. B. https://cloud.firma.de/remote.php/dav/calendars/team/betrieb/'
          }
        />
      </Full>
      <Login user={value.user} password={value.password} onChange={set} />
    </>
  )
}

function ContactSourceForm({ value, onChange }: { value: ContactSource; onChange: (v: ContactSource) => void }) {
  const set = (patch: Partial<ContactSource>): void => onChange({ ...value, ...patch })
  return (
    <FormGrid>
      <TextField label="Name" value={value.name} onChange={(e) => set({ name: e.target.value })} required autoFocus helperText="z. B. „CRM“ oder „Nextcloud“" />
      <Select
        label="Art"
        value={value.type}
        onChange={(type) => set({ type })}
        options={[
          ['carddav', 'CardDAV (Nextcloud, iCloud, mailbox.org …)'],
          ['url', 'vCard- oder CSV-Datei im Netz'],
          ['mssql', 'Microsoft SQL Server (CRM, Warenwirtschaft)'],
        ]}
      />
      {value.type !== 'mssql' ? (
        <>
          <Full>
            <TextField
              fullWidth
              label="Adresse"
              value={value.url}
              onChange={(e) => set({ url: e.target.value })}
              helperText={value.type === 'carddav' ? 'Server, Konto oder einzelnes Adressbuch – alle Adressbücher des Kontos werden gelesen' : 'Adresse einer .vcf- oder .csv-Datei'}
            />
          </Full>
          <Login user={value.user} password={value.password} onChange={set} />
        </>
      ) : (
        <>
          <TextField label="Server" value={value.host} onChange={(e) => set({ host: e.target.value })} helperText="Name oder IP, auch server\instanz" />
          <NumberField label="Port" value={value.port} onChange={(port) => set({ port })} min={1} />
          <TextField label="Datenbank" value={value.database} onChange={(e) => set({ database: e.target.value })} />
          <Box />
          <Login user={value.user} password={value.password} onChange={set} />
          <Select
            label="Lesen aus"
            value={value.mode}
            onChange={(mode) => set({ mode })}
            options={[
              ['table', 'Tabelle oder Sicht'],
              ['query', 'Eigene SQL-Abfrage'],
            ]}
          />
          <Box />
          {value.mode === 'table' ? (
            <>
              <TextField label="Tabelle oder Sicht" value={value.table} onChange={(e) => set({ table: e.target.value })} helperText="z. B. dbo.Kunden" />
              <TextField label="Namensspalten" value={value.name_cols} onChange={(e) => set({ name_cols: e.target.value })} helperText="Komma-getrennt, z. B. Vorname, Nachname" />
              <TextField label="Firmenspalte" value={value.company_col} onChange={(e) => set({ company_col: e.target.value })} />
              <TextField label="Telefonspalten" value={value.phone_cols} onChange={(e) => set({ phone_cols: e.target.value })} helperText="Komma-getrennt; „Mobil“/„Handy“ im Namen = Mobilnummer" />
            </>
          ) : (
            <Full>
              <TextField
                fullWidth
                multiline
                minRows={3}
                label="SELECT-Abfrage"
                value={value.query}
                onChange={(e) => set({ query: e.target.value })}
                helperText="Spaltennamen wie Name, Firma, Telefon, Mobil werden erkannt"
                slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
              />
            </Full>
          )}
        </>
      )}
      <NumberField label="Alle … Minuten lesen" value={value.refresh_minutes} onChange={(refresh_minutes) => set({ refresh_minutes })} min={5} />
    </FormGrid>
  )
}

const TYPE_LABEL: Record<ContactSource['type'], string> = { carddav: 'CardDAV', url: 'Datei', mssql: 'SQL Server' }

/** Abschnitt auf der Kontakte-Seite */
export function ContactSources() {
  const { config, saveItem, toast } = usePbx()
  const editor = useEditor<ContactSource>('contactsources', 'Kontaktquelle', ContactSourceForm)
  const [status, sync] = useSourceStatus()
  return (
    <Section
      icon={<CloudSyncIcon />}
      title="Externe Kontaktquellen"
      description="Die Anlage liest diese Adressbücher regelmäßig (nur lesen). Die Kontakte erscheinen in allen Apps, auf DECT- und Tischtelefonen (LDAP) und bei eingehenden Anrufen als Name."
      action={<Button onClick={() => editor.openNew()}>Quelle hinzufügen</Button>}
    >
      {config.contactsources.length ? (
        <List disablePadding>
          {config.contactsources.map((s) => (
            <ListItem
              key={s.id}
              disablePadding
              secondaryAction={
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                  <Tooltip title="Jetzt lesen">
                    <span>
                      <IconButton onClick={() => void sync(s.id)} disabled={!s.enabled || status[s.id]?.running}>
                        <SyncIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Switch
                    checked={s.enabled}
                    onChange={(e) =>
                      void saveItem('contactsources', { ...s, enabled: e.target.checked }).catch((err: Error) => toast(err.message, 'error'))
                    }
                    slotProps={{ input: { 'aria-label': 'Eingeschaltet' } }}
                  />
                </Stack>
              }
            >
              <ListItemButton onClick={() => editor.openItem(s.id)} sx={{ pr: 14 }}>
                <ListItemText
                  primary={
                    <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                      {s.name}
                      <Chip size="small" label={TYPE_LABEL[s.type]} />
                    </Stack>
                  }
                  secondary={s.enabled ? <SourceState status={status[s.id]} unit="Kontakte" /> : 'ausgeschaltet'}
                  slotProps={{ secondary: { component: 'div' } }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      ) : (
        <Box sx={{ color: 'text.secondary' }}>Noch keine. Zum Beispiel das Adressbuch aus Nextcloud oder die Kunden aus der Warenwirtschaft.</Box>
      )}
      {editor.dialog}
    </Section>
  )
}
