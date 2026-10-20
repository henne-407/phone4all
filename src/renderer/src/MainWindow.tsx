/** Hauptfenster: Titelleiste, Navigation, Seiten, laufende Anrufe und Dialoge. */

import CalendarIcon from '@mui/icons-material/CalendarMonth'
import ContactsIcon from '@mui/icons-material/Contacts'
import DialpadIcon from '@mui/icons-material/Dialpad'
import HistoryIcon from '@mui/icons-material/History'
import HomeIcon from '@mui/icons-material/Home'
import {
  Alert,
  Badge,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import type { CalEvent, Contact, PageName } from '../../shared/types'
import { api, onMain, platform } from './api'
import { useUiEvent } from './bus'
import { CallPanel } from './components/CallPanel'
import { ContactDialog } from './components/ContactDialog'
import { EventDialog } from './components/EventDialog'
import { PbxSetupDialog } from './components/settings/PbxSetupDialog'
import { PreferencesDialog } from './components/settings/PreferencesDialog'
import { TopBar } from './components/TopBar'
import { CalendarPage } from './pages/CalendarPage'
import { ContactsPage } from './pages/ContactsPage'
import { DialPage } from './pages/DialPage'
import { HistoryPage } from './pages/HistoryPage'
import { CustomizeHomeDialog, HomePage } from './pages/HomePage'
import { activeCall, useApp } from './state'

const PAGES: [PageName, string, ReactNode][] = [
  ['home', 'Start', <HomeIcon key="i" />],
  ['dial', 'Wählen', <DialpadIcon key="i" />],
  ['contacts', 'Kontakte', <ContactsIcon key="i" />],
  ['calendar', 'Kalender', <CalendarIcon key="i" />],
  ['history', 'Verlauf', <HistoryIcon key="i" />],
]

function useWidth(): number {
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/** Seitennavigation für breite Fenster */
function NavRail({ page, onChange, missed }: { page: PageName; onChange: (p: PageName) => void; missed: boolean }) {
  return (
    <Tabs
      orientation="vertical"
      value={page}
      onChange={(_e, v: PageName) => onChange(v)}
      sx={{ width: 96, flexShrink: 0, borderRight: 1, borderColor: 'divider' }}
    >
      {PAGES.map(([key, label, icon]) => (
        <Tab
          key={key}
          value={key}
          label={label}
          sx={{ minWidth: 0 }}
          icon={
            <Badge color="error" variant="dot" invisible={!(key === 'history' && missed)}>
              {icon}
            </Badge>
          }
        />
      ))}
    </Tabs>
  )
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  const { state } = useApp()
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogContent>
        <Stack sx={{ alignItems: 'center', textAlign: 'center', gap: 1, pt: 2 }}>
          <Box component="img" src="./icon.png" sx={{ width: 96, height: 96 }} />
          <Typography variant="h5">SIP-Telefon</Typography>
          <Typography sx={{ color: 'text.secondary' }}>Version {state.platform.version}</Typography>
          <Typography sx={{ mt: 1 }}>Einfacher SIP-Softphone-Client für Linux, macOS und Windows.</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            SIP und Audio: baresip · Oberfläche: Material UI · Lizenz: MIT
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button variant="contained" onClick={onClose}>
          Schließen
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function MainWindow() {
  const { state } = useApp()
  const width = useWidth()
  const [page, setPage] = useState<PageName>(state.settings.home.start_tab)
  const [contact, setContact] = useState<Partial<Contact> | null>(null)
  const [event, setEvent] = useState<{ event: Partial<CalEvent>; isNew: boolean } | null>(null)
  const [prefs, setPrefs] = useState<string | null>(null)
  const [customize, setCustomize] = useState(false)
  const [about, setAbout] = useState(false)
  const [pbxLink, setPbxLink] = useState<string | null>(null)

  const narrow = width < 560
  const columns = width >= 1160 ? 3 : width >= 760 ? 2 : 1
  const wide = columns > 1
  const call = activeCall(state.calls)

  const navigate = useCallback((p: PageName) => setPage(p), [])
  useUiEvent('navigate', navigate)
  useUiEvent('edit-contact', useCallback((c: Partial<Contact>) => setContact(c), []))
  useUiEvent('open-event', useCallback((e: { event: Partial<CalEvent>; isNew: boolean }) => setEvent(e), []))
  useUiEvent('open-preferences', useCallback((p: string) => setPrefs(p), []))
  useUiEvent('customize-home', useCallback(() => setCustomize(true), []))
  useUiEvent('about', useCallback(() => setAbout(true), []))

  // Einrichtungslink der Telefonanlage (sip-telefon://…), auch wenn er die App gestartet hat
  useEffect(() => {
    const take = (): void => void api.takePbxLink().then((link) => link && setPbxLink(link))
    take()
    return onMain('pbx-link', take)
  }, [])

  useEffect(() => {
    const offs = [
      onMain('navigate', setPage),
      onMain('new-event', (prefill) => setEvent({ event: prefill, isNew: true })),
      onMain('open-preferences', (p) => setPrefs(p)),
      onMain('edit-contact', (c) => setContact(c)),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Tastenkürzel: Strg+, Einstellungen, Strg+Q Beenden, Strg+W Fenster schließen
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = platform === 'darwin' ? e.metaKey : e.ctrlKey
      if (!mod) return
      if (e.key === ',') {
        e.preventDefault()
        setPrefs('account')
      } else if (e.key === 'q' && platform !== 'darwin') {
        e.preventDefault()
        void api.quit()
      } else if (e.key === 'w') {
        e.preventDefault()
        window.close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const banner = state.banner

  let content: ReactNode
  if (call) {
    content = <CallPanel call={call} />
  } else {
    switch (page) {
      case 'home':
        content = <HomePage columns={columns} />
        break
      case 'dial':
        content = <DialPage wide={wide} />
        break
      case 'contacts':
        content = <ContactsPage wide={wide} />
        break
      case 'calendar':
        content = <CalendarPage wide={wide} />
        break
      case 'history':
        content = <HistoryPage wide={wide} />
        break
    }
  }

  return (
    <Stack sx={{ height: '100vh', bgcolor: 'background.default', color: 'text.primary' }}>
      <TopBar compact={narrow} showTitle={!narrow} />
      {banner && (
        <Alert
          severity={banner.action === 'reconnect' ? 'error' : 'info'}
          sx={{ mx: 1.5, mb: 1, alignItems: 'center' }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => (banner.action === 'reconnect' ? void api.restartEngine() : setPrefs('account'))}
            >
              {banner.button}
            </Button>
          }
        >
          {banner.text}
        </Alert>
      )}
      <Stack direction="row" sx={{ flex: 1, minHeight: 0 }}>
        {wide && !call && <NavRail page={page} onChange={setPage} missed={state.missedUnseen} />}
        <Stack sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>{content}</Stack>
      </Stack>
      {!wide && !call && (
        <BottomNavigation
          showLabels
          value={page}
          onChange={(_e, v: PageName) => setPage(v)}
        >
          {PAGES.map(([key, label, icon]) => (
            <BottomNavigationAction
              key={key}
              value={key}
              label={label}
              icon={
                <Badge color="error" variant="dot" invisible={!(key === 'history' && state.missedUnseen)}>
                  {icon}
                </Badge>
              }
            />
          ))}
        </BottomNavigation>
      )}

      {contact && <ContactDialog contact={contact} onClose={() => setContact(null)} />}
      {event && <EventDialog event={event.event} isNew={event.isNew} onClose={() => setEvent(null)} />}
      {prefs && <PreferencesDialog page={prefs} onClose={() => setPrefs(null)} />}
      {pbxLink && <PbxSetupDialog link={pbxLink} onClose={() => setPbxLink(null)} onApplied={() => setPrefs(null)} />}
      {customize && <CustomizeHomeDialog onClose={() => setCustomize(false)} />}
      {about && <AboutDialog onClose={() => setAbout(false)} />}
    </Stack>
  )
}
