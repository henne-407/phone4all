import { useEffect, useState } from 'react'
import { type StatusResponse, api } from './api'

/** Live-Status der Anlage, alle paar Sekunden aktualisiert. */
export function useStatus(intervalMs = 5000): [StatusResponse | null, () => void] {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      api
        .get<StatusResponse>('/api/status')
        .then((s) => alive && setStatus(s))
        .catch(() => undefined)
    }
    load()
    const t = setInterval(load, intervalMs)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [intervalMs, tick])
  return [status, () => setTick((t) => t + 1)]
}
