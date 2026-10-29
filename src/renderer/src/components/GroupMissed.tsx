/**
 * Verpasste Gruppenanrufe gemeinsam abarbeiten: Wer zurückruft, übernimmt den Eintrag,
 * die Anlage hakt ihn nach dem Rückruf ab. Die Liste ist für alle Mitglieder gleich.
 */

import CallIcon from '@mui/icons-material/Call'
import CheckIcon from '@mui/icons-material/Check'
import HandIcon from '@mui/icons-material/PanTool'
import UndoIcon from '@mui/icons-material/Undo'
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { formatTime } from '../../../shared/format'
import type { GroupMissed } from '../../../shared/types'
import { api } from '../api'
import { useApp } from '../state'

const HOW: Record<GroupMissed['done_how'], string> = {
  '': '',
  callback: 'zurückgerufen',
  answered: 'Anrufer kam durch',
  manual: 'erledigt',
}

export function GroupMissedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, toast } = useApp()
  const [list, setList] = useState<GroupMissed[] | null>(null)
  const me = state.settings.provisioning.extension
  const version = state.groupMissed?.version
  const name = (n: string): string => (n === me ? 'dir' : state.team?.extensions.find((e) => e.number === n)?.name || n)

  useEffect(() => {
    if (!open) return
    void api.pbxGroupMissed().then((r) => (r.ok ? setList(r.value) : toast(r.error)))
  }, [open, version])

  const act = (e: GroupMissed, action: 'claim' | 'release' | 'done' | 'reopen'): void =>
    void api.pbxGroupMissedAct(e.group, e.id, action).then((r) => (r.ok ? setList(r.value) : toast(r.error)))

  const callBack = (e: GroupMissed): void => {
    if (!e.claimed_by) act(e, 'claim')
    void api.dial(e.number)
    onClose()
  }

  const open_ = list?.filter((e) => !e.done_by) ?? []
  const done = list?.filter((e) => e.done_by) ?? []
  const row = (e: GroupMissed) => {
    const status = e.done_by
      ? `${HOW[e.done_how]} von ${name(e.done_by)}`
      : e.claimed_by
        ? `${name(e.claimed_by) === 'dir' ? 'Du kümmerst dich' : `${name(e.claimed_by)} kümmert sich`}`
        : 'offen'
    return (
      <ListItem key={`${e.group}-${e.id}`} sx={{ px: 0, opacity: e.done_by ? 0.7 : 1 }}>
        <ListItemText
          primary={e.name || e.number || 'Unbekannt'}
          secondary={[e.name && e.number, e.group_name, formatTime(Math.floor(e.time / 1000)), status].filter(Boolean).join(' · ')}
          slotProps={{ primary: { noWrap: true, sx: { fontWeight: e.done_by || e.claimed_by ? undefined : 600 } } }}
        />
        <Stack direction="row" sx={{ flexShrink: 0 }}>
          {!e.done_by && e.number && (
            <Tooltip title="Zurückrufen">
              <IconButton onClick={() => callBack(e)} sx={{ color: 'success.main' }}>
                <CallIcon />
              </IconButton>
            </Tooltip>
          )}
          {!e.done_by && !e.claimed_by && (
            <Tooltip title="Ich kümmere mich">
              <IconButton onClick={() => act(e, 'claim')}>
                <HandIcon />
              </IconButton>
            </Tooltip>
          )}
          {!e.done_by && e.claimed_by === me && (
            <Tooltip title="Doch nicht">
              <IconButton onClick={() => act(e, 'release')}>
                <UndoIcon />
              </IconButton>
            </Tooltip>
          )}
          {e.done_by ? (
            <Tooltip title="Wieder öffnen">
              <IconButton onClick={() => act(e, 'reopen')}>
                <UndoIcon />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title="Erledigt">
              <IconButton onClick={() => act(e, 'done')}>
                <CheckIcon />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </ListItem>
    )
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Verpasste Gruppenanrufe</DialogTitle>
      <DialogContent>
        {!list ? (
          <CircularProgress sx={{ display: 'block', mx: 'auto', my: 4 }} />
        ) : !list.length ? (
          <Typography sx={{ color: 'text.secondary' }}>Keine verpassten Anrufe in deinen Gruppen.</Typography>
        ) : (
          <>
            <List dense disablePadding>
              {open_.map(row)}
            </List>
            {done.length > 0 && (
              <>
                <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', mt: 2 }}>
                  Erledigt
                </Typography>
                <List dense disablePadding>
                  {done.map(row)}
                </List>
              </>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Schließen</Button>
      </DialogActions>
    </Dialog>
  )
}
