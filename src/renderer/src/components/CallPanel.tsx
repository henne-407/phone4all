/**
 * Anrufansicht für Hauptfenster und kleines Anruffenster.
 * Beim Klingeln: Annehmen, Ablehnen, Klingelton aus, Weiterleiten.
 * Im Gespräch: Stumm, Halten, Tastatur, Weiterleiten, Rückfrage, (Termin), Auflegen.
 * Bei zwei Gesprächen (Rückfrage): Makeln, Verbinden und Dreierkonferenz über die Anlage.
 */

import CallIcon from '@mui/icons-material/Call'
import CallEndIcon from '@mui/icons-material/CallEnd'
import CallMergeIcon from '@mui/icons-material/CallMerge'
import ConsultIcon from '@mui/icons-material/AddIcCall'
import GroupsIcon from '@mui/icons-material/Groups'
import DialpadIcon from '@mui/icons-material/Dialpad'
import EventIcon from '@mui/icons-material/EventAvailable'
import LocalParkingIcon from '@mui/icons-material/LocalParking'
import MicOffIcon from '@mui/icons-material/MicOff'
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PauseIcon from '@mui/icons-material/Pause'
import SwapCallsIcon from '@mui/icons-material/SwapCalls'
import ForwardIcon from '@mui/icons-material/PhoneForwarded'
import { Box, Button, Collapse, Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { formatDuration } from '../../../shared/format'
import type { CallInfo } from '../../../shared/types'
import { api } from '../api'
import { activeCall, useApp, useTick } from '../state'
import { CallToggle, ContactAvatar, DialPad, RoundAction } from './common'
import { TransferPopover } from './TransferPopover'

function statusText(call: CallInfo, now: number): string {
  switch (call.state) {
    case 'incoming':
      return 'Eingehender Anruf'
    case 'calling':
      return 'Verbinde …'
    case 'ringing':
      return 'Klingelt …'
    case 'established': {
      let text = formatDuration(call.established ? (now - call.established) / 1000 : 0)
      if (call.held) text += ' · gehalten'
      else if (call.remoteHeld) text += ' · Gegenseite hält'
      return text
    }
  }
}

export function CallPanel({ call, popup = false }: { call: CallInfo; popup?: boolean }) {
  const { state, toast } = useApp()
  const now = useTick(call.state === 'established')
  const [keypad, setKeypad] = useState(false)
  const [digits, setDigits] = useState('')
  const [silenced, setSilenced] = useState(false)
  const [transferAnchor, setTransferAnchor] = useState<HTMLElement | null>(null)
  const [consultAnchor, setConsultAnchor] = useState<HTMLElement | null>(null)
  const [joining, setJoining] = useState(false)
  const ringing = call.state === 'incoming'
  const established = call.state === 'established'
  const otherCall = ringing && activeCall(state.calls, call.id) !== null
  // Rückfrage läuft: zwei Gespräche, die die Anlage zusammenführen kann
  const pbx = Boolean(state.settings.provisioning.pbx)
  const canJoin = pbx && established && state.calls.length === 2 && state.calls.every((c) => c.state === 'established')

  const join = async (mode: 'transfer' | 'conference'): Promise<void> => {
    setJoining(true)
    const r = await api.pbxJoinCalls(mode)
    setJoining(false)
    if (!r.ok) toast(r.error)
  }

  useEffect(() => {
    setKeypad(false)
    setDigits('')
  }, [call.id])

  const dtmf = (digit: string): void => {
    setDigits((d) => (d + digit).slice(-24))
    void api.sendDtmf(digit, call.id)
  }

  // Tastatureingaben während des Gesprächs als DTMF senden
  useEffect(() => {
    if (!established) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).tagName === 'INPUT') return
      if (/^[0-9*#]$/.test(e.key)) dtmf(e.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const caption = established ? 'Gespräch' : call.direction === 'in' ? 'Eingehender Anruf' : 'Ausgehender Anruf'
  return (
    <Stack sx={{ alignItems: 'center', justifyContent: 'center', flex: 1, px: 3, py: popup ? 2 : 4, gap: 0.75, minHeight: 0 }}>
      {popup && (
        <Typography variant="overline" sx={{ color: 'text.secondary' }}>
          {caption}
        </Typography>
      )}
      <Collapse in={!keypad}>
        <Box sx={{ my: 1.5 }}>
          <ContactAvatar name={call.name} size={popup ? 96 : 112} />
        </Box>
      </Collapse>
      <Typography variant="h4" sx={{ textAlign: 'center', maxWidth: '100%', overflowWrap: 'anywhere' }}>
        {call.name || call.number}
      </Typography>
      {call.name && <Typography sx={{ color: 'text.secondary' }}>{call.number}</Typography>}
      {call.company && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {call.company}
        </Typography>
      )}
      {!ringing && (
        <Typography sx={{ color: 'primary.main', fontVariantNumeric: 'tabular-nums', mt: 0.5 }}>
          {statusText(call, now)}
        </Typography>
      )}
      {otherCall && (
        <Typography variant="body2" sx={{ color: 'warning.main', mt: 0.5 }}>
          Annehmen hält das laufende Gespräch
        </Typography>
      )}
      {!ringing &&
        state.calls
          .filter((c) => c.id !== call.id && c.state === 'established')
          .map((c) => (
            <Button key={c.id} size="small" variant="outlined" startIcon={<SwapCallsIcon />} sx={{ mt: 1 }} onClick={() => void api.switchCall(c.id)}>
              {c.held ? 'Wechseln zu' : 'Läuft:'} {c.name || c.number}
            </Button>
          ))}
      {canJoin && (
        <Stack direction="row" sx={{ gap: 1, mt: 1 }}>
          <Button size="small" variant="contained" startIcon={<CallMergeIcon />} disabled={joining} onClick={() => void join('transfer')}>
            Verbinden
          </Button>
          <Button size="small" variant="contained" startIcon={<GroupsIcon />} disabled={joining} onClick={() => void join('conference')}>
            Konferenz
          </Button>
        </Stack>
      )}

      {ringing ? (
        <>
          <Stack direction="row" sx={{ gap: 1, mt: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<NotificationsOffIcon />}
              disabled={silenced}
              onClick={() => {
                void api.stopRinging()
                setSilenced(true)
              }}
            >
              Stumm klingeln
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<ForwardIcon />}
              onClick={(e) => setTransferAnchor(e.currentTarget)}
            >
              Weiterleiten
            </Button>
          </Stack>
          <Stack direction="row" sx={{ gap: 8, mt: 4 }}>
            <Stack sx={{ alignItems: 'center', gap: 1 }}>
              <RoundAction kind="hangup" icon={<CallEndIcon />} label="Ablehnen" onClick={() => void api.hangup(call.id)} />
              <Typography variant="caption">Ablehnen</Typography>
            </Stack>
            <Stack sx={{ alignItems: 'center', gap: 1 }}>
              <RoundAction
                kind="call"
                icon={<CallIcon />}
                label="Annehmen"
                autoFocus
                onClick={() => void api.accept(call.id, popup ? 'popup' : 'window')}
              />
              <Typography variant="caption">Annehmen</Typography>
            </Stack>
          </Stack>
        </>
      ) : (
        <>
          <Collapse in={keypad}>
            <Stack sx={{ alignItems: 'center', gap: 1, mt: 2 }}>
              <Typography variant="h5" sx={{ minHeight: 32, fontVariantNumeric: 'tabular-nums' }}>
                {digits}
              </Typography>
              <DialPad compact onDigit={dtmf} />
            </Stack>
          </Collapse>
          <Stack direction="row" sx={{ gap: 0.5, mt: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
            <CallToggle
              icon={<MicOffIcon />}
              label="Stumm"
              active={call.muted}
              disabled={!established}
              onClick={() => void api.setMute(!call.muted, call.id)}
            />
            <CallToggle
              icon={<PauseIcon />}
              label="Halten"
              active={call.held}
              disabled={!established}
              onClick={() => void api.setHold(!call.held, call.id)}
            />
            <CallToggle
              icon={<DialpadIcon />}
              label="Tastatur"
              active={keypad}
              disabled={!established}
              onClick={() => setKeypad((k) => !k)}
            />
            <CallToggle
              icon={<ForwardIcon />}
              label="Weiterleiten"
              disabled={!established}
              onClick={(e) => setTransferAnchor(e.currentTarget)}
            />
            {pbx && (
              <CallToggle
                icon={<ConsultIcon />}
                label="Rückfrage"
                disabled={!established || state.calls.length > 1}
                onClick={(e) => setConsultAnchor(e.currentTarget)}
              />
            )}
            {state.settings.provisioning.parking && (
              <CallToggle icon={<LocalParkingIcon />} label="Parken" disabled={!established} onClick={() => void api.park(call.id)} />
            )}
            {state.settings.provisioning.crm && (
              <CallToggle icon={<OpenInNewIcon />} label="CRM" onClick={() => void api.openCrm(call.number, call.name)} />
            )}
            {!popup && (
              <CallToggle
                icon={<EventIcon />}
                label="Termin"
                disabled={!established}
                onClick={() => void api.scheduleCallback(call.number, call.name)}
              />
            )}
          </Stack>
          <Box sx={{ mt: 3 }}>
            <RoundAction kind="hangup" icon={<CallEndIcon />} label="Auflegen" onClick={() => void api.hangup(call.id)} />
          </Box>
        </>
      )}
      <TransferPopover
        anchor={transferAnchor}
        onClose={() => setTransferAnchor(null)}
        onTransfer={(target) => void api.transfer(call.id, target)}
      />
      <TransferPopover
        anchor={consultAnchor}
        onClose={() => setConsultAnchor(null)}
        onTransfer={(target) => void api.consult(call.id, target)}
        title="Rückfrage bei"
        icon={<ConsultIcon />}
      />
    </Stack>
  )
}
