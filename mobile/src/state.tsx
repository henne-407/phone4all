/** Zustand der App: Profil, Telefon, Kontakte, Verlauf und Einstellungen. */

import * as Notifications from 'expo-notifications'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Linking, Platform } from 'react-native'
import { startService, stopService } from '../modules/call-service'
import { type Person, deviceContacts, fromPhonebook, sortPeople, toNamed } from './contacts'
import { findName } from './numbers'
import { type Call, type PhoneState, phone } from './phone'
import { type Presence, type Profile, crmUrl, fetchPresence, fetchProfile, fetchRevision } from './provisioning'
import {
  type HistoryEntry,
  type Settings,
  DEFAULT_SETTINGS,
  clearProfile,
  loadHistory,
  loadProfile,
  loadSettings,
  saveHistory,
  saveProfile,
  saveSettings,
} from './storage'

const POLL = 2 * 60 * 1000
/** Besetztanzeige: nur solange die App im Vordergrund ist */
const PRESENCE_POLL = 4000

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
})

interface Store {
  ready: boolean
  profile: Profile | null
  phone: PhoneState
  people: Person[]
  history: HistoryEntry[]
  settings: Settings
  /** Ändert sich, wenn die Anlage neue Termine meldet */
  eventsRevision: string
  /** Kollegen, geparkte Gespräche, Voicemail (null = unbekannt oder ältere Anlage) */
  presence: Presence | null
  contactsError: string
  setup(p: Profile): Promise<void>
  reset(): Promise<void>
  updateSettings(patch: Partial<Settings>): void
  toggleFavorite(number: string): void
  clearHistory(): void
  reloadProfile(): Promise<void>
}

const Ctx = createContext<Store | null>(null)

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider fehlt')
  return s
}

async function notifyIncoming(call: Call): Promise<void> {
  if (AppState.currentState === 'active') return
  await Notifications.scheduleNotificationAsync({
    identifier: `anruf-${call.id}`,
    content: {
      title: 'Eingehender Anruf',
      body: call.name ? `${call.name} (${call.number})` : call.number,
      sound: true,
      priority: Notifications.AndroidNotificationPriority.MAX,
      ...(Platform.OS === 'android' ? { channelId: 'anrufe' } : {}),
    },
    trigger: null,
  })
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [phoneState, setPhoneState] = useState<PhoneState>(phone.state)
  const [device, setDevice] = useState<Person[]>([])
  const [contactsError, setContactsError] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [eventsRevision, setEventsRevision] = useState('')
  const [presence, setPresence] = useState<Presence | null>(null)
  const profileRef = useRef<Profile | null>(null)
  profileRef.current = profile

  const people = useMemo(() => sortPeople([...fromPhonebook(profile?.phonebook ?? []), ...device]), [profile, device])
  const named = useMemo(() => toNamed(people), [people])

  // Laden beim Start
  useEffect(() => {
    void (async () => {
      const [p, h, s] = await Promise.all([loadProfile(), loadHistory(), loadSettings()])
      setHistory(h)
      setSettings(s)
      setProfile(p)
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('anrufe', {
          name: 'Anrufe',
          importance: Notifications.AndroidImportance.MAX,
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          sound: 'default',
          vibrationPattern: [0, 800, 800],
        })
      }
      setReady(true)
    })()
  }, [])

  // Telefon an das Profil koppeln
  useEffect(() => phone.subscribe(setPhoneState), [])
  useEffect(() => {
    const p = profileRef.current
    if (p?.remote) phone.start(p)
    else phone.stop()
    return () => phone.stop()
    // Nur neu verbinden, wenn sich der Zugang ändert – nicht mitten im Gespräch
  }, [profile?.remote?.websocket, profile?.remote?.user, profile?.password])
  useEffect(() => {
    if (profile) phone.setProfile(profile)
  }, [profile])

  useEffect(() => {
    phone.lookup = (n) => findName(n, named)
  }, [named])

  useEffect(() => {
    phone.onIncoming = (call) => void notifyIncoming(call).catch(() => undefined)
    // Anrufer von außen im CRM öffnen (App-Profil der Anlage)
    phone.onAnswered = (call) => {
      const crm = profileRef.current?.crm
      if (crm?.auto && call.direction === 'in' && call.number.replace(/\D/g, '').length > 5) {
        void Linking.openURL(crmUrl(crm.url, call.number, call.name)).catch(() => undefined)
      }
    }
    phone.onEnded = ({ call, missed }) => {
      void Notifications.dismissNotificationAsync(`anruf-${call.id}`).catch(() => undefined)
      if (missed && AppState.currentState !== 'active') {
        void Notifications.scheduleNotificationAsync({
          content: { title: 'Verpasster Anruf', body: call.name ? `${call.name} (${call.number})` : call.number },
          trigger: null,
        }).catch(() => undefined)
      }
      setHistory((h) => {
        const entry: HistoryEntry = {
          id: call.id,
          number: call.number,
          name: call.name,
          direction: call.direction,
          time: call.started,
          duration: call.answered ? Math.round((Date.now() - call.answered) / 1000) : 0,
          missed,
        }
        const next = [entry, ...h]
        void saveHistory(next)
        return next
      })
    }
  }, [])

  // Android: im Hintergrund erreichbar bleiben
  useEffect(() => {
    if (Platform.OS !== 'android') return
    if (profile && settings.background && phoneState.registration !== 'off') {
      const text = phoneState.registration === 'registered' ? `Erreichbar unter ${profile.extension}` : 'Verbindet …'
      startService(profile.pbx.name || 'SIP-Telefon', text)
    } else {
      stopService()
    }
  }, [profile, settings.background, phoneState.registration])

  // Gerätekontakte
  useEffect(() => {
    if (!settings.deviceContacts) {
      setDevice([])
      return
    }
    deviceContacts()
      .then((list) => {
        setDevice(list)
        setContactsError('')
      })
      .catch((e: Error) => setContactsError(e.message))
  }, [settings.deviceContacts])

  const reloadProfile = useCallback(async () => {
    const cur = profileRef.current
    if (!cur) return
    const next = await fetchProfile(cur.url)
    await saveProfile(next)
    setProfile(next)
  }, [])

  // Änderungen der Anlage abfragen (wie die Desktop-App alle zwei Minuten, solange sichtbar)
  useEffect(() => {
    if (!profile) return
    let stopped = false
    const check = async (): Promise<void> => {
      const cur = profileRef.current
      if (!cur || AppState.currentState !== 'active') return
      try {
        const rev = await fetchRevision(cur)
        if (stopped) return
        setEventsRevision(rev.events)
        if (rev.profile !== cur.revision) await reloadProfile()
      } catch {
        // offline: beim nächsten Mal
      }
    }
    void check()
    const timer = setInterval(() => void check(), POLL)
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        phone.refresh()
        void check()
      }
    })
    return () => {
      stopped = true
      clearInterval(timer)
      sub.remove()
    }
  }, [profile?.url, reloadProfile])

  // Besetztanzeige alle paar Sekunden, nur im Vordergrund
  useEffect(() => {
    if (!profile) {
      setPresence(null)
      return
    }
    let stopped = false
    const load = async (): Promise<void> => {
      const cur = profileRef.current
      if (!cur || AppState.currentState !== 'active') return
      try {
        const next = await fetchPresence(cur)
        if (!stopped) setPresence((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
      } catch {
        if (!stopped) setPresence(null)
      }
    }
    void load()
    const timer = setInterval(() => void load(), PRESENCE_POLL)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [profile?.url])

  const store: Store = {
    ready,
    presence,
    profile,
    phone: phoneState,
    people,
    history,
    settings,
    eventsRevision,
    contactsError,
    async setup(p) {
      await saveProfile(p)
      setProfile(p)
    },
    async reset() {
      phone.stop()
      stopService()
      await clearProfile()
      setHistory([])
      setProfile(null)
    },
    updateSettings(patch) {
      setSettings((s) => {
        const next = { ...s, ...patch }
        void saveSettings(next)
        return next
      })
    },
    toggleFavorite(number) {
      setSettings((s) => {
        const favorites = s.favorites.includes(number) ? s.favorites.filter((n) => n !== number) : [...s.favorites, number]
        const next = { ...s, favorites }
        void saveSettings(next)
        return next
      })
    },
    clearHistory() {
      setHistory([])
      void saveHistory([])
    },
    reloadProfile,
  }
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
