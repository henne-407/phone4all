/**
 * Messenger: Einzel- und Gruppenchats über die Phone4all-Telefonanlage.
 * Breite Fenster zeigen Liste und Unterhaltung nebeneinander, schmale nacheinander.
 */

import AddCommentIcon from '@mui/icons-material/AddComment'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import CallIcon from '@mui/icons-material/Call'
import ChatIcon from '@mui/icons-material/Chat'
import CloudOffIcon from '@mui/icons-material/CloudOff'
import DoneIcon from '@mui/icons-material/Done'
import DoneAllIcon from '@mui/icons-material/DoneAll'
import DownloadIcon from '@mui/icons-material/Download'
import EditIcon from '@mui/icons-material/Edit'
import GroupAddIcon from '@mui/icons-material/GroupAdd'
import GroupsIcon from '@mui/icons-material/Groups'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import LogoutIcon from '@mui/icons-material/Logout'
import MoreIcon from '@mui/icons-material/MoreVert'
import SearchIcon from '@mui/icons-material/Search'
import SendIcon from '@mui/icons-material/Send'
import VideocamIcon from '@mui/icons-material/Videocam'
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  LinearProgress,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatFile, ChatMessage, ChatRoom, MessengerState } from '../../../shared/types'
import { api, onMain } from '../api'
import { ContactAvatar, EmptyState, PILL } from '../components/common'
import { roomTitle, useMessenger, userName } from '../messenger'
import { useApp } from '../state'
import { joinVideo, useVideo } from '../video'

/** Unterhaltung, die beim nächsten Anzeigen geöffnet werden soll (Klick auf Benachrichtigung) */
let requested: string | null = null
const openListeners = new Set<(room: string) => void>()

export function openChatRoom(room: string): void {
  requested = room
  for (const l of openListeners) l(room)
}

function otherMember(room: ChatRoom, s: MessengerState): string {
  return room.members.find((m) => m !== s.me) ?? ''
}

function preview(m: ChatMessage | null, s: MessengerState, group: boolean): string {
  if (!m) return 'Noch keine Nachrichten'
  const body = m.text || (m.file ? `Datei: ${m.file.name}` : '')
  if (!m.from) return body
  if (m.from === s.me) return `Du: ${body}`
  return group ? `${userName(m.from, s).split(' ')[0]}: ${body}` : body
}

function shortTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Gestern'
  if (now.getTime() - ts < 6 * 86400000) return d.toLocaleDateString('de-DE', { weekday: 'short' })
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Heute'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Gestern'
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

function fileSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

function RoomAvatar({ room, s, size = 40 }: { room: ChatRoom; s: MessengerState; size?: number }) {
  if (room.kind === 'group') {
    return (
      <Avatar sx={{ width: size, height: size, bgcolor: 'secondary.main', color: 'secondary.contrastText' }}>
        <GroupsIcon />
      </Avatar>
    )
  }
  const other = otherMember(room, s)
  return (
    <Badge
      overlap="circular"
      variant="dot"
      color="success"
      invisible={!s.online.includes(other)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      sx={{ '& .MuiBadge-badge': { width: 12, height: 12, borderRadius: 6, border: 2, borderColor: 'background.paper' } }}
    >
      <ContactAvatar name={roomTitle(room, s)} size={size} />
    </Badge>
  )
}

// -- Liste der Unterhaltungen ----------------------------------------------------------

function RoomList({ s, current, onOpen, onNew }: { s: MessengerState; current: string | null; onOpen: (id: string) => void; onNew: (kind: 'direct' | 'group') => void }) {
  const [query, setQuery] = useState('')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const rooms = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...s.rooms]
      .filter((r) => !q || roomTitle(r, s).toLowerCase().includes(q))
      .sort((a, b) => (b.last?.time ?? b.seq) - (a.last?.time ?? a.seq))
  }, [s, query])
  return (
    <Stack sx={{ minHeight: 0, flex: 1 }}>
      <Stack direction="row" sx={{ gap: 1, p: 2, pb: 1.5, alignItems: 'center' }}>
        <TextField
          variant="filled"
          hiddenLabel
          size="small"
          placeholder="Chats durchsuchen"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ flex: 1, ...PILL }}
          slotProps={{
            input: {
              disableUnderline: true,
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Tooltip title="Neuer Chat">
          <IconButton color="primary" aria-label="Neuer Chat" onClick={(e) => setAnchor(e.currentTarget)} disabled={s.status !== 'online'}>
            <AddCommentIcon />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
          <MenuItem
            onClick={() => {
              setAnchor(null)
              onNew('direct')
            }}
          >
            <ListItemIcon>
              <ChatIcon />
            </ListItemIcon>
            Neuer Chat
          </MenuItem>
          <MenuItem
            onClick={() => {
              setAnchor(null)
              onNew('group')
            }}
          >
            <ListItemIcon>
              <GroupAddIcon />
            </ListItemIcon>
            Neue Gruppe
          </MenuItem>
        </Menu>
      </Stack>
      <List sx={{ overflowY: 'auto', flex: 1, px: 1, pt: 0 }}>
        {rooms.map((r) => (
          <ListItemButton key={r.id} selected={r.id === current} onClick={() => onOpen(r.id)} sx={{ borderRadius: 3, mb: 0.5, py: 1 }}>
            <ListItemAvatar>
              <RoomAvatar room={r} s={s} />
            </ListItemAvatar>
            <ListItemText
              primary={roomTitle(r, s)}
              secondary={s.calls[r.id] ? 'Videoanruf läuft' : s.typing[r.id]?.length ? 'schreibt …' : preview(r.last, s, r.kind === 'group')}
              slotProps={{
                primary: { noWrap: true, sx: { fontWeight: r.unread ? 600 : undefined } },
                secondary: { noWrap: true, sx: { color: s.calls[r.id] ? 'success.main' : s.typing[r.id]?.length ? 'primary.main' : undefined } },
              }}
            />
            <Stack sx={{ alignItems: 'flex-end', gap: 0.5, ml: 1, flexShrink: 0 }}>
              {r.last && (
                <Typography variant="caption" sx={{ color: r.unread ? 'primary.main' : 'text.secondary' }}>
                  {shortTime(r.last.time)}
                </Typography>
              )}
              {r.unread > 0 && (
                <Box
                  sx={{
                    minWidth: 20,
                    height: 20,
                    px: 0.75,
                    borderRadius: 10,
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {r.unread > 99 ? '99+' : r.unread}
                </Box>
              )}
            </Stack>
          </ListItemButton>
        ))}
        {!rooms.length && (
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', p: 3 }}>
            {query ? 'Kein Chat gefunden' : 'Noch keine Chats. Mit dem Knopf oben einen beginnen.'}
          </Typography>
        )}
      </List>
    </Stack>
  )
}

/** Spalte der Seite als Karte, die selbst nicht scrollt */
const PANEL = { display: 'flex', flexDirection: 'column', minHeight: 0, p: 0 } as const

// -- Dialoge ---------------------------------------------------------------------------

function NewChatDialog({ s, onClose, onOpen }: { s: MessengerState; onClose: () => void; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const users = s.users.filter((u) => u.number !== s.me && `${u.name} ${u.number}`.toLowerCase().includes(query.trim().toLowerCase()))
  const start = async (ext: string): Promise<void> => {
    const r = await api.messengerDirect(ext)
    if (r.ok) {
      onOpen(r.value.id)
      onClose()
    } else setError(r.error)
  }
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Neuer Chat</DialogTitle>
      <DialogContent sx={{ px: 1.5 }}>
        <Box sx={{ px: 1.5, mb: 1.5 }}>
          <TextField
            autoFocus
            fullWidth
            variant="filled"
            hiddenLabel
            size="small"
            placeholder="Name oder Nebenstelle"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={PILL}
            slotProps={{ input: { disableUnderline: true } }}
          />
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        <List dense>
          {users.map((u) => (
            <ListItemButton key={u.number} onClick={() => void start(u.number)} sx={{ borderRadius: 2 }}>
              <ListItemAvatar>
                <ContactAvatar name={u.name || u.number} size={36} />
              </ListItemAvatar>
              <ListItemText primary={u.name || u.number} secondary={`${u.number}${s.online.includes(u.number) ? ' · online' : ''}`} />
            </ListItemButton>
          ))}
          {!users.length && (
            <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>
              Niemand gefunden.
            </Typography>
          )}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
      </DialogActions>
    </Dialog>
  )
}

function GroupDialog({ s, room, onClose, onOpen }: { s: MessengerState; room: ChatRoom | null; onClose: () => void; onOpen: (id: string) => void }) {
  const [name, setName] = useState(room?.name ?? '')
  const [members, setMembers] = useState<string[]>(room ? room.members.filter((m) => m !== s.me) : [])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Andere entfernen darf nur, wer die Gruppe angelegt hat (oder jeder, wenn er nicht mehr dabei ist)
  const admin = !room || room.created_by === s.me || !room.members.includes(room.created_by)
  const fixed = (n: string): boolean => !admin && Boolean(room?.members.includes(n))
  const toggle = (n: string): void => {
    if (!fixed(n)) setMembers((l) => (l.includes(n) ? l.filter((x) => x !== n) : [...l, n]))
  }
  const save = async (): Promise<void> => {
    setBusy(true)
    const r = room
      ? await api.messengerUpdateGroup(room.id, { name, members: [s.me, ...members] })
      : await api.messengerGroup(name, members)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    if (!room && r.value) onOpen((r.value as ChatRoom).id)
    onClose()
  }
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{room ? 'Gruppe bearbeiten' : 'Neue Gruppe'}</DialogTitle>
      <DialogContent>
        <TextField autoFocus fullWidth label="Name der Gruppe" value={name} onChange={(e) => setName(e.target.value)} sx={{ mt: 1 }} />
        <Typography variant="subtitle2" sx={{ mt: 2.5, mb: 0.5 }}>
          Mitglieder ({members.length + 1})
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {!admin && (
          <Typography variant="body2" color="text.secondary">
            Hinzufügen kann jedes Mitglied, entfernen nur, wer die Gruppe angelegt hat.
          </Typography>
        )}
        <List dense>
          {s.users
            .filter((u) => u.number !== s.me)
            .map((u) => (
              <ListItemButton key={u.number} onClick={() => toggle(u.number)} disabled={fixed(u.number)} sx={{ borderRadius: 2 }}>
                <ListItemIcon>
                  <Checkbox edge="start" checked={members.includes(u.number)} tabIndex={-1} disableRipple />
                </ListItemIcon>
                <ListItemText primary={u.name || u.number} secondary={u.number} />
              </ListItemButton>
            ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" disabled={busy || !name.trim() || !members.length} onClick={() => void save()}>
          {room ? 'Speichern' : 'Erstellen'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// -- Nachrichten -------------------------------------------------------------------------

function FileContent({ room, file, own }: { room: string; file: ChatFile; own: boolean }) {
  const [image, setImage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!file.type.startsWith('image/')) return
    let alive = true
    void api.messengerImage(room, file).then((r) => {
      if (!alive) return
      if (r.ok) setImage(r.value)
      else setError(r.error)
    })
    return () => {
      alive = false
    }
  }, [room, file])
  const open = (): void =>
    void api.messengerOpenFile(room, file).then((r) => {
      if (!r.ok) setError(r.error)
    })
  if (image) {
    return (
      <Box
        component="img"
        src={image}
        alt={file.name}
        onClick={open}
        sx={{ display: 'block', maxWidth: '100%', maxHeight: 320, borderRadius: 2, cursor: 'zoom-in', mb: 0.5 }}
      />
    )
  }
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.5 }}>
      <InsertDriveFileIcon sx={{ opacity: 0.8 }} />
      <Box sx={{ minWidth: 0, flex: 1, cursor: 'pointer' }} onClick={open}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
          {file.name}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.75 }}>
          {error || fileSize(file.size)}
        </Typography>
      </Box>
      <Tooltip title="Speichern unter …">
        <IconButton size="small" sx={{ color: own ? 'inherit' : undefined }} onClick={() => void api.messengerSaveFile(room, file)}>
          <DownloadIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}

function Bubble({ m, s, room, showName }: { m: ChatMessage; s: MessengerState; room: ChatRoom; showName: boolean }) {
  if (!m.from) {
    return (
      <Typography variant="caption" sx={{ alignSelf: 'center', color: 'text.secondary', bgcolor: 'action.hover', px: 1.5, py: 0.5, borderRadius: 2, my: 0.5, textAlign: 'center' }}>
        {m.text}
      </Typography>
    )
  }
  const own = m.from === s.me
  const others = room.members.filter((x) => x !== s.me)
  const readByAll = own && others.length > 0 && others.every((x) => (room.read[x] ?? 0) >= m.seq)
  const readBySome = own && others.some((x) => (room.read[x] ?? 0) >= m.seq)
  const time = new Date(m.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return (
    <Paper
      elevation={0}
      sx={{
        alignSelf: own ? 'flex-end' : 'flex-start',
        maxWidth: 'min(75%, 560px)',
        px: 1.5,
        py: 0.75,
        borderRadius: 3,
        borderTopRightRadius: own ? 6 : undefined,
        borderTopLeftRadius: own ? undefined : 6,
        bgcolor: own ? 'primary.main' : 'action.selected',
        color: own ? 'primary.contrastText' : 'text.primary',
      }}
    >
      {showName && !own && (
        <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, color: 'primary.main' }}>
          {userName(m.from, s)}
        </Typography>
      )}
      {m.file && <FileContent room={room.id} file={m.file} own={own} />}
      {m.text && (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>
          {m.text}
        </Typography>
      )}
      <Stack direction="row" sx={{ justifyContent: 'flex-end', alignItems: 'center', gap: 0.5, opacity: 0.75, mt: 0.25 }}>
        <Typography variant="caption" sx={{ fontSize: 11 }}>
          {time}
        </Typography>
        {own && (
          <Tooltip title={readByAll ? 'Gelesen' : readBySome ? 'Von einigen gelesen' : 'Zugestellt'}>
            {readByAll || readBySome ? <DoneAllIcon sx={{ fontSize: 15 }} /> : <DoneIcon sx={{ fontSize: 15 }} />}
          </Tooltip>
        )}
      </Stack>
    </Paper>
  )
}

/** Verlauf einer Unterhaltung: lädt seitenweise nach oben, neue Nachrichten unten an */
function useRoomMessages(room: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [complete, setComplete] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    void api.messengerHistory(room).then((r) => {
      setLoading(false)
      if (!r.ok) return setError(r.error)
      setError('')
      setMessages(r.value.messages)
      setComplete(r.value.complete)
    })
  }, [room])

  useEffect(() => {
    setMessages([])
    setComplete(false)
    load()
    const offs = [
      onMain('messenger-message', (m) => {
        if (m.room !== room) return
        setMessages((list) => (list.some((x) => x.seq === m.seq) ? list : [...list, m].sort((a, b) => a.seq - b.seq)))
      }),
      onMain('messenger-reset', load),
    ]
    return () => offs.forEach((off) => off())
  }, [room, load])

  const older = useCallback(async () => {
    if (complete || loading || !messages.length) return
    setLoading(true)
    const r = await api.messengerHistory(room, messages[0].seq)
    setLoading(false)
    if (!r.ok) return setError(r.error)
    setMessages((list) => [...r.value.messages.filter((m) => !list.some((x) => x.seq === m.seq)), ...list])
    setComplete(r.value.complete)
  }, [room, messages, complete, loading])

  return { messages, complete, loading, error, older }
}

function Composer({ room, disabled }: { room: string; disabled: boolean }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lastTyping = useRef(0)
  useEffect(() => setText(''), [room])

  const send = async (): Promise<void> => {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    const r = await api.messengerSend(room, value)
    setBusy(false)
    if (r.ok) {
      setText('')
      setError('')
    } else setError(r.error)
  }
  const onChange = (value: string): void => {
    setText(value)
    if (value && Date.now() - lastTyping.current > 3000) {
      lastTyping.current = Date.now()
      void api.messengerTyping(room)
    }
  }
  const attach = (): void =>
    void api.messengerPickFiles(room).then((r) => {
      if (!r.ok) setError(r.error)
    })
  // Bilder aus der Zwischenablage (Bildschirmfotos) direkt senden
  const onPaste = (e: React.ClipboardEvent): void => {
    const files = [...e.clipboardData.files]
    if (!files.length) return
    e.preventDefault()
    void (async () => {
      for (const f of files) {
        const r = await api.messengerSendData(room, f.name || 'bild.png', f.type, new Uint8Array(await f.arrayBuffer()))
        if (!r.ok) setError(r.error)
      }
    })()
  }

  return (
    <Box sx={{ px: 1.5, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}
      <Stack direction="row" sx={{ alignItems: 'flex-end', gap: 1 }}>
        <Tooltip title="Datei senden">
          <span>
            <IconButton onClick={attach} disabled={disabled}>
              <AttachFileIcon />
            </IconButton>
          </span>
        </Tooltip>
        <TextField
          fullWidth
          multiline
          maxRows={6}
          variant="filled"
          hiddenLabel
          size="small"
          slotProps={{ input: { disableUnderline: true } }}
          placeholder={disabled ? 'Keine Verbindung zur Telefonanlage' : 'Nachricht schreiben'}
          value={text}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          sx={PILL}
        />
        <Tooltip title="Senden (Enter)">
          <span>
            <IconButton
              aria-label="Senden"
              onClick={() => void send()}
              disabled={disabled || busy || !text.trim()}
              sx={{
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                '&:hover': { bgcolor: 'primary.dark' },
                '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
              }}
            >
              <SendIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Box>
  )
}

function ChatView({ s, room, video, onBack, onEdit }: { s: MessengerState; room: ChatRoom; video: boolean; onBack?: () => void; onEdit: () => void }) {
  const { messages, complete, loading, error, older } = useRoomMessages(room.id)
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const prevHeight = useRef(0)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [dropError, setDropError] = useState('')
  const other = room.kind === 'direct' ? otherMember(room, s) : ''
  const call = s.calls[room.id]
  const v = useVideo()
  const inCall = v.room === room.id && v.status !== 'idle'

  // Unten bleiben, wenn man unten war; beim Nachladen oben die Position halten
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (stick.current) el.scrollTop = el.scrollHeight
    else if (prevHeight.current && el.scrollHeight > prevHeight.current && el.scrollTop < 50) el.scrollTop += el.scrollHeight - prevHeight.current
    prevHeight.current = el.scrollHeight
  }, [messages])
  useEffect(() => {
    stick.current = true
  }, [room.id])
  // Bilder laden nach: unten bleiben, wenn man unten war
  useEffect(() => {
    const el = scroller.current
    if (!el || !content.current) return
    const observer = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight
      prevHeight.current = el.scrollHeight
    })
    observer.observe(content.current)
    return () => observer.disconnect()
  }, [])

  // Gelesen melden, solange das Fenster sichtbar ist
  const lastSeq = messages.at(-1)?.seq ?? 0
  useEffect(() => {
    const mark = (): void => {
      if (document.visibilityState === 'visible' && document.hasFocus() && lastSeq) void api.messengerRead(room.id, lastSeq)
    }
    mark()
    window.addEventListener('focus', mark)
    return () => window.removeEventListener('focus', mark)
  }, [room.id, lastSeq])

  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (el.scrollTop < 80) void older()
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    const paths = [...e.dataTransfer.files].map((f) => window.bridge.pathForFile(f)).filter(Boolean)
    if (paths.length)
      void api.messengerSendFiles(room.id, paths).then((r) => {
        if (!r.ok) setDropError(r.error)
      })
  }

  const typing = (s.typing[room.id] ?? []).map((x) => userName(x, s).split(' ')[0])
  const subtitle = typing.length
    ? `${typing.join(', ')} ${typing.length > 1 ? 'schreiben' : 'schreibt'} …`
    : room.kind === 'group'
      ? room.members.map((m) => (m === s.me ? 'Du' : userName(m, s).split(' ')[0])).join(', ')
      : s.online.includes(other)
        ? 'online'
        : `Nebenstelle ${other}`

  const rows: ReactNode[] = []
  let lastDay = ''
  messages.forEach((m, i) => {
    const day = new Date(m.time).toDateString()
    if (day !== lastDay) {
      lastDay = day
      rows.push(
        <Typography key={`d${m.seq}`} variant="caption" sx={{ alignSelf: 'center', color: 'text.secondary', my: 1 }}>
          {dayLabel(m.time)}
        </Typography>,
      )
    }
    const prev = messages[i - 1]
    const showName = room.kind === 'group' && (!prev || prev.from !== m.from || new Date(prev.time).toDateString() !== day)
    rows.push(<Bubble key={m.seq} m={m} s={s} room={room} showName={showName} />)
  })

  return (
    <Stack
      sx={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative' }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, pl: onBack ? 1 : 2, pr: 1, py: 1.25, minHeight: 64, boxSizing: 'border-box', borderBottom: 1, borderColor: 'divider' }}>
        {onBack && (
          <IconButton onClick={onBack} aria-label="Zurück">
            <ArrowBackIcon />
          </IconButton>
        )}
        <RoomAvatar room={room} s={s} size={40} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600, lineHeight: 1.3 }}>
            {roomTitle(room, s)}
          </Typography>
          <Typography variant="caption" noWrap component="div" sx={{ color: typing.length || s.online.includes(other) ? 'primary.main' : 'text.secondary' }}>
            {subtitle}
          </Typography>
        </Box>
        {video && (
          <Tooltip title={call ? 'Videoanruf beitreten' : 'Videoanruf'}>
            <span>
              <IconButton aria-label="Videoanruf" onClick={() => void joinVideo(room.id)} disabled={s.status !== 'online' || inCall} color={call ? 'success' : 'default'}>
                <VideocamIcon />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {other && (
          <Tooltip title={`${userName(other, s)} anrufen`}>
            <IconButton onClick={() => void api.dial(other)}>
              <CallIcon />
            </IconButton>
          </Tooltip>
        )}
        {room.kind === 'group' && (
          <>
            <IconButton onClick={(e) => setMenu(e.currentTarget)} aria-label="Weitere Aktionen">
              <MoreIcon />
            </IconButton>
            <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
              <MenuItem
                onClick={() => {
                  setMenu(null)
                  onEdit()
                }}
              >
                <ListItemIcon>
                  <EditIcon />
                </ListItemIcon>
                Gruppe bearbeiten
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenu(null)
                  void api.messengerLeave(room.id)
                  onBack?.()
                }}
              >
                <ListItemIcon>
                  <LogoutIcon />
                </ListItemIcon>
                Gruppe verlassen
              </MenuItem>
            </Menu>
          </>
        )}
      </Stack>
      {loading && <LinearProgress sx={{ position: 'absolute', top: 62, left: 0, right: 0, height: 2 }} />}
      {video && call && !inCall && (
        <Alert
          severity="success"
          icon={<VideocamIcon />}
          sx={{ mx: 2, mt: 1.5, alignItems: 'center' }}
          action={
            <Button color="inherit" size="small" onClick={() => void joinVideo(room.id)}>
              Beitreten
            </Button>
          }
        >
          Videoanruf läuft mit {call.participants.map((p) => (p === s.me ? 'dir' : userName(p, s).split(' ')[0])).join(', ')}
        </Alert>
      )}
      <Stack ref={scroller} onScroll={onScroll} sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1.5 }}>
        {/* Wenige Nachrichten stehen unten, wie in Chat-Apps üblich */}
        <Stack ref={content} sx={{ gap: 1, mt: 'auto', flexShrink: 0 }}>
          {complete && messages.length > 0 && (
            <Typography variant="caption" sx={{ alignSelf: 'center', color: 'text.disabled', my: 1 }}>
              Anfang der Unterhaltung
            </Typography>
          )}
          {rows}
          {!loading && !messages.length && !error && (
            <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', m: 'auto' }}>
              Schreib die erste Nachricht.
            </Typography>
          )}
          {error && (
            <Alert severity="warning" sx={{ m: 'auto' }}>
              {error}
            </Alert>
          )}
        </Stack>
      </Stack>
      {dropError && (
        <Alert severity="error" onClose={() => setDropError('')} sx={{ mx: 2, mb: 1.5 }}>
          {dropError}
        </Alert>
      )}
      <Composer room={room.id} disabled={s.status !== 'online'} />
      {dragging && (
        <Stack
          sx={{
            position: 'absolute',
            inset: 8,
            border: 2,
            borderStyle: 'dashed',
            borderColor: 'primary.main',
            borderRadius: 4,
            bgcolor: 'background.paper',
            opacity: 0.92,
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <AttachFileIcon color="primary" sx={{ fontSize: 48 }} />
          <Typography>Dateien hier ablegen zum Senden</Typography>
        </Stack>
      )}
    </Stack>
  )
}

// -- Seite ---------------------------------------------------------------------------------

export function MessengerPage({ wide }: { wide: boolean }) {
  const { state } = useApp()
  const s = useMessenger()
  const [current, setCurrent] = useState<string | null>(() => {
    const r = requested
    requested = null
    return r
  })
  const [dialog, setDialog] = useState<'direct' | 'group' | 'edit' | null>(null)
  const room = s.rooms.find((r) => r.id === current) ?? null

  useEffect(() => {
    const l = (id: string): void => {
      requested = null
      setCurrent(id)
    }
    openListeners.add(l)
    return () => {
      openListeners.delete(l)
    }
  }, [])

  // Der Hauptprozess unterdrückt Benachrichtigungen für die offene Unterhaltung
  useEffect(() => {
    void api.messengerFocus(room?.id ?? null)
    return () => void api.messengerFocus(null)
  }, [room?.id])

  if (!state.messenger.available) {
    return (
      <EmptyState
        icon={<ChatIcon />}
        title="Messenger nicht verfügbar"
        description="Der Messenger kommt von der Phone4All-Telefonanlage. Richte die App über die Anlage ein und schalte dort den Messenger ein."
      />
    )
  }

  const status =
    s.status === 'online' ? null : (
      <Alert severity={s.status === 'offline' ? 'warning' : 'info'} icon={s.status === 'offline' ? <CloudOffIcon /> : <CircularProgress size={18} />} sx={{ mx: 2, mb: 2 }}>
        {s.status === 'offline' ? 'Keine Verbindung zur Telefonanlage. Neuer Versuch läuft …' : 'Verbinde mit der Telefonanlage …'}
      </Alert>
    )

  const list = <RoomList s={s} current={room?.id ?? null} onOpen={setCurrent} onNew={(kind) => setDialog(kind)} />
  const chat = room ? (
    <ChatView key={room.id} s={s} room={room} video={state.messenger.video} onBack={wide ? undefined : () => setCurrent(null)} onEdit={() => setDialog('edit')} />
  ) : (
    <EmptyState icon={<ChatIcon />} title="Messenger" description="Wähle links einen Chat oder beginne einen neuen. Dateien kannst du einfach ins Fenster ziehen." />
  )

  return (
    <Stack sx={{ flex: 1, minHeight: 0, pt: 0.75, pb: 2 }}>
      {status}
      <Stack direction="row" sx={{ flex: 1, minHeight: 0, gap: 2, px: 2 }}>
        {wide ? (
          <>
            <Card sx={{ ...PANEL, width: 340, flexShrink: 0 }}>{list}</Card>
            <Card sx={{ ...PANEL, flex: 1, minWidth: 0 }}>{chat}</Card>
          </>
        ) : (
          <Card sx={{ ...PANEL, flex: 1, minWidth: 0 }}>{room ? chat : list}</Card>
        )}
      </Stack>
      {dialog === 'direct' && <NewChatDialog s={s} onClose={() => setDialog(null)} onOpen={setCurrent} />}
      {dialog === 'group' && <GroupDialog s={s} room={null} onClose={() => setDialog(null)} onOpen={setCurrent} />}
      {dialog === 'edit' && room && <GroupDialog s={s} room={room} onClose={() => setDialog(null)} onOpen={setCurrent} />}
    </Stack>
  )
}
