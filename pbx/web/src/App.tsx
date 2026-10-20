import AccountTreeIcon from '@mui/icons-material/AccountTree'
import CallIcon from '@mui/icons-material/Call'
import ContactsIcon from '@mui/icons-material/Contacts'
import DashboardIcon from '@mui/icons-material/Dashboard'
import GroupsIcon from '@mui/icons-material/Groups'
import HistoryIcon from '@mui/icons-material/History'
import LogoutIcon from '@mui/icons-material/Logout'
import MenuIcon from '@mui/icons-material/Menu'
import PersonIcon from '@mui/icons-material/Person'
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver'
import SettingsIcon from '@mui/icons-material/Settings'
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
  Stack,
  TextField,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { type ReactNode, useEffect, useState } from 'react'
import { api } from './api'
import Calls from './pages/Calls'
import Conferences from './pages/Conferences'
import Dashboard from './pages/Dashboard'
import Extensions from './pages/Extensions'
import Flows from './pages/Flows'
import Groups from './pages/Groups'
import Phonebook from './pages/Phonebook'
import System from './pages/System'
import Trunks from './pages/Trunks'
import { PbxProvider } from './state'

const NAV: [string, string, ReactNode][] = [
  ['dashboard', 'Übersicht', <DashboardIcon />],
  ['extensions', 'Nebenstellen', <PersonIcon />],
  ['groups', 'Gruppen', <GroupsIcon />],
  ['flows', 'Anrufabläufe', <AccountTreeIcon />],
  ['trunks', 'SIP-Konten', <CallIcon />],
  ['conferences', 'Konferenzen', <RecordVoiceOverIcon />],
  ['phonebook', 'Telefonbuch', <ContactsIcon />],
  ['calls', 'Anrufliste', <HistoryIcon />],
  ['system', 'System', <SettingsIcon />],
]

const DRAWER = 260

function usePage(): [string, (p: string) => void] {
  const read = (): string => {
    const p = location.hash.replace(/^#\/?/, '')
    return NAV.some(([k]) => k === p) ? p : 'dashboard'
  }
  const [page, setPage] = useState(read)
  useEffect(() => {
    const on = (): void => setPage(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return [page, (p) => (location.hash = `/${p}`)]
}

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
  const [page, go] = usePage()
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))
  const [open, setOpen] = useState(false)
  const nav = (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, px: 1.5, py: 1.5, mb: 1 }}>
        <Box component="img" src="/icon.svg" alt="" sx={{ width: 32, height: 32 }} />
        <Typography variant="h6">Phone4all</Typography>
      </Stack>
      <List disablePadding sx={{ flex: 1 }}>
        {NAV.map(([key, label, icon]) => (
          <ListItemButton
            key={key}
            selected={page === key}
            onClick={() => {
              go(key)
              setOpen(false)
            }}
            sx={{
              mb: 0.5,
              '&.Mui-selected': { bgcolor: theme.m3.secondaryContainer, color: theme.m3.onSecondaryContainer },
              '&.Mui-selected:hover': { bgcolor: theme.m3.secondaryContainer },
            }}
          >
            <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>{icon}</ListItemIcon>
            <ListItemText primary={label} slotProps={{ primary: { sx: { fontWeight: page === key ? 600 : 500, fontSize: 14 } } }} />
          </ListItemButton>
        ))}
      </List>
      <ListItemButton
        onClick={() => {
          void api.post('/api/logout').then(onLogout)
        }}
      >
        <ListItemIcon sx={{ minWidth: 40 }}>
          <LogoutIcon />
        </ListItemIcon>
        <ListItemText primary="Abmelden" slotProps={{ primary: { sx: { fontSize: 14 } } }} />
      </ListItemButton>
    </Box>
  )
  const pages: Record<string, ReactNode> = {
    dashboard: <Dashboard go={go} />,
    extensions: <Extensions />,
    groups: <Groups />,
    flows: <Flows />,
    trunks: <Trunks />,
    conferences: <Conferences />,
    phonebook: <Phonebook />,
    calls: <Calls />,
    system: <System />,
  }
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {wide ? (
        <Box component="nav" sx={{ width: DRAWER, flexShrink: 0, position: 'sticky', top: 0, height: '100vh', bgcolor: theme.m3.surfaceContainer }}>
          {nav}
        </Box>
      ) : (
        <Drawer open={open} onClose={() => setOpen(false)} slotProps={{ paper: { sx: { width: DRAWER, bgcolor: theme.m3.surfaceContainer, borderRadius: '0 16px 16px 0' } } }}>
          {nav}
        </Drawer>
      )}
      <Box component="main" sx={{ flex: 1, minWidth: 0 }}>
        {!wide && (
          <Toolbar sx={{ gap: 1 }}>
            <IconButton aria-label="Menü" edge="start" onClick={() => setOpen(true)}>
              <MenuIcon />
            </IconButton>
            <Typography variant="h6">{NAV.find(([k]) => k === page)?.[1]}</Typography>
          </Toolbar>
        )}
        <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1280, mx: 'auto', pb: 12 }}>{pages[page]}</Box>
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
