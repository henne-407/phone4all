/** Voicemail der Telefonanlage: Nachrichten anhören (oder lesen), zurückrufen, löschen */

import CallIcon from '@mui/icons-material/Call'
import DeleteIcon from '@mui/icons-material/DeleteOutlined'
import PlayIcon from '@mui/icons-material/PlayArrow'
import VoicemailIcon from '@mui/icons-material/Voicemail'
import { Box, Card, CircularProgress, IconButton, List, ListItem, ListItemIcon, ListItemText, Stack, Tooltip, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { formatDuration, formatTime } from '../../../shared/format'
import type { VoicemailMessage } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../state'
import { EmptyState } from './common'

export function VoicemailList({ wide }: { wide: boolean }) {
  const { state, toast } = useApp()
  const [messages, setMessages] = useState<VoicemailMessage[] | null>(null)
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null)
  const [loading, setLoading] = useState('')
  const version = state.voicemail?.version

  useEffect(() => {
    void api.pbxVoicemail().then((r) => {
      if (r.ok) setMessages(r.value)
      else toast(r.error)
    })
  }, [version])
  useEffect(
    () => () => {
      if (playing) URL.revokeObjectURL(playing.url)
    },
    [playing],
  )

  const play = (m: VoicemailMessage): void => {
    setLoading(m.id)
    void api
      .pbxVoicemailAudio(m.id)
      .then((r) => {
        if (!r.ok) return toast(r.error)
        setPlaying({ id: m.id, url: URL.createObjectURL(new Blob([r.value as BlobPart], { type: 'audio/wav' })) })
        if (m.unread) void api.pbxVoicemailRead(m.id).then((x) => x.ok && setMessages(x.value))
      })
      .finally(() => setLoading(''))
  }
  const remove = (m: VoicemailMessage): void =>
    void api.pbxVoicemailDelete(m.id).then((r) => {
      if (!r.ok) return toast(r.error)
      setMessages(r.value)
      if (playing?.id === m.id) setPlaying(null)
      toast('Nachricht gelöscht')
    })

  if (!messages) return <CircularProgress sx={{ m: 'auto' }} />
  if (!messages.length) return <EmptyState icon={<VoicemailIcon />} title="Keine Nachrichten" description="Hier erscheinen Nachrichten, die Anrufer auf deiner Voicemail hinterlassen." />
  return (
    <Box sx={{ overflowY: 'auto', flex: 1, px: 2, pb: 2 }}>
      <Card sx={{ maxWidth: wide ? 900 : 560, mx: 'auto' }}>
        <List disablePadding>
          {messages.map((m) => {
            const who = m.name || m.number || 'Unbekannt'
            const details = [formatTime(Math.floor(m.time / 1000)), formatDuration(m.duration)]
            if (m.name && m.number) details.unshift(m.number)
            return (
              <ListItem key={m.id} sx={{ flexWrap: 'wrap', pr: 1 }}>
                <ListItemIcon sx={{ minWidth: 40, color: m.unread ? 'primary.main' : 'text.secondary' }}>
                  <VoicemailIcon />
                </ListItemIcon>
                <ListItemText
                  primary={who}
                  secondary={details.join(' · ')}
                  slotProps={{ primary: { noWrap: true, sx: { fontWeight: m.unread ? 600 : undefined } }, secondary: { noWrap: true } }}
                />
                <Stack direction="row">
                  <Tooltip title="Anhören">
                    <span>
                      <IconButton onClick={() => play(m)} disabled={loading === m.id}>
                        {loading === m.id ? <CircularProgress size={20} /> : <PlayIcon />}
                      </IconButton>
                    </span>
                  </Tooltip>
                  {m.number && (
                    <Tooltip title="Zurückrufen">
                      <IconButton onClick={() => void api.dial(m.number)} sx={{ color: 'success.main' }}>
                        <CallIcon />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title="Löschen">
                    <IconButton onClick={() => remove(m)}>
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                </Stack>
                {(m.text || m.transcribing) && (
                  <Typography
                    variant="body2"
                    sx={{ width: '100%', pl: 5, pr: 1, pb: 1, color: m.text ? 'text.primary' : 'text.secondary', fontStyle: m.text ? undefined : 'italic', whiteSpace: 'pre-wrap' }}
                  >
                    {m.text ? `„${m.text}“` : 'Wird in Text umgewandelt …'}
                  </Typography>
                )}
                {playing?.id === m.id && (
                  <Box sx={{ width: '100%', pl: 5, pb: 1 }}>
                    <audio controls autoPlay src={playing.url} style={{ width: '100%' }} />
                  </Box>
                )}
              </ListItem>
            )
          })}
        </List>
      </Card>
    </Box>
  )
}
