/** Ziel für eine Weiterleitung wählen: Nummer eintippen oder Kontakt anklicken. */

import ForwardIcon from '@mui/icons-material/PhoneForwarded'
import { IconButton, List, ListItemAvatar, ListItemButton, ListItemText, Popover, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { contactNumbers, hasDigit } from '../../../shared/numbers'
import type { Contact } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../state'
import { ContactAvatar } from './common'

export function TransferPopover({
  anchor,
  onClose,
  onTransfer,
}: {
  anchor: HTMLElement | null
  onClose: () => void
  onTransfer: (target: string) => void
}) {
  const { state } = useApp()
  const [text, setText] = useState('')
  const [matches, setMatches] = useState<Contact[]>([])

  useEffect(() => {
    if (anchor) setText('')
  }, [anchor])

  useEffect(() => {
    let current = true
    const t = text.trim()
    if (!t) setMatches(state.favorites.slice(0, 6))
    else void api.searchContacts(t, 6).then((r) => current && setMatches(r.items))
    return () => {
      current = false
    }
  }, [text, state.favorites])

  const rows = matches.flatMap((c) => contactNumbers(c).map((n) => ({ name: c.name, number: n }))).slice(0, 6)

  const submit = (raw: string): void => {
    let target = raw.trim()
    if (!target) return
    if (!hasDigit(target) && !target.includes('@')) {
      const first = rows[0]
      if (!first) return
      target = first.number
    }
    onClose()
    onTransfer(target)
  }

  return (
    <Popover
      open={Boolean(anchor)}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      transformOrigin={{ vertical: 'top', horizontal: 'center' }}
    >
      <Stack sx={{ p: 2, width: 320, gap: 1 }}>
        <Typography variant="subtitle1">Weiterleiten an</Typography>
        <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
          <TextField
            autoFocus
            size="small"
            label="Nummer oder Name"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit(text)}
            slotProps={{ htmlInput: { inputMode: 'tel' } }}
          />
          <IconButton
            aria-label="Weiterleiten"
            onClick={() => submit(text)}
            sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.main' } }}
          >
            <ForwardIcon />
          </IconButton>
        </Stack>
        {rows.length > 0 && (
          <List dense disablePadding>
            {rows.map((r) => (
              <ListItemButton key={r.name + r.number} onClick={() => submit(r.number)}>
                <ListItemAvatar sx={{ minWidth: 44 }}>
                  <ContactAvatar name={r.name} size={32} />
                </ListItemAvatar>
                <ListItemText primary={r.name} secondary={r.number} />
              </ListItemButton>
            ))}
          </List>
        )}
      </Stack>
    </Popover>
  )
}
