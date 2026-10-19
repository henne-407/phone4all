/** SQL-Server-Kontaktquelle einrichten oder bearbeiten. */

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import type { SqlSourceConf } from '../../../../shared/types'
import { api } from '../../api'
import { useApp } from '../../state'
import { newId } from './parts'

const EXAMPLE_QUERY = 'SELECT Name AS name, Firma AS company, Telefon AS phone, Handy AS mobile\nFROM dbo.Kontakte'

export function SqlSourceDialog({ existing, onClose }: { existing?: SqlSourceConf; onClose: () => void }) {
  const { toast } = useApp()
  const [conf, setConf] = useState<SqlSourceConf>(
    existing ?? {
      id: newId(),
      name: '',
      host: '',
      port: 1433,
      database: '',
      user: '',
      mode: 'table',
      table: '',
      name_cols: '',
      company_col: '',
      phone_cols: '',
      query: EXAMPLE_QUERY,
    },
  )
  const [password, setPassword] = useState('')
  const [tables, setTables] = useState<[string, boolean][]>([])
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState<'connect' | 'save' | null>(null)

  useEffect(() => {
    if (existing) void api.sqlSecret(existing.id).then(setPassword)
  }, [existing])

  const set = <K extends keyof SqlSourceConf>(key: K, value: SqlSourceConf[K]): void => setConf((c) => ({ ...c, [key]: value }))
  const valid = conf.host.trim() && conf.database.trim() && conf.user.trim() && password

  const loadTables = async (): Promise<void> => {
    setBusy('connect')
    setStatus(null)
    const r = await api.sqlTables(conf, password)
    setBusy(null)
    if (!r.ok) return setStatus({ text: r.error, error: true })
    setTables(r.value)
    setStatus({ text: `Verbunden – ${r.value.length} Tabellen und Sichten gefunden`, error: false })
  }

  const chooseTable = async (table: string): Promise<void> => {
    set('table', table)
    const r = await api.sqlColumns({ ...conf, table }, password, table)
    if (!r.ok) return setStatus({ text: r.error, error: true })
    setConf((c) => ({ ...c, table, ...r.value.suggestion }))
    setStatus({ text: 'Spalten: ' + r.value.columns.join(', '), error: false })
  }

  const save = async (): Promise<void> => {
    setBusy('save')
    setStatus(null)
    const r = await api.sqlTestAndSave(conf, password)
    setBusy(null)
    if (!r.ok) return setStatus({ text: r.error, error: true })
    if (!r.value.count) {
      setStatus({ text: `${r.value.rows} Zeilen gelesen, aber keine mit Telefonnummer – bitte Spalten prüfen`, error: true })
      return
    }
    toast(`${r.value.count} Kontakte gefunden, z. B. ${r.value.sample}`)
    onClose()
  }

  const custom = conf.mode === 'query'
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>SQL-Server-Datenbank</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 1.5 }}>
          <Typography variant="subtitle1">Verbindung</Typography>
          <Stack direction="row" sx={{ gap: 1.5 }}>
            <TextField label="Server (Name oder IP, ggf. server\instanz)" value={conf.host} onChange={(e) => set('host', e.target.value)} autoFocus />
            <TextField
              label="Port"
              type="number"
              value={conf.port}
              onChange={(e) => set('port', Number(e.target.value) || 1433)}
              sx={{ maxWidth: 110 }}
            />
          </Stack>
          <TextField label="Datenbank" value={conf.database} onChange={(e) => set('database', e.target.value)} />
          <TextField label="Benutzer (SQL-Login oder DOMÄNE\benutzer)" value={conf.user} onChange={(e) => set('user', e.target.value)} />
          <TextField label="Passwort" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <TextField label="Anzeigename (optional, z. B. CRM)" value={conf.name} onChange={(e) => set('name', e.target.value)} />
          <Button variant="outlined" disabled={!valid || busy !== null} onClick={() => void loadTables()} sx={{ alignSelf: 'center' }}>
            {busy === 'connect' ? 'Verbinde …' : 'Verbinden'}
          </Button>

          <Typography variant="subtitle1" sx={{ mt: 1 }}>
            Kontaktdaten
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Spalten werden anhand ihrer Namen vorgeschlagen. Mehrere Spalten durch Komma trennen; Spalten mit „Handy“/„Mobil“ im
            Namen gelten als Mobilnummer.
          </Typography>
          <FormControlLabel
            control={<Switch checked={custom} onChange={(e) => set('mode', e.target.checked ? 'query' : 'table')} />}
            label="Eigene SQL-Abfrage verwenden (Spalten wie name, company, phone, mobile benennen)"
          />
          {custom ? (
            <TextField
              label="SQL-Abfrage"
              multiline
              minRows={4}
              value={conf.query}
              onChange={(e) => set('query', e.target.value)}
              slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
            />
          ) : (
            <>
              {tables.length ? (
                <TextField select label="Tabelle oder Sicht" value={tables.some(([t]) => t === conf.table) ? conf.table : ''} onChange={(e) => void chooseTable(e.target.value)}>
                  {tables.map(([name, view]) => (
                    <MenuItem key={name} value={name}>
                      {view ? `${name}  (Sicht)` : name}
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <TextField label="Gewählte Tabelle" value={conf.table || 'Erst „Verbinden“ drücken'} slotProps={{ input: { readOnly: true } }} />
              )}
              <TextField label="Spalte(n) für den Namen" value={conf.name_cols} onChange={(e) => set('name_cols', e.target.value)} />
              <TextField label="Spalte für die Firma (optional)" value={conf.company_col} onChange={(e) => set('company_col', e.target.value)} />
              <TextField label="Spalten mit Telefonnummern" value={conf.phone_cols} onChange={(e) => set('phone_cols', e.target.value)} />
            </>
          )}
          {status && <Alert severity={status.error ? 'error' : 'success'}>{status.text}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" disabled={!valid || busy !== null} onClick={() => void save()}>
          {busy === 'save' ? 'Teste …' : 'Testen und speichern'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
