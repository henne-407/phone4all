/** Anwendungszustand aus dem Hauptprozess, Verlauf und Toasts als React-Kontext. */

import { Snackbar } from '@mui/material'
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { AppState, CallInfo, HistoryRow } from '../../shared/types'
import { api, onMain } from './api'

interface Ctx {
  state: AppState
  history: HistoryRow[]
  toast: (text: string) => void
}

const StateContext = createContext<Ctx | null>(null)

export function StateProvider({ children }: { children: (state: AppState) => ReactNode }) {
  const [state, setState] = useState<AppState | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [toasts, setToasts] = useState<{ key: number; text: string }[]>([])

  useEffect(() => {
    void api.getState().then(setState)
    void api.getHistory().then(setHistory)
    const offs = [
      onMain('state', setState),
      onMain('history', setHistory),
      onMain('toast', (text) => setToasts((t) => [...t, { key: Date.now() + Math.random(), text }])),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const toast = useCallback((text: string) => setToasts((t) => [...t, { key: Date.now() + Math.random(), text }]), [])
  const value = useMemo(() => (state ? { state, history, toast } : null), [state, history, toast])
  if (!value) return null
  const current = toasts[0]
  return (
    <StateContext.Provider value={value}>
      {children(value.state)}
      <Snackbar
        key={current?.key}
        open={Boolean(current)}
        message={current?.text}
        autoHideDuration={3500}
        onClose={(_e, reason) => reason !== 'clickaway' && setToasts((t) => t.slice(1))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 88 } }}
      />
    </StateContext.Provider>
  )
}

export function useApp(): Ctx {
  const ctx = useContext(StateContext)
  if (!ctx) throw new Error('StateProvider fehlt')
  return ctx
}

/** Das aktuelle Gespräch (nicht klingelnd), sonst ein klingelnder Anruf. */
export function activeCall(calls: CallInfo[], exclude?: string): CallInfo | null {
  const list = calls.filter((c) => c.id !== exclude)
  list.sort((a, b) => Number(a.state === 'incoming') - Number(b.state === 'incoming') || Number(a.held) - Number(b.held) || b.created - a.created)
  return list[0] ?? null
}

/** Sekündlich neu rendern (Gesprächsdauer). */
export function useTick(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    // Sofort aktualisieren: Sonst zeigt ein gerade angenommener Anruf eine Sekunde lang die Zeit vom Klingeln (negative Dauer)
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}
