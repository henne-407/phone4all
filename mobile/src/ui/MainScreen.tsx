/** Hauptansicht: Bereiche unten, Status und Einstellungen oben. */

import { useMemo, useState } from 'react'
import { Appbar, BottomNavigation, Chip } from 'react-native-paper'
import type { AppPage } from '../provisioning'
import { visiblePages } from '../provisioning'
import { useStore } from '../state'
import { CalendarScreen } from './CalendarScreen'
import { ContactsScreen } from './ContactsScreen'
import { DialScreen } from './DialScreen'
import { HistoryScreen } from './HistoryScreen'
import { HomeScreen } from './HomeScreen'
import { SettingsScreen } from './SettingsScreen'
import { registrationLabel } from './common'

const PAGES: Record<AppPage, { title: string; focusedIcon: string; unfocusedIcon: string }> = {
  home: { title: 'Start', focusedIcon: 'home', unfocusedIcon: 'home-outline' },
  dial: { title: 'Wählen', focusedIcon: 'dialpad', unfocusedIcon: 'dialpad' },
  contacts: { title: 'Kontakte', focusedIcon: 'account-box', unfocusedIcon: 'account-box-outline' },
  calendar: { title: 'Kalender', focusedIcon: 'calendar-month', unfocusedIcon: 'calendar-month-outline' },
  history: { title: 'Verlauf', focusedIcon: 'history', unfocusedIcon: 'history' },
}

export function MainScreen({ onResetup }: { onResetup: () => void }) {
  const { profile, phone } = useStore()
  const pages = visiblePages(profile)
  const routes = useMemo(() => pages.map((key) => ({ key, ...PAGES[key] })), [pages.join()])
  const start = profile?.app?.start_tab && pages.includes(profile.app.start_tab) ? pages.indexOf(profile.app.start_tab) : 0
  const [index, setIndex] = useState(start)
  const [settings, setSettings] = useState(false)
  const [dial, setDial] = useState('')

  if (settings) return <SettingsScreen onClose={() => setSettings(false)} onResetup={onResetup} />

  const go = (page: AppPage): void => {
    const i = pages.indexOf(page)
    if (i >= 0) setIndex(i)
  }
  const status = registrationLabel(phone.registration)
  const renderScene = ({ route }: { route: { key: string } }) => {
    switch (route.key as AppPage) {
      case 'home':
        return <HomeScreen go={go} />
      case 'dial':
        return <DialScreen value={dial} onChange={setDial} />
      case 'contacts':
        return <ContactsScreen />
      case 'calendar':
        return <CalendarScreen />
      case 'history':
        return <HistoryScreen />
    }
  }
  return (
    <>
      <Appbar.Header elevated>
        <Appbar.Content title={profile?.account.display_name || 'SIP-Telefon'} subtitle={`${profile?.extension ?? ''} · ${profile?.pbx.name ?? ''}`} />
        <Chip compact icon={status.icon} style={{ marginRight: 4 }} onPress={() => setSettings(true)}>
          {status.text}
        </Chip>
        <Appbar.Action icon="cog-outline" accessibilityLabel="Einstellungen" onPress={() => setSettings(true)} />
      </Appbar.Header>
      <BottomNavigation
        navigationState={{ index: Math.min(index, routes.length - 1), routes }}
        onIndexChange={setIndex}
        renderScene={renderScene}
        labeled
      />
    </>
  )
}
