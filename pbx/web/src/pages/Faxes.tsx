import CallMadeIcon from '@mui/icons-material/CallMade'
import CallReceivedIcon from '@mui/icons-material/CallReceived'
import DeleteIcon from '@mui/icons-material/Delete'
import FaxIcon from '@mui/icons-material/Fax'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import SendIcon from '@mui/icons-material/Send'
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import type { FaxBox } from '../../../server/model'
import { api } from '../api'
import { CollectionPage, FormGrid, Full, Select } from '../components/common'
import { usePbx } from '../state'

interface FaxRecord {
  id: string
  box: string
  direction: 'in' | 'out'
  time: number
  number: string
  station: string
  pages: number
  status: 'queued' | 'sending' | 'ok' | 'failed'
  error: string
  by: string
  attempts: number
}

const STATUS: Record<FaxRecord['status'], [string, 'default' | 'info' | 'success' | 'error']> = {
  queued: ['Wartet', 'default'],
  sending: ['Wird gesendet', 'info'],
  ok: ['Erledigt', 'success'],
  failed: ['Fehlgeschlagen', 'error'],
}

function FaxForm({ value, onChange }: { value: FaxBox; onChange: (v: FaxBox) => void }) {
  const set = <K extends keyof FaxBox>(k: K, v: FaxBox[K]): void => onChange({ ...value, [k]: v })
  return (
    <FormGrid>
      <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required autoFocus helperText="z. B. Fax Büro" />
      <TextField label="E-Mail für empfangene Faxe" value={value.email} onChange={(e) => set('email', e.target.value)} required helperText="Mehrere Adressen mit Komma trennen; dorthin gehen auch die Sendeberichte" />
      <TextField label="Faxkennung" value={value.station} onChange={(e) => set('station', e.target.value)} helperText="Erscheint beim Empfänger, z. B. +49 30 1234567" />
      <TextField label="Kopfzeile" value={value.header} onChange={(e) => set('header', e.target.value)} helperText="Oben auf jeder gesendeten Seite, z. B. der Firmenname" />
      <TextField label="Absendernummer" value={value.cid} onChange={(e) => set('cid', e.target.value)} helperText="Eigene Faxnummer beim Senden (leer = Standard des SIP-Kontos)" />
      <TextField label="Interne Nummer (optional)" value={value.number} onChange={(e) => set('number', e.target.value.replace(/\D/g, ''))} helperText="Zum Testen von einem Telefon aus" />
      <Full>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Damit Faxe ankommen, unter Rufabfolgen die Faxnummer auf dieses Fax leiten. Wenn das SIP-Konto T.38 kann, dort „Fax über T.38“ einschalten – das ist zuverlässiger als Fax als Ton.
        </Typography>
      </Full>
    </FormGrid>
  )
}

function SendDialog({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: () => void }) {
  const { config, toast } = usePbx()
  const [box, setBox] = useState('')
  const [number, setNumber] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setBox(config.faxes[0]?.id ?? '')
      setNumber('')
      setFile(null)
    }
  }, [open, config.faxes])
  const send = (): void => {
    if (!file) return
    setBusy(true)
    void file
      .arrayBuffer()
      .then((buf) => api.post(`/api/faxes/send?box=${encodeURIComponent(box)}&number=${encodeURIComponent(number)}`, buf))
      .then(() => {
        toast('Fax wird gesendet – der Sendebericht kommt per E-Mail')
        onSent()
        onClose()
      })
      .catch((e: Error) => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Fax senden</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {config.faxes.length > 1 && <Select label="Absender" value={box} onChange={setBox} options={config.faxes.map((f) => [f.id, f.name] as [string, string])} />}
          <TextField label="Faxnummer" value={number} onChange={(e) => setNumber(e.target.value)} autoFocus helperText="Wie am Telefon, z. B. 030 1234567" />
          <Button component="label" variant="outlined" startIcon={<PictureAsPdfIcon />}>
            {file ? file.name : 'PDF auswählen'}
            <input hidden type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Button>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Die Anlage wählt bis zu dreimal (bei Besetzt oder ohne Antwort im Abstand von zwei Minuten).
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" startIcon={<SendIcon />} disabled={!file || !number.trim() || !box || busy} onClick={send}>
          Senden
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function FaxList() {
  const { config, toast } = usePbx()
  const [list, setList] = useState<FaxRecord[] | null>(null)
  const [send, setSend] = useState(false)
  const load = (): void => void api.get<FaxRecord[]>('/api/faxes').then(setList)
  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])
  const boxName = (id: string): string => config.faxes.find((f) => f.id === id)?.name ?? '–'
  const who = (n: string): string => (n === 'Verwaltung' ? n : `${n} ${config.extensions.find((e) => e.number === n)?.name ?? ''}`.trim())
  if (!config.faxes.length) return null
  return (
    <Box sx={{ mt: 4 }}>
      <Stack direction="row" sx={{ alignItems: 'center', mb: 1.5 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          Gesendet und empfangen
        </Typography>
        <Button variant="contained" startIcon={<SendIcon />} onClick={() => setSend(true)}>
          Fax senden
        </Button>
      </Stack>
      <Card>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell />
                <TableCell>Zeit</TableCell>
                <TableCell>Fax</TableCell>
                <TableCell>Gegenstelle</TableCell>
                <TableCell>Seiten</TableCell>
                <TableCell>Stand</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {list?.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>
                    <Tooltip title={f.direction === 'in' ? 'Empfangen' : `Gesendet von ${who(f.by)}`}>
                      {f.direction === 'in' ? <CallReceivedIcon color="primary" fontSize="small" /> : <CallMadeIcon color="primary" fontSize="small" />}
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(f.time).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</TableCell>
                  <TableCell>{boxName(f.box)}</TableCell>
                  <TableCell>
                    {f.number || 'unbekannt'}
                    {f.station && (
                      <Box component="span" sx={{ color: 'text.secondary', ml: 1 }}>
                        {f.station}
                      </Box>
                    )}
                  </TableCell>
                  <TableCell>{f.pages || '–'}</TableCell>
                  <TableCell>
                    <Tooltip title={f.error}>
                      <Chip size="small" variant="outlined" color={STATUS[f.status][1]} label={f.status === 'queued' && f.attempts ? `Neuer Versuch (${f.attempts}/3)` : STATUS[f.status][0]} />
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {f.pages > 0 && (
                      <Tooltip title="PDF öffnen">
                        <IconButton size="small" component="a" href={`/api/faxes/${f.id}/pdf`} target="_blank">
                          <PictureAsPdfIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {f.status !== 'sending' && (
                      <Tooltip title="Löschen">
                        <IconButton
                          size="small"
                          onClick={() =>
                            void api
                              .del<FaxRecord[]>(`/api/faxes/${f.id}`)
                              .then(setList)
                              .catch((e: Error) => toast(e.message, 'error'))
                          }
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {list && !list.length && <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>Noch keine Faxe. Sie bleiben 30 Tage in der Liste.</Box>}
      </Card>
      {!config.mail.host && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          Für Fax per E-Mail zuerst unter System → E-Mail einen Mailserver eintragen.
        </Alert>
      )}
      <SendDialog open={send} onClose={() => setSend(false)} onSent={load} />
    </Box>
  )
}

export default function Faxes() {
  return (
    <CollectionPage<FaxBox>
      kind="faxes"
      overline="Zusammenarbeit"
      title="Fax"
      singular="Fax"
      description="Faxe kommen als PDF per E-Mail an; gesendet wird ein PDF aus der Weboberfläche oder der Desktop-App. Ein Faxgerät braucht es dafür nicht."
      emptyIcon={<FaxIcon />}
      emptyText="Noch kein Fax eingerichtet."
      columns={[
        { label: 'Name', render: (f) => <b>{f.name}</b> },
        { label: 'E-Mail', render: (f) => f.email },
        { label: 'Kennung', render: (f) => f.station || '–' },
        { label: 'Intern', render: (f) => f.number || '–' },
      ]}
      Form={FaxForm}
      after={<FaxList />}
    />
  )
}
