/**
 * Konto von einer Phone4all-Telefonanlage übernehmen: Anlage im LAN suchen oder
 * Adresse eingeben, mit Nebenstelle und Einrichtungs-PIN anmelden oder einen
 * Einrichtungslink einfügen. Vor dem Übernehmen wird immer bestätigt.
 */

import DnsIcon from '@mui/icons-material/Dns'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import type { PbxFound, PbxPreview } from '../../../../shared/types'
import { api } from '../../api'
import { useApp } from '../../state'

export function PbxSetupDialog({
  link,
  onClose,
  onApplied,
}: {
  /** sip-telefon://-Link: direkt das Profil abrufen und nur bestätigen lassen */
  link?: string
  onClose: () => void
  onApplied?: () => void
}) {
  const { toast } = useApp()
  const [found, setFound] = useState<PbxFound[] | null>(null)
  const [server, setServer] = useState('')
  const [extension, setExtension] = useState('')
  const [pin, setPin] = useState('')
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<PbxPreview | null>(null)

  const search = async (): Promise<void> => {
    setFound(null)
    const list = await api.pbxDiscover()
    setFound(list)
    if (list.length === 1) setServer((s) => s || list[0].url)
  }

  const load = async (fn: () => ReturnType<typeof api.pbxFromLink>): Promise<void> => {
    setBusy(true)
    setError('')
    const r = await fn()
    setBusy(false)
    if (r.ok) setPreview(r.value)
    else setError(r.error)
  }

  useEffect(() => {
    if (link) void load(() => api.pbxFromLink(link))
    else void search()
  }, [link])

  const apply = async (): Promise<void> => {
    const secure = await api.pbxApply()
    toast(
      secure
        ? 'Konto übernommen – die App meldet sich jetzt an der Telefonanlage an'
        : 'Konto übernommen. Kein Schlüsselbund verfügbar – Passwort unverschlüsselt gespeichert',
    )
    onApplied?.()
    onClose()
  }

  if (preview) {
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="xs">
        <DialogTitle>Konto übernehmen?</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Die Telefonanlage <b>{preview.pbx}</b> richtet die App für die Nebenstelle <b>{preview.extension}</b>
            {preview.display_name ? ` (${preview.display_name})` : ''} ein.
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Server: {preview.server}
            <br />
            Telefonbuch: {preview.contacts} Einträge
          </Typography>
          <Alert severity="info" sx={{ mt: 2 }}>
            Das bisherige SIP-Konto wird ersetzt. Änderungen an der Anlage übernimmt die App künftig automatisch.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="contained" onClick={() => void apply()}>
            Übernehmen
          </Button>
        </DialogActions>
      </Dialog>
    )
  }

  const canLogin = server.trim() && extension.trim() && pin.trim() && !busy
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Von Telefonanlage einrichten</DialogTitle>
      <DialogContent>
        {link ? (
          <Stack sx={{ alignItems: 'center', py: 3, gap: 2 }}>
            {busy && <CircularProgress />}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        ) : (
          <Stack
            component="form"
            sx={{ gap: 2 }}
            onSubmit={(e) => {
              e.preventDefault()
              if (canLogin) void load(() => api.pbxFromPin(server, extension, pin))
            }}
          >
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Nebenstelle und Einrichtungs-PIN stehen in der Weboberfläche der Telefonanlage unter Nebenstellen oder in der
              Einladungs-E-Mail.
            </Typography>
            <Box>
              <Typography variant="subtitle2">Im Netzwerk gefunden</Typography>
              {found === null && (
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1, py: 1 }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2">Suche …</Typography>
                </Stack>
              )}
              {found?.length === 0 && (
                <Typography variant="body2" sx={{ color: 'text.secondary', py: 1 }}>
                  Keine Anlage gefunden – Adresse bitte unten eingeben.{' '}
                  <Button size="small" onClick={() => void search()}>
                    Erneut suchen
                  </Button>
                </Typography>
              )}
              <List dense disablePadding>
                {found?.map((f) => (
                  <ListItemButton key={f.url} selected={server === f.url} onClick={() => setServer(f.url)}>
                    <ListItemIcon>
                      <DnsIcon />
                    </ListItemIcon>
                    <ListItemText primary={f.name} secondary={f.url.replace(/^https?:\/\//, '')} />
                  </ListItemButton>
                ))}
              </List>
            </Box>
            <TextField label="Adresse der Telefonanlage" placeholder="192.168.1.10" value={server} onChange={(e) => setServer(e.target.value)} />
            <Stack direction="row" sx={{ gap: 1.5 }}>
              <TextField label="Nebenstelle" value={extension} onChange={(e) => setExtension(e.target.value)} sx={{ flex: 1 }} autoFocus />
              <TextField
                label="Einrichtungs-PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                sx={{ flex: 1 }}
              />
            </Stack>
            <TextField
              label="… oder Einrichtungslink einfügen"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              onBlur={() => pasted.trim() && void load(() => api.pbxFromLink(pasted))}
            />
            {error && <Alert severity="error">{error}</Alert>}
            <button type="submit" hidden />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
        {!link && (
          <Button variant="contained" disabled={!canLogin} onClick={() => void load(() => api.pbxFromPin(server, extension, pin))}>
            {busy ? 'Verbinde …' : 'Weiter'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
