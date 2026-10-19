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
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  Stack,
  Typography,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import type { CalEvent, Contact, PageName } from '../../shared/types'
import { api, onMain, platform } from './api'
import { useUiEvent } from './bus'
import { CallPanel } from './components/CallPanel'
import { ContactDialog } from './components/ContactDialog'
import { EventDialog } from './components/EventDialog'
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

/** Navigation Rail (M3) für breite Fenster */
function NavRail({ page, onChange, missed }: { page: PageName; onChange: (p: PageName) => void; missed: boolean }) {
  const { md } = useTheme()
  return (
    <Stack sx={{ width: 88, flexShrink: 0, alignItems: 'center', gap: 1.5, pt: 2 }}>
      {PAGES.map(([key, label, icon]) => {
        const active = key === page
        return (
          <ButtonBase
            key={key}
            onClick={() => onChange(key)}
            sx={{ flexDirection: 'column', gap: 0.5, width: 80, borderRadius: 4, py: 0.5 }}
            aria-current={active ? 'page' : undefined}
          >
            <Box
              sx={{
                width: 56,
                height: 32,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: active ? md.secondaryContainer : 'transparent',
                color: active ? md.onSecondaryContainer : md.onSurfaceVariant,
                '&:hover': { bgcolor: active ? md.secondaryContainer : alpha(md.onSurface, 0.08) },
              }}
            >
              <Badge color="error" variant="dot" invisible={!(key === 'history' && missed)}>
                {icon}
              </Badge>
            </Box>
            <Typography sx={{ fontSize: 12, fontWeight: active ? 700 : 500, color: active ? md.onSurface : md.onSurfaceVariant }}>
              {label}
            </Typography>
          </ButtonBase>
        )
      })}
    </Stack>
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
  const { md } = useTheme()
  const width = useWidth()
  const [page, setPage] = useState<PageName>(state.settings.home.start_tab)
  const [contact, setContact] = useState<Partial<Contact> | null>(null)
  const [event, setEvent] = useState<{ event: Partial<CalEvent>; isNew: boolean } | null>(null)
  const [prefs, setPrefs] = useState<string | null>(null)
  const [customize, setCustomize] = useState(false)
  const [about, setAbout] = useState(false)

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
    <Stack sx={{ height: '100vh', bgcolor: md.surface, color: md.onSurface }}>
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
      {customize && <CustomizeHomeDialog onClose={() => setCustomize(false)} />}
      {about && <AboutDialog onClose={() => setAbout(false)} />}
    </Stack>
  )
}
