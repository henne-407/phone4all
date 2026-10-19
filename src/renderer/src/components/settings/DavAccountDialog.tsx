/** CalDAV-/CardDAV-Konto hinzufügen, inklusive Verbindungstest. */

import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material'
import { useState } from 'react'
import type { DavAccount } from '../../../../shared/types'
import { api } from '../../api'
import { useApp } from '../../state'
import { newId } from './parts'

export type DavKind = 'caldav' | 'carddav'

export const DAV_KINDS = {
  caldav: {
    title: 'CalDAV-Konto',
    group: 'CalDAV-Konten',
    hint: 'Nextcloud, iCloud, mailbox.org, Radicale …',
    found: (n: number) => `${n} Kalender gefunden`,
    examples:
      'Beispiele:\n• Nextcloud: https://cloud.example.de/remote.php/dav\n' +
      '• iCloud: https://caldav.icloud.com (app-spezifisches Passwort)\n• mailbox.org: https://dav.mailbox.org',
  },
  carddav: {
    title: 'CardDAV-Konto',
    group: 'CardDAV-Konten',
    hint: 'Nextcloud, iCloud, mailbox.org, Radicale …',
    found: (n: number) => `${n} Adressbücher gefunden`,
    examples:
      'Beispiele:\n• Nextcloud: https://cloud.example.de/remote.php/dav\n' +
      '• iCloud: https://contacts.icloud.com (app-spezifisches Passwort)\n• mailbox.org: https://dav.mailbox.org',
  },
}

export function DavAccountDialog({ kind, onClose }: { kind: DavKind; onClose: () => void }) {
  const { state, toast } = useApp()
  const info = DAV_KINDS[kind]
  // Zugangsdaten eines vorhandenen Kontos der anderen Art übernehmen (z. B. Nextcloud)
  const other: DavKind = kind === 'caldav' ? 'carddav' : 'caldav'
  const templates: DavAccount[] = other === 'caldav' ? state.settings.calendar.caldav : state.settings.addressbooks.carddav
  const [url, setUrl] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const valid = url.trim() && user.trim() && password

  const reuse = async (id: string): Promise<void> => {
    const conf = templates.find((c) => c.id === id)
    if (!conf) return
    setUrl(conf.url)
    setUser(conf.user)
    setName(conf.name)
    setPassword(await api.davSecret(other, conf.id))
  }

  const connect = async (): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    setError('')
    const conf = { id: newId(), name: name.trim(), url: url.trim(), user: user.trim() }
    const r = await api.addDavAccount(kind, conf, password)
    setBusy(false)
    if (r.ok) {
      toast(info.found(r.value))
      onClose()
    } else {
      setError(r.error)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{info.title}</DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          sx={{ gap: 1.5 }}
          onSubmit={(e) => {
            e.preventDefault()
            void connect()
          }}
        >
          {templates.length > 0 && (
            <TextField select label="Zugangsdaten übernehmen von" defaultValue="" onChange={(e) => void reuse(e.target.value)}>
              <MenuItem value="">—</MenuItem>
              {templates.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name || c.url}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Alert severity="info" sx={{ whiteSpace: 'pre-line' }}>
            {info.examples}
          </Alert>
          <TextField label="Server-URL" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus slotProps={{ htmlInput: { inputMode: 'url' } }} />
          <TextField label="Benutzername" value={user} onChange={(e) => setUser(e.target.value)} />
          <TextField label="Passwort" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <TextField label="Name (optional, z. B. Nextcloud)" value={name} onChange={(e) => setName(e.target.value)} />
          {error && <Alert severity="error">{error}</Alert>}
          <button type="submit" hidden />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" disabled={!valid || busy} onClick={() => void connect()}>
          {busy ? 'Verbinde …' : 'Verbinden'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
