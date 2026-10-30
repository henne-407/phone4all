/**
 * Videoanrufe im Messenger: Klingeln bei eingehenden Anrufen und die Anrufansicht
 * (bildschirmfüllend oder verkleinert als Leiste, damit der Chat bedienbar bleibt).
 */

import CallEndIcon from '@mui/icons-material/CallEnd'
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import OpenInFullIcon from '@mui/icons-material/OpenInFull'
import ScreenShareIcon from '@mui/icons-material/ScreenShare'
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare'
import VideocamIcon from '@mui/icons-material/Videocam'
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import { Alert, Box, Button, CardActionArea, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Fab, IconButton, Paper, Snackbar, Stack, Tooltip, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import type { ChatRoom, MessengerState } from '../../../shared/types'
import type { ScreenSource } from '../../../main/screenShare'
import { api, onMain } from '../api'
import { roomTitle, useMessenger, userName } from '../messenger'
import { clearNotice, joinVideo, leaveVideo, setCamera, setMinimized, setMuted, startScreenShare, stopScreenShare, useVideo, videoState } from '../video'
import { ContactAvatar } from './common'

/** So lange klingelt es (wie im Hauptprozess) */
const RING_MS = 45000

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Klingelton ohne Datei: zwei kurze Töne alle drei Sekunden */
function useRingTone(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const ctx = new AudioContext()
    const ring = (): void => {
      for (const [at, freq] of [
        [0, 660],
        [0.25, 880],
      ]) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0, ctx.currentTime + at)
        gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + at + 0.02)
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + at + 0.22)
        osc.connect(gain).connect(ctx.destination)
        osc.start(ctx.currentTime + at)
        osc.stop(ctx.currentTime + at + 0.25)
      }
    }
    ring()
    const t = setInterval(ring, 3000)
    return () => {
      clearInterval(t)
      void ctx.close()
    }
  }, [active])
}

function Video({ stream, muted = false, mirror = false, cover = true }: { stream: MediaStream; muted?: boolean; mirror?: boolean; cover?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream
  }, [stream])
  return (
    <Box
      component="video"
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      sx={{ width: '100%', height: '100%', objectFit: cover ? 'cover' : 'contain', transform: mirror ? 'scaleX(-1)' : undefined, display: 'block' }}
    />
  )
}

function Audio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  return <audio ref={ref} autoPlay />
}

/** Spalten für n Kacheln; im Hochformat untereinander */
function columns(n: number, portrait: boolean): number {
  if (portrait) return n <= 2 ? 1 : n <= 8 ? 2 : 3
  return n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4
}

function usePortrait(): boolean {
  const [portrait, setPortrait] = useState(window.innerHeight > window.innerWidth)
  useEffect(() => {
    const on = (): void => setPortrait(window.innerHeight > window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return portrait
}

function ControlButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip title={label}>
      <IconButton
        aria-label={label}
        onClick={onClick}
        sx={{
          width: 56,
          height: 56,
          bgcolor: active ? 'rgba(255,255,255,0.16)' : '#fff',
          color: active ? '#fff' : '#202124',
          '&:hover': { bgcolor: active ? 'rgba(255,255,255,0.28)' : '#e8eaed' },
        }}
      >
        {children}
      </IconButton>
    </Tooltip>
  )
}

/** Auswahl, was geteilt wird: ganze Bildschirme und einzelne Fenster mit Vorschau */
function ScreenPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sources, setSources] = useState<ScreenSource[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    setSources(null)
    setError('')
    void api.screenSources().then((r) => (r.ok ? setSources(r.value) : setError(r.error)))
  }, [open])
  const pick = (id: string): void => {
    onClose()
    void startScreenShare(id).then((notice) => notice && setError(notice))
  }
  const groups: [string, ScreenSource[]][] = [
    ['Bildschirme', (sources ?? []).filter((x) => x.screen)],
    ['Fenster', (sources ?? []).filter((x) => !x.screen)],
  ]
  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>Was möchtest du teilen?</DialogTitle>
        <DialogContent>
          {!sources && !error && (
            <Stack sx={{ alignItems: 'center', py: 4 }}>
              <CircularProgress />
            </Stack>
          )}
          {sources && !sources.length && (
            <Typography sx={{ color: 'text.secondary' }}>
              Keine Bildschirme gefunden. Unter macOS die Bildschirmaufnahme für Phone4All in den Systemeinstellungen erlauben.
            </Typography>
          )}
          {groups.map(
            ([label, list]) =>
              list.length > 0 && (
                <Box key={label} sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {label}
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 1.5 }}>
                    {list.map((x) => (
                      <CardActionArea key={x.id} onClick={() => pick(x.id)} sx={{ borderRadius: 2, p: 1, border: 1, borderColor: 'divider' }}>
                        <Box sx={{ aspectRatio: '16 / 9', bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden', mb: 0.75 }}>
                          {x.thumbnail && <Box component="img" src={x.thumbnail} alt="" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
                        </Box>
                        <Typography variant="body2" noWrap>
                          {x.name}
                        </Typography>
                      </CardActionArea>
                    ))}
                  </Box>
                </Box>
              ),
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Abbrechen</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={Boolean(error) && !open} autoHideDuration={8000} onClose={() => setError('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="warning" variant="filled" onClose={() => setError('')}>
          {error}
        </Alert>
      </Snackbar>
    </>
  )
}

function CallView({ s, room }: { s: MessengerState; room: ChatRoom | undefined }) {
  const v = useVideo()
  const now = useNow(v.status === 'active')
  const call = v.room ? s.calls[v.room] : undefined
  const others = (call?.participants ?? []).filter((p) => p !== s.me)
  const title = room ? roomTitle(room, s) : 'Videoanruf'
  const waiting = v.status === 'connecting' ? 'Verbinde …' : others.length ? '' : room?.kind === 'direct' ? 'Klingelt …' : 'Warte auf die anderen …'
  const n = v.remotes.length
  const cols = columns(n, usePortrait())
  const [picker, setPicker] = useState(false)
  // Teilen ersetzt das Kamerabild; ohne Kamera gibt es keine Bildübertragung
  const canShare = v.status === 'active' && Boolean(v.local?.getVideoTracks().length)

  return (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: (t) => t.zIndex.modal - 1, bgcolor: '#202124', color: '#fff', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, px: 2, py: 1.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          <Typography variant="caption" noWrap component="div" sx={{ opacity: 0.75 }}>
            {waiting || `${others.map((p) => userName(p, s).split(' ')[0]).join(', ')} · ${clock(now - v.since)}`}
          </Typography>
        </Box>
        <Tooltip title="Verkleinern">
          <IconButton aria-label="Verkleinern" onClick={() => setMinimized(true)} sx={{ color: '#fff' }}>
            <CloseFullscreenIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', px: 2 }}>
        {n ? (
          <Box sx={{ display: 'grid', gap: 1, height: '100%', gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: '1fr' }}>
            {v.remotes.map((r) => (
              <Box key={r.id} sx={{ borderRadius: 3, overflow: 'hidden', bgcolor: '#3c4043', minHeight: 0 }}>
                <Video stream={r.stream} muted cover={n > 1} />
              </Box>
            ))}
          </Box>
        ) : (
          <Stack sx={{ height: '100%', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <Stack direction="row" sx={{ gap: 1 }}>
              {(room?.members ?? []).filter((m) => m !== s.me).slice(0, 5).map((m) => (
                <ContactAvatar key={m} name={userName(m, s)} size={72} />
              ))}
            </Stack>
            <Typography sx={{ opacity: 0.8 }}>{waiting || 'Ohne Bild verbunden'}</Typography>
          </Stack>
        )}
        {v.local && (
          <Paper
            elevation={6}
            sx={{ position: 'absolute', right: 28, bottom: 12, width: { xs: 120, sm: 200 }, aspectRatio: '16 / 9', borderRadius: 2, overflow: 'hidden', bgcolor: '#3c4043' }}
          >
            {v.screen ? (
              <Video stream={v.screen} muted cover={false} />
            ) : v.camera && v.local.getVideoTracks().length ? (
              <Video stream={v.local} muted mirror />
            ) : (
              <Stack sx={{ height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                <VideocamOffIcon sx={{ opacity: 0.7 }} />
              </Stack>
            )}
          </Paper>
        )}
      </Box>

      <Stack direction="row" sx={{ justifyContent: 'center', alignItems: 'center', gap: 2, py: 2 }}>
        <ControlButton label={v.muted ? 'Mikrofon an' : 'Stummschalten'} active={!v.muted} onClick={() => setMuted(!v.muted)}>
          {v.muted ? <MicOffIcon /> : <MicIcon />}
        </ControlButton>
        <ControlButton label={v.camera ? 'Kamera aus' : 'Kamera an'} active={v.camera} onClick={() => setCamera(!v.camera)}>
          {v.camera ? <VideocamIcon /> : <VideocamOffIcon />}
        </ControlButton>
        {(canShare || v.screen) && (
          <ControlButton label={v.screen ? 'Teilen beenden' : 'Bildschirm teilen'} active={!v.screen} onClick={() => (v.screen ? void stopScreenShare() : setPicker(true))}>
            {v.screen ? <StopScreenShareIcon /> : <ScreenShareIcon />}
          </ControlButton>
        )}
        <Tooltip title="Auflegen">
          <Fab color="error" aria-label="Auflegen" onClick={() => leaveVideo()}>
            <CallEndIcon />
          </Fab>
        </Tooltip>
      </Stack>
      {v.audio && <Audio stream={v.audio} />}
      <ScreenPicker open={picker} onClose={() => setPicker(false)} />
    </Box>
  )
}

/** Verkleinerte Anrufansicht: Leiste unten, Ton läuft weiter */
function CallBar({ s, room }: { s: MessengerState; room: ChatRoom | undefined }) {
  const v = useVideo()
  const now = useNow(v.status === 'active')
  return (
    <Paper
      elevation={8}
      sx={{ position: 'fixed', left: '50%', bottom: 72, transform: 'translateX(-50%)', zIndex: (t) => t.zIndex.snackbar, borderRadius: 6, px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: '#202124', color: '#fff', maxWidth: 'calc(100vw - 32px)' }}
    >
      <VideocamIcon sx={{ color: 'success.light' }} />
      <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
        {room ? roomTitle(room, s) : 'Videoanruf'} · {v.status === 'active' ? clock(now - v.since) : 'Verbinde …'}
      </Typography>
      <IconButton size="small" aria-label={v.muted ? 'Mikrofon an' : 'Stummschalten'} onClick={() => setMuted(!v.muted)} sx={{ color: '#fff' }}>
        {v.muted ? <MicOffIcon fontSize="small" /> : <MicIcon fontSize="small" />}
      </IconButton>
      <Tooltip title="Vergrößern">
        <IconButton size="small" aria-label="Vergrößern" onClick={() => setMinimized(false)} sx={{ color: '#fff' }}>
          <OpenInFullIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <IconButton size="small" aria-label="Auflegen" onClick={() => leaveVideo()} sx={{ bgcolor: 'error.main', color: '#fff', '&:hover': { bgcolor: 'error.dark' } }}>
        <CallEndIcon fontSize="small" />
      </IconButton>
      {v.audio && <Audio stream={v.audio} />}
    </Paper>
  )
}

/** Eingehender Videoanruf */
function RingDialog({ s, room, onClose }: { s: MessengerState; room: string; onClose: () => void }) {
  const r = s.rooms.find((x) => x.id === room)
  const call = s.calls[room]
  useRingTone(true)
  if (!r || !call) return null
  const caller = userName(call.by, s)
  const accept = (camera: boolean): void => {
    onClose()
    void joinVideo(room, camera)
  }
  return (
    <Dialog open onClose={() => undefined} maxWidth="xs" fullWidth>
      <DialogContent>
        <Stack sx={{ alignItems: 'center', gap: 1.5, pt: 1 }}>
          <ContactAvatar name={r.kind === 'group' ? r.name : caller} size={80} />
          <Typography variant="h6" sx={{ textAlign: 'center' }}>
            {r.kind === 'group' ? `Videoanruf in „${r.name}“` : caller}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>
            {r.kind === 'group' ? `${caller} hat einen Videoanruf begonnen` : 'ruft per Video an'}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'center', gap: 1, pb: 3, flexWrap: 'wrap' }}>
        <Button
          color="error"
          variant="outlined"
          startIcon={<CallEndIcon />}
          onClick={() => {
            onClose()
            void api.messengerDecline(room)
          }}
        >
          Ablehnen
        </Button>
        <Button variant="outlined" startIcon={<MicIcon />} onClick={() => accept(false)}>
          Nur Ton
        </Button>
        <Button color="success" variant="contained" startIcon={<VideocamIcon />} onClick={() => accept(true)} autoFocus>
          Annehmen
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** Immer im Hauptfenster: Klingeln, Anrufansicht, Hinweise */
export function VideoCallLayer() {
  const s = useMessenger()
  const v = useVideo()
  const [ringing, setRinging] = useState<string | null>(null)

  useEffect(() => {
    const offs = [
      onMain('messenger-ring', ({ room, answer }) => {
        if (answer) {
          setRinging(null)
          void joinVideo(room)
        } else if (videoState().room !== room) setRinging(room)
      }),
      onMain('messenger-declined', ({ room, ext }) => {
        setRinging((r) => (r === room && ext === s.me ? null : r))
        // Einzelchat: Die Gegenseite will nicht – auflegen
        const cur = videoState()
        const r = s.rooms.find((x) => x.id === room)
        if (cur.room === room && ext !== s.me && r?.kind === 'direct') leaveVideo(`${userName(ext, s)} hat abgelehnt.`)
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [s])

  // Klingeln endet, wenn der Anruf vorbei ist, man selbst (auf einem Gerät) dabei ist, oder nach 45 s
  useEffect(() => {
    if (!ringing) return
    const call = s.calls[ringing]
    if (!call || call.participants.includes(s.me)) setRinging(null)
  }, [ringing, s])
  useEffect(() => {
    if (!ringing) return
    const t = setTimeout(() => setRinging(null), RING_MS)
    return () => clearTimeout(t)
  }, [ringing])

  // Einzelchat: Nimmt niemand ab, nach 45 s auflegen
  const room = v.room ? s.rooms.find((r) => r.id === v.room) : undefined
  const alone = v.status === 'active' && room?.kind === 'direct' && !(s.calls[room.id]?.participants ?? []).some((p) => p !== s.me)
  const met = useRef(false)
  useEffect(() => {
    if (v.status === 'idle') met.current = false
    else if (!alone && v.status === 'active') met.current = true
  }, [alone, v.status])
  useEffect(() => {
    if (!alone) return
    // Die Gegenseite hat aufgelegt: Einzelgespräch ist vorbei
    if (met.current) return leaveVideo()
    const t = setTimeout(() => leaveVideo('Niemand hat abgenommen.'), RING_MS)
    return () => clearTimeout(t)
  }, [alone])

  return (
    <>
      {v.status !== 'idle' && (v.minimized ? <CallBar s={s} room={room} /> : <CallView s={s} room={room} />)}
      {ringing && v.room !== ringing && <RingDialog s={s} room={ringing} onClose={() => setRinging(null)} />}
      <Snackbar open={Boolean(v.notice)} autoHideDuration={6000} onClose={clearNotice} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="info" onClose={clearNotice} variant="filled">
          {v.notice}
        </Alert>
      </Snackbar>
    </>
  )
}
