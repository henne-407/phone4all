/** Zustand des Messengers in der Oberfläche (kommt vom Hauptprozess). */

import { useEffect, useState } from 'react'
import type { ChatRoom, MessengerState } from '../../shared/types'
import { api, onMain } from './api'

const EMPTY: MessengerState = { status: 'off', me: '', users: [], online: [], rooms: [], typing: {}, calls: {} }

export function useMessenger(): MessengerState {
  const [state, setState] = useState<MessengerState>(EMPTY)
  useEffect(() => {
    void api.messengerState().then(setState)
    return onMain('messenger', setState)
  }, [])
  return state
}

export function roomTitle(room: ChatRoom, s: MessengerState): string {
  if (room.kind === 'group') return room.name
  const other = room.members.find((m) => m !== s.me) ?? s.me
  return userName(other, s)
}

export function userName(ext: string, s: MessengerState): string {
  return s.users.find((u) => u.number === ext)?.name || ext
}
