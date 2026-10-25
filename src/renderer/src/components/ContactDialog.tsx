/**
 * Kontakt anlegen oder bearbeiten; Kontakte aus Adressbüchern nur ansehen. Mit dem Recht
 * „Telefonbuch bearbeiten“ ändert die App Einträge im Telefonbuch der Telefonanlage.
 */

import CallIcon from '@mui/icons-material/Call'
import ContactsIcon from '@mui/icons-material/Contacts'
import StarIcon from '@mui/icons-material/Star'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Switch,
  TextField,
} from '@mui/material'
import { useState } from 'react'
import { contactNumbers } from '../../../shared/numbers'
import type { Contact } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../state'
import { ContactAvatar } from './common'

export function ContactDialog({ contact, onClose }: { contact: Partial<Contact>; onClose: () => void }) {
  const { state, toast } = useApp()
  const readonly = Boolean(contact.readonly)
  const isNew = !contact.id
  const pbxName = state.settings.provisioning.pbx
  const canPbx = Boolean(pbxName) && state.settings.provisioning.permissions.includes('phonebook_edit')
  const [toPbx, setToPbx] = useState(false)
  // Eintrag im Telefonbuch der Anlage: nur Telefon und Mobil, kein Favorit
  const central = Boolean(contact.pbx) || (isNew && toPbx)
  const [values, setValues] = useState({
    name: contact.name ?? '',
    phone: contact.phone ?? '',
    mobile: contact.mobile ?? '',
    other: (contact.other ?? []).join(', '),
    company: contact.company ?? '',
    favorite: Boolean(contact.favorite),
  })
  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: key === 'favorite' ? e.target.checked : e.target.value }))
  const hasNumber = [values.phone, values.mobile, ...(central ? [] : [values.other])].some((v) => v.trim())
  const valid = Boolean(values.name.trim()) && hasNumber

  const save = async (): Promise<void> => {
    if (!valid) return
    if (central) {
      const r = await api.pbxSaveContact({
        pbx: contact.pbx,
        name: values.name.trim(),
        company: values.company.trim(),
        phone: values.phone.trim(),
        mobile: values.mobile.trim(),
      })
      if (!r.ok) return toast(r.error)
      toast(`„${values.name.trim()}“ im Telefonbuch von „${pbxName}“ gespeichert`)
      return onClose()
    }
    await api.saveContact({
      ...(contact as Contact),
      name: values.name.trim(),
      phone: values.phone.trim(),
      mobile: values.mobile.trim(),
      company: values.company.trim(),
      other: values.other
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean),
      favorite: values.favorite,
    })
    onClose()
  }

  const copy = async (): Promise<void> => {
    const { id: _id, source: _s, readonly: _r, ...rest } = contact as Contact
    await api.saveContact({ ...rest, id: '', favorite: false })
    toast(`„${contact.name}“ als eigener Kontakt gespeichert`)
    onClose()
  }

  const remove = async (): Promise<void> => {
    if (contact.pbx) {
      const r = await api.pbxDeleteContact(contact.pbx)
      if (!r.ok) return toast(r.error)
    } else {
      await api.deleteContact(contact.id!)
    }
    toast(`„${contact.name}“ gelöscht`)
    onClose()
  }

  const fields: [keyof typeof values, string, string?][] = [
    ['name', 'Name'],
    ['phone', 'Telefon', 'tel'],
    ['mobile', 'Mobil', 'tel'],
    ['other', 'Weitere Nummern (durch Komma getrennt)', 'tel'],
    ['company', 'Firma'],
  ]

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{readonly ? 'Kontakt' : isNew ? 'Neuer Kontakt' : 'Kontakt bearbeiten'}</DialogTitle>
      <DialogContent>
        <Stack sx={{ alignItems: 'center', mb: 2 }}>
          <ContactAvatar name={values.name} size={88} />
        </Stack>
        {readonly ? (
          <Stack sx={{ gap: 2 }}>
            <Alert icon={<ContactsIcon />} severity="info">
              Aus Adressbuch: {contact.source}. Änderungen bitte im Adressbuch vornehmen.
            </Alert>
            <TextField label="Name" value={values.name} slotProps={{ input: { readOnly: true } }} />
            {values.company && <TextField label="Firma" value={values.company} slotProps={{ input: { readOnly: true } }} />}
            <List disablePadding>
              {contactNumbers(contact).map((n) => (
                <ListItemButton
                  key={n}
                  onClick={() => {
                    onClose()
                    void api.dial(n)
                  }}
                >
                  <ListItemIcon sx={{ color: 'success.main' }}>
                    <CallIcon />
                  </ListItemIcon>
                  <ListItemText primary={n} secondary="Anrufen" />
                </ListItemButton>
              ))}
            </List>
          </Stack>
        ) : (
          <Stack
            component="form"
            sx={{ gap: 2 }}
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            {central && (
              <Alert icon={<ContactsIcon />} severity="info">
                Im Telefonbuch von „{pbxName}“ – Änderungen sehen alle.
              </Alert>
            )}
            {fields
              .filter(([key]) => !central || key !== 'other')
              .map(([key, label, inputMode]) => (
                <TextField
                  key={key}
                  label={label}
                  value={values[key]}
                  onChange={set(key)}
                  autoFocus={key === 'name'}
                  slotProps={{ htmlInput: { inputMode } }}
                />
              ))}
            {isNew && canPbx && (
              <FormControlLabel
                control={<Switch checked={toPbx} onChange={(e) => setToPbx(e.target.checked)} />}
                label={`Im Telefonbuch von „${pbxName}“ speichern (für alle)`}
              />
            )}
            {!central && (
              <FormControlLabel
                control={<Switch checked={values.favorite} onChange={set('favorite')} />}
                label={
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                    <StarIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                    Favorit – auf der Startseite als Kurzwahl
                  </Stack>
                }
                sx={{ mt: 1 }}
              />
            )}
            <button type="submit" hidden />
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        {!readonly && !isNew && (
          <Button color="error" onClick={() => void remove()}>
            Löschen
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {readonly ? (
          <>
            <Button onClick={() => void copy()}>Als eigenen Kontakt übernehmen</Button>
            <Button variant="contained" onClick={onClose}>
              Schließen
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Abbrechen</Button>
            <Button variant="contained" disabled={!valid} onClick={() => void save()}>
              Speichern
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
