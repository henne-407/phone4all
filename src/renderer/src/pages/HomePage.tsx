/**
 * Anpassbare Startseite: Status, Überblick, Favoriten, letzte Anrufe und nächste Termine.
 * In breiten Fenstern stehen die Karten in Spalten nebeneinander und füllen die
 * ganze Höhe; Listen in den Karten scrollen dann intern und zeigen mehr Einträge.
 */

import ArrowDownIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpIcon from '@mui/icons-material/ArrowUpward'
import CallIcon from '@mui/icons-material/Call'
import CalendarIcon from '@mui/icons-material/CalendarMonth'
import EditIcon from '@mui/icons-material/Edit'
import HistoryIcon from '@mui/icons-material/History'
import InsightsIcon from '@mui/icons-material/Insights'
import StarIcon from '@mui/icons-material/Star'
import WifiIcon from '@mui/icons-material/WifiCalling3'
import {
  Box,
  Button,
  ButtonBase,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { type ReactNode, useEffect, useState } from 'react'
import { dayLabel, formatTalk, relativeStart } from '../../../shared/format'
import { contactNumbers, hasDigit } from '../../../shared/numbers'
import { frequent, summary } from '../../../shared/stats'
import type { CalEvent, HomeCard, PageName } from '../../../shared/types'
import { api } from '../api'
import { emit } from '../bus'
import { ContactAvatar, StatusDot } from '../components/common'
import { useApp } from '../state'
import { EventRow } from './CalendarPage'
import { HistoryItem, StatTile } from './HistoryPage'

const CARDS: Record<HomeCard, [string, ReactNode]> = {
  status: ['Status & Schnellwahl', <WifiIcon key="i" />],
  today: ['Heute', <InsightsIcon key="i" />],
  favorites: ['Favoriten', <StarIcon key="i" />],
  recent: ['Letzte Anrufe', <HistoryIcon key="i" />],
  events: ['Nächste Termine', <CalendarIcon key="i" />],
}
// Karten mit Listen dürfen in die Höhe wachsen, die anderen behalten ihre natürliche Größe
const GROWS = new Set<HomeCard>(['recent', 'events'])
// Ungefährer Platzbedarf, um die Karten gleichmäßig auf die Spalten zu verteilen
const WEIGHT: Record<HomeCard, number> = { status: 2, today: 1, favorites: 2, recent: 3, events: 3 }
export const START_TABS: [PageName, string][] = [
  ['home', 'Startseite'],
  ['dial', 'Wählen'],
  ['contacts', 'Kontakte'],
  ['calendar', 'Kalender'],
  ['history', 'Verlauf'],
]

/** Gespeicherte Kartenreihenfolge, ergänzt um neu hinzugekommene Karten. */
export function homeLayout(saved: [HomeCard, boolean][]): [HomeCard, boolean][] {
  const valid = saved.filter(([k]) => k in CARDS)
  const known = new Set(valid.map(([k]) => k))
  return [...valid, ...(Object.keys(CARDS) as HomeCard[]).filter((k) => !known.has(k)).map((k) => [k, true] as [HomeCard, boolean])]
}

function HomeCardBox({
  card,
  action,
  grow,
  children,
}: {
  card: HomeCard
  action?: [string, () => void]
  grow: boolean
  children: ReactNode
}) {
  const [title, icon] = CARDS[card]
  return (
    <Card sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.25, minHeight: 0, flex: grow ? 1 : 'none' }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25 }}>
        <Box sx={{ color: 'primary.main', display: 'flex' }}>{icon}</Box>
        <Typography variant="subtitle1" sx={{ flex: 1 }}>
          {title}
        </Typography>
        {action && (
          <Button size="small" onClick={action[1]}>
            {action[0]}
          </Button>
        )}
      </Stack>
      {children}
    </Card>
  )
}

/** Liste in einer Karte; im Füllmodus scrollt sie innerhalb der Karte. */
function CardList({ fill, children }: { fill: boolean; children: ReactNode }) {
  return (
    <Box sx={{ overflowY: fill ? 'auto' : 'visible', minHeight: fill ? 120 : 0, flex: fill ? 1 : 'none', mx: -1 }}>
      <List disablePadding dense>
        {children}
      </List>
    </Box>
  )
}

function StatusCard({ grow }: { grow: boolean }) {
  const { state, toast } = useApp()
  const [text, setText] = useState('')
  const dial = async (): Promise<void> => {
    let target = text.trim()
    if (!hasDigit(target)) {
      const r = target ? await api.searchContacts(target, 1) : { items: [] }
      const numbers = r.items[0] ? contactNumbers(r.items[0]) : []
      if (!numbers.length) {
        toast('Kein passender Kontakt')
        return
      }
      target = numbers[0]
    }
    if (await api.dial(target)) setText('')
  }
  return (
    <HomeCardBox card="status" grow={grow}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25 }}>
        <StatusDot kind={state.reg.kind} dnd={state.settings.dnd} />
        <Typography noWrap>{state.reg.text}</Typography>
      </Stack>
      <FormControlLabel
        labelPlacement="start"
        sx={{ mx: 0, justifyContent: 'space-between' }}
        control={<Switch checked={state.settings.dnd} onChange={(e) => void api.setDnd(e.target.checked)} />}
        label={
          <Box>
            <Typography>Nicht stören</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Anrufe werden abgewiesen und als verpasst eingetragen
            </Typography>
          </Box>
        }
      />
      <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
        <TextField
          size="small"
          label="Nummer oder Name"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void dial()}
          slotProps={{ htmlInput: { inputMode: 'tel' } }}
        />
        <IconButton aria-label="Anrufen" onClick={() => void dial()} sx={{ bgcolor: 'success.main', color: 'success.contrastText', '&:hover': { bgcolor: 'success.main' } }}>
          <CallIcon />
        </IconButton>
      </Stack>
    </HomeCardBox>
  )
}

function TodayCard({ grow }: { grow: boolean }) {
  const { state, history } = useApp()
  const today = summary(history, 0)
  const now = Date.now()
  const next = state.upcoming.find((e) => !e.allDay && e.start > now)
  return (
    <HomeCardBox card="today" grow={grow}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
        <StatTile value={today.incoming + today.outgoing} caption="Gespräche" />
        <StatTile value={today.missed} caption="Verpasst" alert={today.missed > 0} />
        <StatTile value={formatTalk(today.talk)} caption="Gesprächszeit" />
      </Box>
      {next && (
        <Typography variant="body2">
          Nächster Termin {relativeStart(next.start, now)}: {next.summary}
        </Typography>
      )}
    </HomeCardBox>
  )
}

function Tile({ name, number, size = 56 }: { name: string; number: string; size?: number }) {
  return (
    <ButtonBase
      title={number ? `${name} – ${number} anrufen` : name}
      onClick={() => number && void api.dial(number)}
      sx={{ flexDirection: 'column', gap: 0.75, p: 1, borderRadius: 1, width: '100%', '&:hover': { bgcolor: 'action.hover' } }}
    >
      <ContactAvatar name={name} size={size} />
      <Typography variant="caption" noWrap sx={{ maxWidth: '100%' }}>
        {name.split(' ')[0]}
      </Typography>
    </ButtonBase>
  )
}

function FavoritesCard({ grow, fill }: { grow: boolean; fill: boolean }) {
  const { state, history } = useApp()
  const favorites = state.favorites
  const often = frequent(history, fill ? 12 : 4, 90, new Set(favorites.map((c) => c.id)))
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 0.5 }
  return (
    <HomeCardBox card="favorites" grow={grow} action={['Kontakte', () => emit('navigate', 'contacts')]}>
      {favorites.length ? (
        <Box sx={grid}>
          {favorites.map((c) => (
            <Tile key={c.id} name={c.name} number={contactNumbers(c)[0] ?? ''} />
          ))}
        </Box>
      ) : (
        <Typography sx={{ color: 'text.secondary' }}>
          Öffne einen Kontakt und schalte „Favorit“ ein, um ihn hier anzuheften.
        </Typography>
      )}
      {often.length > 0 && (
        <>
          <Typography variant="body2" sx={{ fontWeight: 500, mt: 1 }}>
            Häufig angerufen
          </Typography>
          <Box sx={grid}>
            {often.map((f) => (
              <Tile key={f.number} name={f.name} number={f.number} size={44} />
            ))}
          </Box>
        </>
      )}
    </HomeCardBox>
  )
}

function RecentCard({ grow, fill }: { grow: boolean; fill: boolean }) {
  const { history } = useApp()
  const entries = history.slice(0, fill ? 40 : 5)
  return (
    <HomeCardBox card="recent" grow={grow} action={['Alle', () => emit('navigate', 'history')]}>
      {entries.length ? (
        <CardList fill={fill}>
          {entries.map((e) => (
            <HistoryItem key={`${e.time}-${e.number}`} entry={e} />
          ))}
        </CardList>
      ) : (
        <Typography sx={{ color: 'text.secondary' }}>Noch keine Anrufe.</Typography>
      )}
    </HomeCardBox>
  )
}

function EventsCard({ grow, fill }: { grow: boolean; fill: boolean }) {
  const { state } = useApp()
  const now = Date.now()
  const events = state.upcoming.filter((e) => e.end > now).slice(0, fill ? 40 : 5)
  const subtitlePrefix = (ev: CalEvent): string => {
    if (ev.start > now && ev.start - now < 3600000) return `In ${Math.max(1, Math.floor((ev.start - now) / 60000))} Min. · `
    return ev.start > now ? `${dayLabel(new Date(ev.start))} · ` : 'Jetzt · '
  }
  let body: ReactNode
  if (!state.calendars.some((c) => c.enabled)) {
    body = (
      <Typography sx={{ color: 'text.secondary' }}>Kein Kalender verbunden – unter Einstellungen → Kalender einrichten.</Typography>
    )
  } else if (!events.length) {
    body = <Typography sx={{ color: 'text.secondary' }}>Keine Termine in den nächsten 7 Tagen.</Typography>
  } else {
    body = (
      <CardList fill={fill}>
        {events.map((ev) => (
          <EventRow key={ev.uid + ev.start} ev={ev} day={new Date(ev.start)} subtitlePrefix={subtitlePrefix(ev)} />
        ))}
      </CardList>
    )
  }
  return (
    <HomeCardBox card="events" grow={grow} action={['Kalender', () => emit('navigate', 'calendar')]}>
      {body}
    </HomeCardBox>
  )
}

export function HomePage({ columns }: { columns: number }) {
  const { state } = useApp()
  const [, setMinute] = useState(0)
  // Zeitangaben („in 5 Min.“) aktuell halten
  useEffect(() => {
    const id = setInterval(() => setMinute((m) => m + 1), 60000)
    return () => clearInterval(id)
  }, [])

  const fill = columns > 1
  const cards = homeLayout(state.settings.home.cards)
    .filter(([, v]) => v)
    .map(([k]) => k)
  const n = Math.max(1, Math.min(columns, cards.length))
  const placed: HomeCard[][] = Array.from({ length: n }, () => [])
  const load = new Array(n).fill(0)
  // Reihenfolge beibehalten, aber jede Karte in die am wenigsten gefüllte Spalte setzen
  for (const key of cards) {
    const target = load.indexOf(Math.min(...load))
    placed[target].push(key)
    load[target] += WEIGHT[key]
  }
  const render = (key: HomeCard, column: HomeCard[]): ReactNode => {
    const growing = column.filter((k) => GROWS.has(k))
    // Ohne wachsende Karte füllt die letzte Karte der Spalte den Rest
    const grow = fill && (growing.length ? GROWS.has(key) : key === column[column.length - 1])
    switch (key) {
      case 'status':
        return <StatusCard key={key} grow={grow} />
      case 'today':
        return <TodayCard key={key} grow={grow} />
      case 'favorites':
        return <FavoritesCard key={key} grow={grow} fill={fill} />
      case 'recent':
        return <RecentCard key={key} grow={grow} fill={fill} />
      case 'events':
        return <EventsCard key={key} grow={grow} fill={fill} />
    }
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: fill ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 2, px: 2, pt: 0.75, flex: fill ? 1 : 'none', minHeight: 0, maxWidth: 1800, width: '100%', mx: 'auto', boxSizing: 'border-box' }}>
        {placed.map((column, i) => (
          <Stack key={i} sx={{ gap: 2, minHeight: 0 }}>
            {column.map((key) => render(key, column))}
          </Stack>
        ))}
      </Box>
      <Stack sx={{ alignItems: 'center', py: 1.5 }}>
        <Button size="small" startIcon={<EditIcon />} onClick={() => emit('customize-home')}>
          Startseite anpassen
        </Button>
      </Stack>
    </Box>
  )
}

/** Karten ein-/ausblenden, umsortieren und Startansicht wählen. */
export function CustomizeHomeDialog({ onClose }: { onClose: () => void }) {
  const { state } = useApp()
  const layout = homeLayout(state.settings.home.cards)
  const save = (cards: [HomeCard, boolean][]): void => void api.setHome({ cards })
  const move = (i: number, d: number): void => {
    const next = [...layout]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    save(next)
  }
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Startseite anpassen</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          Karten ein- und ausblenden, mit den Pfeilen sortieren.
        </Typography>
        <List disablePadding>
          {layout.map(([key, visible], i) => (
            <ListItem key={key} disablePadding sx={{ gap: 0.5 }}>
              <ListItemIcon sx={{ minWidth: 40 }}>{CARDS[key][1]}</ListItemIcon>
              <ListItemText primary={CARDS[key][0]} />
              <IconButton size="small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Nach oben">
                <ArrowUpIcon />
              </IconButton>
              <IconButton size="small" disabled={i === layout.length - 1} onClick={() => move(i, 1)} aria-label="Nach unten">
                <ArrowDownIcon />
              </IconButton>
              <Switch
                checked={visible}
                onChange={(e) => save(layout.map(([k, v], j) => [k, j === i ? e.target.checked : v]))}
              />
            </ListItem>
          ))}
        </List>
        <TextField
          select
          label="Beim Öffnen zuerst anzeigen"
          value={state.settings.home.start_tab}
          onChange={(e) => void api.setHome({ start_tab: e.target.value as PageName })}
          sx={{ mt: 2 }}
        >
          {START_TABS.map(([k, label]) => (
            <MenuItem key={k} value={k}>
              {label}
            </MenuItem>
          ))}
        </TextField>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button variant="contained" onClick={onClose}>
          Fertig
        </Button>
      </DialogActions>
    </Dialog>
  )
}
