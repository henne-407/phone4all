/** Fax senden über die Telefonanlage (Recht „Faxe senden“): PDF wählen oder hineinziehen */

import FaxIcon from '@mui/icons-material/Fax'
import UploadIcon from '@mui/icons-material/UploadFile'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { formatTime } from '../../../shared/format'
import type { PbxFax } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../state'

const STATUS: Record<PbxFax['status'], string> = {
  queued: 'wartet',
  sending: 'wird gesendet',
  ok: 'gesendet',
  failed: 'fehlgeschlagen',
}

export function FaxDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useApp()
  const [boxes, setBoxes] = useState<{ id: string; name: string }[]>([])
  const [sent, setSent] = useState<PbxFax[]>([])
  const [box, setBox] = useState('')
  const [number, setNumber] = useState('')
  const [file, setFile] = useState<{ name: string; data: Uint8Array } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)

  const load = (): void =>
    void api.pbxFaxInfo().then((r) => {
      if (!r.ok) return setError(r.error)
      setBoxes(r.value.boxes)
      setSent(r.value.sent)
      setBox((b) => b || r.value.boxes[0]?.id || '')
    })

  useEffect(() => {
    if (!open) return
    setError('')
    setFile(null)
    setNumber('')
    load()
    // Status der gesendeten Faxe nachladen, solange der Dialog offen ist
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [open])

  const pick = (): void =>
    void api.pickPdf().then((r) => {
      if (!r.ok) setError(r.error)
      else if (r.value) setFile(r.value)
    })

  const drop = (e: React.DragEvent): void => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files[0]
    if (!f) return
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return setError('Bitte eine PDF-Datei wählen.')
    if (f.size > 20 * 1024 * 1024) return setError('Die Datei ist größer als 20 MB.')
    void f.arrayBuffer().then((b) => setFile({ name: f.name, data: new Uint8Array(b) }))
  }

  const send = async (): Promise<void> => {
    if (!file) return
    setBusy(true)
    setError('')
    const r = await api.pbxSendFax(box, number.trim(), file.data)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    toast('Das Fax wird gesendet')
    setFile(null)
    setNumber('')
    load()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Fax senden</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          {boxes.length > 1 && (
            <TextField select label="Absender" value={box} onChange={(e) => setBox(e.target.value)}>
              {boxes.map((b) => (
                <MenuItem key={b.id} value={b.id}>
                  {b.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            label="Faxnummer"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            slotProps={{ htmlInput: { inputMode: 'tel' } }}
          />
          <Box
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={drop}
            sx={{
              border: 2,
              borderStyle: 'dashed',
              borderColor: over ? 'primary.main' : 'divider',
              borderRadius: 2,
              p: 2,
              textAlign: 'center',
            }}
          >
            <Typography sx={{ mb: 1 }}>{file ? file.name : 'PDF hierher ziehen'}</Typography>
            <Button startIcon={<UploadIcon />} onClick={pick}>
              {file ? 'Andere Datei …' : 'PDF auswählen …'}
            </Button>
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
          {sent.length > 0 && (
            <Box>
              <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                Zuletzt gesendet
              </Typography>
              <List dense disablePadding>
                {sent.slice(0, 10).map((f) => (
                  <ListItem key={f.id} disableGutters>
                    <ListItemText
                      primary={f.number}
                      secondary={[formatTime(Math.floor(f.time / 1000)), `${f.pages || '?'} S.`, STATUS[f.status], f.error].filter(Boolean).join(' · ')}
                      slotProps={{ secondary: { sx: { color: f.status === 'failed' ? 'error.main' : undefined } } }}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Schließen</Button>
        <Button variant="contained" startIcon={<FaxIcon />} disabled={busy || !file || !box || !number.trim()} onClick={() => void send()}>
          Senden
        </Button>
      </DialogActions>
    </Dialog>
  )
}
