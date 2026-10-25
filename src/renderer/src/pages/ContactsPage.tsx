/** Kontakte: Suche, Liste, Detailansicht (breite Fenster), Import und Adressbücher. */

import CallIcon from '@mui/icons-material/Call'
import ContactsIcon from '@mui/icons-material/Contacts'
import EventIcon from '@mui/icons-material/EventAvailable'
import MoreIcon from '@mui/icons-material/MoreVert'
import PersonIcon from '@mui/icons-material/Person'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import SearchIcon from '@mui/icons-material/Search'
import StarIcon from '@mui/icons-material/Star'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import {
  Box,
  Button,
  Card,
  Fab,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useEffect, useState } from 'react'
import { formatDuration } from '../../../shared/format'
import { contactNumbers, numbersMatch } from '../../../shared/numbers'
import type { Contact } from '../../../shared/types'
import { api } from '../api'
import { emit } from '../bus'
import { ContactAvatar, EmptyState, GroupTitle } from '../components/common'
import { useApp } from '../state'
import { HistoryItem } from './HistoryPage'

const MAX_LIST = 200 // mehr Zeilen machen die Liste bei großen Datenbanken träge

function numberKinds(c: Contact): [string, string][] {
  return [
    ...(c.phone ? [['Telefon', c.phone] as [string, string]] : []),
    ...(c.mobile ? [['Mobil', c.mobile] as [string, string]] : []),
    ...c.other.map((n) => ['Weitere', n] as [string, string]),
  ]
}

function CallMenuButton({ contact }: { contact: Contact }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const numbers = numberKinds(contact)
  if (numbers.length === 1) {
    return (
      <Tooltip title={`${numbers[0][1]} anrufen`}>
        <IconButton edge="end" sx={{ color: 'success.main' }} onClick={() => void api.dial(numbers[0][1])} aria-label="Anrufen">
          <CallIcon />
        </IconButton>
      </Tooltip>
    )
  }
  return (
    <>
      <IconButton edge="end" sx={{ color: 'success.main' }} onClick={(e) => setAnchor(e.currentTarget)} aria-label="Anrufen">
        <CallIcon />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {numbers.map(([kind, n]) => (
          <MenuItem
            key={n}
            onClick={() => {
              setAnchor(null)
              void api.dial(n)
            }}
          >
            {kind}: {n}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

function ContactDetail({ contact }: { contact: Contact | null }) {
  const { history } = useApp()
  if (!contact) {
    return (
      <EmptyState
        icon={<PersonIcon />}
        title="Kontakt auswählen"
        description="Links einen Kontakt anklicken, um Details und gemeinsame Anrufe zu sehen."
      />
    )
  }
  const numbers = contactNumbers(contact)
  const calls = history.filter((e) => numbers.some((n) => numbersMatch(e.number, n))).slice(0, 20)
  const total = calls.reduce((s, e) => s + (e.duration || 0), 0)
  const kinds = new Map(numberKinds(contact).map(([k, n]) => [n, k]))
  return (
    <Box sx={{ overflowY: 'auto', flex: 1, px: 3, pt: 2, pb: 4 }}>
      <Stack sx={{ maxWidth: 720, mx: 'auto', gap: 1 }}>
        <Stack direction="row" sx={{ gap: 2.5, alignItems: 'center' }}>
          <ContactAvatar name={contact.name} size={96} />
          <Stack sx={{ gap: 0.5, minWidth: 0 }}>
            <Typography variant="h4" noWrap>
              {contact.name}
            </Typography>
            <Typography sx={{ color: 'text.secondary' }}>{[contact.company, contact.source].filter(Boolean).join(' · ')}</Typography>
            <Stack direction="row" sx={{ gap: 1, mt: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              {numbers.length > 0 && (
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<CallIcon />}
                  onClick={() => void api.dial(numbers[0])}
                >
                  Anrufen
                </Button>
              )}
              <Button variant="outlined" onClick={() => emit('edit-contact', contact)}>
                {contact.readonly ? 'Als eigenen Kontakt übernehmen' : 'Bearbeiten'}
              </Button>
              {!contact.readonly && !contact.pbx && (
                <Tooltip title="Favorit auf der Startseite">
                  <IconButton
                    aria-pressed={Boolean(contact.favorite)}
                    onClick={() => void api.saveContact({ ...contact, favorite: !contact.favorite })}
                    sx={{ color: contact.favorite ? '#e0a800' : 'text.secondary' }}
                  >
                    {contact.favorite ? <StarIcon /> : <StarBorderIcon />}
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          </Stack>
        </Stack>

        <GroupTitle>Rufnummern</GroupTitle>
        <Card>
          <List disablePadding>
            {numbers.map((n) => (
              <ListItem
                key={n}
                disablePadding
                secondaryAction={
                  <Stack direction="row">
                    <Tooltip title="Rückruf planen">
                      <IconButton onClick={() => void api.scheduleCallback(n, contact.name)}>
                        <EventIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={`${n} anrufen`}>
                      <IconButton edge="end" sx={{ color: 'success.main' }} onClick={() => void api.dial(n)}>
                        <CallIcon />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                }
              >
                <ListItemButton onClick={() => void api.dial(n)}>
                  <ListItemText primary={n} secondary={kinds.get(n) ?? 'Weitere'} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Card>

        <GroupTitle>Gemeinsame Anrufe</GroupTitle>
        {calls.length > 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary', px: 1, mt: -1, mb: 1 }}>
            {calls.length} Anrufe · {formatDuration(total)} Gesprächszeit
          </Typography>
        )}
        <Card>
          {calls.length ? (
            <List disablePadding>
              {calls.map((e) => (
                <HistoryItem key={`${e.time}-${e.number}`} entry={e} />
              ))}
            </List>
          ) : (
            <Typography sx={{ p: 2, color: 'text.secondary' }}>Noch keine Anrufe mit diesem Kontakt</Typography>
          )}
        </Card>
      </Stack>
    </Box>
  )
}

export function ContactsPage({ wide }: { wide: boolean }) {
  const { state } = useApp()
  const theme = useTheme()
  const [search, setSearch] = useState('')
  const [result, setResult] = useState<{ items: Contact[]; total: number }>({ items: [], total: 0 })
  const [selected, setSelected] = useState<Contact | null>(null)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let current = true
    void api.searchContacts(search, MAX_LIST).then((r) => current && setResult(r))
    return () => {
      current = false
    }
  }, [search, state.contactsVersion])

  // Kontakt nach Änderungen neu nachschlagen (Bearbeiten, Sync)
  useEffect(() => {
    if (!selected) return
    void api.getContact(selected.id).then((c) => setSelected(c))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.contactsVersion])

  useEffect(() => {
    if (wide && !selected && result.items.length) setSelected(result.items[0])
  }, [wide, selected, result])

  const open = (c: Contact): void => (wide ? setSelected(c) : emit('edit-contact', c))

  const list = result.items.length ? (
    <Box sx={{ overflowY: 'auto', flex: 1, px: 1.5, pb: 12 }}>
      <Card sx={{ maxWidth: wide ? 'none' : 560, mx: 'auto' }}>
        <List disablePadding>
          {result.items.map((c) => (
            <ListItem
              key={c.id}
              disablePadding
              secondaryAction={
                <Stack direction="row" sx={{ alignItems: 'center' }}>
                  {(c.readonly || c.pbx) && (
                    <Tooltip title={`Aus Adressbuch: ${c.source}`}>
                      <ContactsIcon fontSize="small" sx={{ color: 'text.disabled', mr: 1 }} />
                    </Tooltip>
                  )}
                  <CallMenuButton contact={c} />
                </Stack>
              }
            >
              <ListItemButton selected={wide && selected?.id === c.id} onClick={() => open(c)} sx={{ pr: 10 }}>
                <ListItemAvatar>
                  <ContactAvatar name={c.name} />
                </ListItemAvatar>
                <ListItemText
                  primary={c.name}
                  secondary={[c.source, c.company, numberKinds(c).map(([, n]) => n).join(' · ')].filter(Boolean).join(' — ')}
                  slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                />
              </ListItemButton>
            </ListItem>
          ))}
          {result.total > MAX_LIST && (
            <ListItem>
              <ListItemText
                primary={`… und ${result.total - MAX_LIST} weitere`}
                secondary="Suchfeld verwenden, um sie zu finden"
                slotProps={{ primary: { sx: { color: 'text.secondary' } } }}
              />
            </ListItem>
          )}
        </List>
      </Card>
    </Box>
  ) : state.hasContacts ? (
    <EmptyState icon={<SearchIcon />} title="Keine Treffer" />
  ) : (
    <EmptyState
      icon={<ContactsIcon />}
      title="Noch keine Kontakte"
      description="Lege Kontakte an, importiere sie aus einer Datei (vCard, CSV) oder verbinde ein Adressbuch, um Anrufer zu erkennen und mit einem Klick anzurufen."
    >
      <Button variant="contained" onClick={() => emit('edit-contact', {})}>
        Kontakt anlegen
      </Button>
      <Button variant="outlined" onClick={() => void api.importContacts()}>
        Aus Datei importieren
      </Button>
    </EmptyState>
  )

  return (
    <Stack
      direction="row"
      sx={{ flex: 1, minHeight: 0, position: 'relative', outline: dragging ? `3px dashed ${theme.palette.primary.main}` : 'none', outlineOffset: -6 }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const paths = [...e.dataTransfer.files].map((f) => window.bridge.pathForFile(f)).filter(Boolean)
        if (paths.length) void api.importFiles(paths)
      }}
    >
      <Stack sx={{ width: wide ? 420 : 'auto', flex: wide ? 'none' : 1, minWidth: 0 }}>
        <Stack direction="row" sx={{ gap: 1, px: 1.5, pt: 1, pb: 1.5, maxWidth: wide ? 'none' : 584, width: '100%', mx: 'auto', boxSizing: 'border-box' }}>
          <TextField
            size="small"
            placeholder="Kontakte durchsuchen"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              const first = result.items[0]
              if (e.key === 'Enter' && first) void api.dial(contactNumbers(first)[0] ?? '')
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Tooltip title="Importieren und Adressbücher">
            <IconButton onClick={(e) => setMenu(e.currentTarget)}>
              <MoreIcon />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
            {(
              [
                ['Aus Datei importieren …', () => void api.importContacts()],
                ['Adressbücher aktualisieren', () => void api.syncContacts()],
                ['Adressbücher verwalten …', () => emit('open-preferences', 'contacts')],
              ] as const
            ).map(([label, fn]) => (
              <MenuItem
                key={label}
                onClick={() => {
                  setMenu(null)
                  fn()
                }}
              >
                {label}
              </MenuItem>
            ))}
          </Menu>
        </Stack>
        {list}
      </Stack>
      {wide && (
        <Stack sx={{ flex: 1, minWidth: 0, borderLeft: 1, borderColor: 'divider' }}>
          <ContactDetail contact={selected} />
        </Stack>
      )}
      <Tooltip title="Neuer Kontakt">
        <Fab color="primary" onClick={() => emit('edit-contact', {})} sx={{ position: 'absolute', right: 18, bottom: 18 }} aria-label="Neuer Kontakt">
          <PersonAddIcon />
        </Fab>
      </Tooltip>
    </Stack>
  )
}
