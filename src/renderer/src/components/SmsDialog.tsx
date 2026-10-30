/** SMS über die Telefonanlage senden (Recht „SMS“); Antworten kommen im Messenger an */

import SmsIcon from '@mui/icons-material/Sms'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { useApp } from '../state'

/** Länge einer SMS ohne Sonderzeichen; danach wird sie in Teilen verschickt */
const PART = 160

export function SmsDialog({ open, number = '', onClose }: { open: boolean; number?: string; onClose: () => void }) {
  const { toast } = useApp()
  const [to, setTo] = useState(number)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setTo(number)
    setText('')
  }, [open, number])
  const send = (): void => {
    setBusy(true)
    void api.pbxSendSms(to.trim(), text.trim()).then((r) => {
      setBusy(false)
      if (!r.ok) return toast(r.error)
      toast(`SMS an ${r.value} gesendet`)
      onClose()
    })
  }
  const parts = Math.max(1, Math.ceil(text.length / PART))
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>SMS senden</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <TextField label="Handynummer" value={to} onChange={(e) => setTo(e.target.value)} autoFocus={!number} slotProps={{ htmlInput: { inputMode: 'tel' } }} />
          <TextField
            label="Nachricht"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 1530))}
            multiline
            minRows={4}
            autoFocus={Boolean(number)}
            helperText={`${text.length} Zeichen${parts > 1 ? ` · ${parts} SMS` : ''}`}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Absender ist die Firma. Die Nachricht und Antworten darauf erscheinen im Messenger bei allen, die SMS nutzen dürfen.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" startIcon={<SmsIcon />} disabled={busy || !to.trim() || !text.trim()} onClick={send}>
          Senden
        </Button>
      </DialogActions>
    </Dialog>
  )
}
