import AccountTreeIcon from '@mui/icons-material/AccountTree'
import BlockIcon from '@mui/icons-material/Block'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import CallIcon from '@mui/icons-material/Call'
import CampaignIcon from '@mui/icons-material/Campaign'
import ChatIcon from '@mui/icons-material/Chat'
import ContactsIcon from '@mui/icons-material/Contacts'
import FaxIcon from '@mui/icons-material/Fax'
import DeskphoneIcon from '@mui/icons-material/LocalPhone'
import DashboardIcon from '@mui/icons-material/Dashboard'
import DialpadIcon from '@mui/icons-material/Dialpad'
import GroupsIcon from '@mui/icons-material/Groups'
import HistoryIcon from '@mui/icons-material/History'
import InsightsIcon from '@mui/icons-material/Insights'
import LogoutIcon from '@mui/icons-material/Logout'
import MenuIcon from '@mui/icons-material/Menu'
import PersonIcon from '@mui/icons-material/Person'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver'
import RouteIcon from '@mui/icons-material/Route'
import ScheduleIcon from '@mui/icons-material/Schedule'
import SettingsIcon from '@mui/icons-material/Settings'
import SettingsPhoneIcon from '@mui/icons-material/SettingsPhone'
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt'
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Stack,
  TextField,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { type ReactNode, useEffect, useState } from 'react'
import { type UpdateInfo, api } from './api'
import Announcements from './pages/Announcements'
import AppProfiles from './pages/AppProfiles'
import Blocking from './pages/Blocking'
import Calendars from './pages/Calendars'
import Calls from './pages/Calls'
import Conferences from './pages/Conferences'
import Dashboard from './pages/Dashboard'
import Dect from './pages/Dect'
import DeskPhones from './pages/DeskPhones'
import Faxes from './pages/Faxes'
import Extensions from './pages/Extensions'
import Flows from './pages/Flows'
import Groups from './pages/Groups'
import Ivrs from './pages/Ivrs'
import Messenger from './pages/Messenger'
import Outbound from './pages/Outbound'
import Phonebook from './pages/Phonebook'
import Stats from './pages/Stats'
import System from './pages/System'
import TimeConditions from './pages/TimeConditions'
import Trunks from './pages/Trunks'
import { go, useRoute } from './router'
import { PbxProvider } from './state'

interface NavItem {
  key: string
  label: string
  icon: ReactNode
  page: ReactNode
}

/** Navigation in der Reihenfolge, in der man eine Anlage einrichtet und benutzt */
const NAV: [string, NavItem[]][] = [
  ['', [{ key: 'dashboard', label: 'Übersicht', icon: <DashboardIcon />, page: <Dashboard /> }]],
  [
    'Personen',
    [
      { key: 'extensions', label: 'Nebenstellen', icon: <PersonIcon />, page: <Extensions /> },
      { key: 'groups', label: 'Gruppen', icon: <GroupsIcon />, page: <Groups /> },
      { key: 'deskphones', label: 'Tischtelefone', icon: <DeskphoneIcon />, page: <DeskPhones /> },
      { key: 'dect', label: 'DECT-Telefone', icon: <SettingsPhoneIcon />, page: <Dect /> },
    ],
  ],
  [
    'Eingehende Anrufe',
    [
      { key: 'flows', label: 'Rufabfolgen', icon: <AccountTreeIcon />, page: <Flows /> },
      { key: 'timeconditions', label: 'Zeitsteuerung', icon: <ScheduleIcon />, page: <TimeConditions /> },
      { key: 'ivrs', label: 'Sprachmenüs', icon: <DialpadIcon />, page: <Ivrs /> },
      { key: 'announcements', label: 'Ansagen und Musik', icon: <CampaignIcon />, page: <Announcements /> },
      { key: 'blocklist', label: 'Anrufsperren', icon: <BlockIcon />, page: <Blocking /> },
    ],
  ],
  [
    'Nach außen',
    [
      { key: 'trunks', label: 'SIP-Konten', icon: <CallIcon />, page: <Trunks /> },
      { key: 'outbound', label: 'Wahlregeln', icon: <RouteIcon />, page: <Outbound /> },
    ],
  ],
  [
    'Zusammenarbeit',
    [
      { key: 'phonebook', label: 'Kontakte', icon: <ContactsIcon />, page: <Phonebook /> },
      { key: 'calendars', label: 'Kalender', icon: <CalendarMonthIcon />, page: <Calendars /> },
      { key: 'appprofiles', label: 'App-Profile', icon: <PhoneAndroidIcon />, page: <AppProfiles /> },
      { key: 'conferences', label: 'Konferenzräume', icon: <RecordVoiceOverIcon />, page: <Conferences /> },
      { key: 'faxes', label: 'Fax', icon: <FaxIcon />, page: <Faxes /> },
      { key: 'messenger', label: 'Messenger', icon: <ChatIcon />, page: <Messenger /> },
    ],
  ],
  [
    'Auswertung und System',
    [
      { key: 'calls', label: 'Anrufliste', icon: <HistoryIcon />, page: <Calls /> },
      { key: 'stats', label: 'Auswertungen', icon: <InsightsIcon />, page: <Stats /> },
      { key: 'system', label: 'System', icon: <SettingsIcon />, page: <System /> },
    ],
  ],
]

const ITEMS = NAV.flatMap(([, items]) => items)
const DRAWER = 264

function Login({ name, onLogin }: { name: string; onLogin: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    try {
      await api.post('/api/login', { password })
      onLogin()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: 4 }}>
          <Stack sx={{ alignItems: 'center', mb: 3 }}>
            <Box component="img" src="/icon.svg" alt="" sx={{ width: 64, height: 64, mb: 2 }} />
            <Typography variant="h5">{name}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Telefonanlage
            </Typography>
          </Stack>
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <TextField
              type="password"
              label="Passwort"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={Boolean(error)}
              helperText={error || 'Beim ersten Start steht das Passwort im Protokoll des Containers (docker compose logs).'}
              sx={{ mb: 2 }}
            />
            <Button type="submit" variant="contained" fullWidth>
              Anmelden
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const route = useRoute()
  const current = ITEMS.find((x) => x.key === route.page) ?? ITEMS[0]
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))
  const [open, setOpen] = useState(false)
  // Neue Version im Menü anzeigen; die Anlage prüft selbst stündlich bei GitHub
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  useEffect(() => {
    const load = (): void => void api.get<UpdateInfo>('/api/updates').then(setUpdate).catch(() => undefined)
    load()
    const t = setInterval(load, 600000)
    return () => clearInterval(t)
  }, [])
  const nav = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, px: 2.5, py: 1.5 }}>
        <Box component="img" src="/icon.svg" alt="" sx={{ width: 32, height: 32 }} />
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 17, lineHeight: 1.2 }}>Phone4all</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Telefonanlage
          </Typography>
        </Box>
      </Stack>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, pb: 1 }}>
        {NAV.map(([group, items]) => (
          <List
            key={group}
            dense
            disablePadding
            subheader={
              group ? (
                <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '28px', mt: 0.5, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary' }}>
                  {group}
                </ListSubheader>
              ) : undefined
            }
          >
            {items.map(({ key, label, icon }) => (
              <ListItemButton
                key={key}
                selected={current.key === key}
                onClick={() => {
                  go(key)
                  setOpen(false)
                }}
                sx={{
                  mb: 0.25,
                  py: 0.5,
                  borderRadius: 2,
                  '&.Mui-selected': { bgcolor: theme.m3.primaryContainer, color: theme.m3.onPrimaryContainer },
                  '&.Mui-selected:hover': { bgcolor: theme.m3.primaryContainer },
                }}
              >
                <ListItemIcon sx={{ minWidth: 36, color: current.key === key ? 'inherit' : 'text.secondary' }}>{icon}</ListItemIcon>
                <ListItemText primary={label} slotProps={{ primary: { sx: { fontWeight: current.key === key ? 700 : 500, fontSize: 14 } } }} />
              </ListItemButton>
            ))}
          </List>
        ))}
      </Box>
      <Box sx={{ p: 1.5, borderTop: 1, borderColor: theme.m3.outlineVariant }}>
        {update?.available && update.latest && (
          <ListItemButton
            onClick={() => {
              go('system', 'aktualisierung')
              setOpen(false)
            }}
            sx={{ mb: 0.5, borderRadius: 2, bgcolor: theme.m3.primaryContainer, color: theme.m3.onPrimaryContainer, '&:hover': { bgcolor: theme.m3.primaryContainer, filter: 'brightness(0.96)' } }}
          >
            <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}>
              <SystemUpdateAltIcon />
            </ListItemIcon>
            <ListItemText primary={`Update auf ${update.latest.version}`} secondary={`Installiert: ${update.current}`} slotProps={{ primary: { sx: { fontSize: 14, fontWeight: 700 } }, secondary: { sx: { fontSize: 12, color: 'inherit', opacity: 0.8 } } }} />
          </ListItemButton>
        )}
        <ListItemButton
          sx={{ borderRadius: 2 }}
          onClick={() => {
            void api.post('/api/logout').then(onLogout)
          }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}>
            <LogoutIcon />
          </ListItemIcon>
          <ListItemText primary="Abmelden" slotProps={{ primary: { sx: { fontSize: 14 } } }} />
        </ListItemButton>
      </Box>
    </Box>
  )
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {wide ? (
        <Box
          component="nav"
          sx={{ width: DRAWER, flexShrink: 0, position: 'sticky', top: 0, height: '100vh', bgcolor: theme.m3.sidebar, borderRight: 1, borderColor: theme.m3.outlineVariant }}
        >
          {nav}
        </Box>
      ) : (
        <Drawer open={open} onClose={() => setOpen(false)} slotProps={{ paper: { sx: { width: DRAWER, bgcolor: theme.m3.sidebar } } }}>
          {nav}
        </Drawer>
      )}
      <Box component="main" sx={{ flex: 1, minWidth: 0 }}>
        {!wide && (
          <Toolbar sx={{ gap: 1, bgcolor: theme.m3.sidebar, borderBottom: 1, borderColor: theme.m3.outlineVariant, position: 'sticky', top: 0, zIndex: 10 }}>
            <IconButton aria-label="Menü" edge="start" onClick={() => setOpen(true)}>
              <MenuIcon />
            </IconButton>
            <Typography variant="h6">{current.label}</Typography>
          </Toolbar>
        )}
        <Box key={current.key} sx={{ p: { xs: 2, md: 4 }, maxWidth: 1280, mx: 'auto', pb: 12 }}>
          {current.page}
        </Box>
      </Box>
    </Box>
  )
}

export default function App() {
  const [session, setSession] = useState<{ authenticated: boolean; name: string } | null>(null)
  const check = (): void => void api.get<{ authenticated: boolean; name: string }>('/api/session').then(setSession)
  useEffect(() => {
    check()
    const onLogout = (): void => setSession((s) => (s ? { ...s, authenticated: false } : s))
    window.addEventListener('p4a-logout', onLogout)
    return () => window.removeEventListener('p4a-logout', onLogout)
  }, [])
  if (!session)
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 20 }}>
        <CircularProgress />
      </Box>
    )
  if (!session.authenticated) return <Login name={session.name} onLogin={check} />
  return (
    <PbxProvider
      fallback={
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 20 }}>
          <CircularProgress />
        </Box>
      }
    >
      <Shell onLogout={check} />
    </PbxProvider>
  )
}
