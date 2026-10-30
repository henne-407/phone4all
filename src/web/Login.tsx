/**
 * Anmeldung im Web-Client: mit Nebenstelle und Einrichtungs-PIN aus der Verwaltung oder
 * über den Einladungslink. Jeder Browser wird dabei ein eigenes Gerät der Nebenstelle
 * (Geräteliste in der Verwaltung); „Abmelden“ gibt es wieder frei.
 */

import LinkIcon from '@mui/icons-material/Link'
import PhoneIcon from '@mui/icons-material/Phone'
import { Alert, Box, Button, CircularProgress, Divider, Paper, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import type { WebApp } from './app'

/** Token aus „#setup=<token>“ (Link der Einladungsseite) */
function setupToken(): string {
  return new URLSearchParams(location.hash.slice(1)).get('setup')?.replace(/[^\w-]/g, '') ?? ''
}

export function Login({ app, onDone }: { app: WebApp; onDone: () => void }) {
  const [name, setName] = useState('')
  const [extension, setExtension] = useState('')
  const [pin, setPin] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const invite = setupToken()

  useEffect(() => {
    // Name der Anlage (öffentlich, wie auf der Anmeldeseite der Verwaltung)
    void fetch('/api/session')
      .then((r) => r.json())
      .then((s: { name?: string }) => setName(s.name ?? ''))
      .catch(() => undefined)
  }, [])

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError('')
    // Benachrichtigungen bei eingehenden Anrufen (Frage nur nach einem Klick erlaubt)
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission().catch(() => undefined)
    try {
      await fn()
      app.provisioning.apply()
      history.replaceState(null, '', location.pathname)
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const byPin = (): Promise<void> => run(() => app.provisioning.fromPin(location.origin, extension, pin))
  const byLink = (text: string): Promise<void> =>
    run(() => {
      const token = /\/(?:setup|provision)\/([\w-]+)\/?$/.exec(text.trim())?.[1] ?? (/^[\w-]{16,}$/.test(text.trim()) ? text.trim() : '')
      if (!token) throw new Error('Das ist kein Einladungslink der Telefonanlage.')
      return app.provisioning.fromLink(`${location.origin}/setup/${token}`)
    })

  return (
    <Stack sx={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', color: 'text.primary', p: 2 }}>
      <Paper variant="outlined" sx={{ width: '100%', maxWidth: 420, p: { xs: 3, sm: 4 }, borderRadius: 4 }}>
        <Stack sx={{ alignItems: 'center', gap: 1, mb: 3, textAlign: 'center' }}>
          <Box component="img" src="./icon.png" alt="" sx={{ width: 64, height: 64 }} />
          <Typography variant="h5">Phone4All im Browser</Typography>
          <Typography sx={{ color: 'text.secondary' }}>{name ? `Anmelden an „${name}“` : 'An der Telefonanlage anmelden'}</Typography>
        </Stack>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {invite ? (
          <Stack sx={{ gap: 2 }}>
            <Typography>Mit dem Link aus der Einladung wird dieser Browser als eigenes Gerät deiner Nebenstelle eingerichtet.</Typography>
            <Button variant="contained" size="large" disabled={busy} startIcon={busy ? <CircularProgress size={18} /> : <LinkIcon />} onClick={() => void byLink(invite)}>
              Im Browser einrichten
            </Button>
          </Stack>
        ) : (
          <Stack
            component="form"
            sx={{ gap: 2 }}
            onSubmit={(e) => {
              e.preventDefault()
              void byPin()
            }}
          >
            <TextField label="Nebenstelle" value={extension} onChange={(e) => setExtension(e.target.value)} autoFocus slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'username' } }} />
            <TextField
              label="Einrichtungs-PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              helperText="Steht in der Einladung oder in der Verwaltung bei der Nebenstelle (App einrichten). Gilt einmal."
              slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'one-time-code' } }}
            />
            <Button type="submit" variant="contained" size="large" disabled={busy || !extension.trim() || !pin.trim()} startIcon={busy ? <CircularProgress size={18} /> : <PhoneIcon />}>
              Anmelden
            </Button>
            <Divider sx={{ my: 1 }}>oder</Divider>
            <TextField label="Einladungslink einfügen" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/setup/…" />
            <Button variant="outlined" disabled={busy || !link.trim()} onClick={() => void byLink(link)}>
              Mit Link einrichten
            </Button>
          </Stack>
        )}
        {!window.isSecureContext && (
          <Alert severity="warning" sx={{ mt: 3 }}>
            Diese Seite ist nicht über HTTPS geöffnet. Kontakte, Messenger und Einstellungen gehen, Telefonieren aber nur über HTTPS.
          </Alert>
        )}
      </Paper>
    </Stack>
  )
}
