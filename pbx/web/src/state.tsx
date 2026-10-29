/** Gemeinsamer Zustand: Konfiguration der Anlage und Meldungen. */

import { Alert, Snackbar } from '@mui/material'
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { CollectionName, PbxConfig, SectionName } from '../../server/model'
import type { ProviderTemplate } from '../../server/providers'
import { type ConfigResponse, type SessionUser, api } from './api'

interface Pbx {
  config: PbxConfig
  user: SessionUser
  providers: ProviderTemplate[]
  states: Record<string, string>
  version: string
  reload: () => Promise<void>
  saveItem: <T extends { id?: string }>(kind: CollectionName, item: T) => Promise<T>
  removeItem: (kind: CollectionName, id: string) => Promise<void>
  saveSection: (section: SectionName, values: object) => Promise<void>
  toast: (text: string, severity?: 'success' | 'error' | 'info') => void
}

const Ctx = createContext<Pbx | null>(null)

export function usePbx(): Pbx {
  const v = useContext(Ctx)
  if (!v) throw new Error('PbxProvider fehlt')
  return v
}

export function PbxProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [data, setData] = useState<ConfigResponse | null>(null)
  const [message, setMessage] = useState<{ text: string; severity: 'success' | 'error' | 'info' } | null>(null)

  const reload = useCallback(async () => setData(await api.get<ConfigResponse>('/api/config')), [])
  useEffect(() => {
    void reload()
  }, [reload])

  const toast = useCallback((text: string, severity: 'success' | 'error' | 'info' = 'success') => setMessage({ text, severity }), [])

  if (!data) return <>{fallback}</>
  const value: Pbx = {
    ...data,
    reload,
    toast,
    saveItem: async (kind, item) => {
      const saved = await api.post<typeof item>(`/api/${kind}`, item)
      await reload()
      return saved
    },
    removeItem: async (kind, id) => {
      await api.del(`/api/${kind}/${id}`)
      await reload()
    },
    saveSection: async (section, values) => {
      await api.put(`/api/config/${section}`, values)
      await reload()
    },
  }
  return (
    <Ctx.Provider value={value}>
      {children}
      <Snackbar
        open={Boolean(message)}
        autoHideDuration={message?.severity === 'error' ? 8000 : 3000}
        onClose={() => setMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={message?.severity ?? 'info'} variant="filled" onClose={() => setMessage(null)}>
          {message?.text}
        </Alert>
      </Snackbar>
    </Ctx.Provider>
  )
}
