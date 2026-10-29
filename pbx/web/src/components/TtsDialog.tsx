/** Ansage aus Text erzeugen (Piper auf der Anlage) */

import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { ApiError, api } from '../api'

interface TtsInfo {
  installed: boolean
  voices: string[]
  installing: string
  error: string
  all: { id: string; name: string }[]
}

const MAX = 2000

async function speak(text: string, voice: string): Promise<ArrayBuffer> {
  const r = await fetch('/api/tts/speak', {
    method: 'POST',
    headers: { 'x-phone4all': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
    credentials: 'same-origin',
  })
  if (!r.ok) {
    let message = r.statusText
    try {
      message = ((await r.json()) as { error: string }).error || message
    } catch {
      // keine JSON-Antwort
    }
    throw new ApiError(r.status, message)
  }
  return r.arrayBuffer()
}

export function TtsDialog({ open, onClose, onResult }: { open: boolean; onClose: () => void; onResult: (wav: ArrayBuffer) => Promise<void> }) {
  const [info, setInfo] = useState<TtsInfo | null>(null)
  const [voice, setVoice] = useState('thorsten')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ url: string; data: ArrayBuffer } | null>(null)

  const load = (): Promise<void> => api.get<TtsInfo>('/api/tts').then(setInfo)
  useEffect(() => {
    if (open) void load().catch(() => undefined)
  }, [open])
  // Während des Ladens den Fortschritt abfragen
  useEffect(() => {
    if (!open || !info?.installing) return
    const t = setInterval(() => void load().catch(() => undefined), 2000)
    return () => clearInterval(t)
  }, [open, info?.installing])
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url)
    },
    [preview],
  )

  const ready = Boolean(info?.installed && info.voices.includes(voice))
  const install = (): void => {
    setError('')
    void api
      .post<TtsInfo>('/api/tts/install', { voice })
      .then((s) => setInfo((i) => (i ? { ...i, ...s, installing: s.installing || voice } : i)))
      .catch((e: Error) => setError(e.message))
  }
  const generate = (): void => {
    setBusy(true)
    setError('')
    void speak(text, voice)
      .then((data) => setPreview({ url: URL.createObjectURL(new Blob([data], { type: 'audio/wav' })), data }))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }
  const use = (): void => {
    if (!preview) return
    setBusy(true)
    void onResult(preview.data.slice(0))
      .then(() => {
        setPreview(null)
        setText('')
        onClose()
      })
      .finally(() => setBusy(false))
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Ansage aus Text</DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        <Stack sx={{ gap: 2 }}>
          <TextField select label="Stimme" value={voice} onChange={(e) => setVoice(e.target.value)}>
            {(info?.all ?? []).map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.name}
                {info?.voices.includes(v.id) ? '' : ' – noch nicht geladen'}
              </MenuItem>
            ))}
          </TextField>
          {info && !ready && (
            <Alert
              severity="info"
              variant="outlined"
              action={
                <Button onClick={install} disabled={Boolean(info.installing)}>
                  Laden
                </Button>
              }
            >
              Die Sprachausgabe läuft auf der Anlage selbst, ohne Cloud. Programm und Stimme werden einmalig aus dem Internet geladen (zusammen etwa 90 MB).
              {info.installing && <LinearProgress sx={{ mt: 1 }} />}
            </Alert>
          )}
          {info?.error && !info.installing && <Alert severity="error">{info.error}</Alert>}
          <TextField
            label="Text"
            multiline
            minRows={4}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX))}
            helperText={`${text.length}/${MAX} Zeichen. Zahlen und Uhrzeiten am besten ausschreiben („neun bis siebzehn Uhr“).`}
            autoFocus
          />
          {error && <Alert severity="error">{error}</Alert>}
          {preview && (
            <Stack sx={{ gap: 0.5 }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Probehören:
              </Typography>
              <audio controls src={preview.url} style={{ width: '100%' }} />
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button onClick={generate} disabled={!ready || busy || !text.trim()}>
          Erzeugen
        </Button>
        <Button variant="contained" onClick={use} disabled={!preview || busy}>
          Übernehmen
        </Button>
      </DialogActions>
    </Dialog>
  )
}
