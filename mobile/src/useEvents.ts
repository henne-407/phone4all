/** Termine der zentralen Kalender laden; neu laden, wenn die Anlage Änderungen meldet. */

import { useCallback, useEffect, useState } from 'react'
import { type CalendarEvent, fetchEvents } from './provisioning'
import { useStore } from './state'

export function useEvents(days: number): { events: CalendarEvent[]; loading: boolean; error: string; reload: () => void } {
  const { profile, eventsRevision } = useStore()
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const hasCalendars = Boolean(profile?.calendars.length)

  useEffect(() => {
    if (!profile || !hasCalendars) {
      setEvents([])
      return
    }
    let cancelled = false
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days)
    setLoading(true)
    fetchEvents(profile, start, end)
      .then((list) => {
        if (cancelled) return
        setEvents(list)
        setError('')
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [profile?.url, hasCalendars, eventsRevision, days, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { events, loading, error, reload }
}
