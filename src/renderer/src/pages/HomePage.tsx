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
import GroupsIcon from '@mui/icons-material/Groups'
import LocalParkingIcon from '@mui/icons-material/LocalParking'
import HistoryIcon from '@mui/icons-material/History'
import PhoneMissedIcon from '@mui/icons-material/PhoneMissed'
import InsightsIcon from '@mui/icons-material/Insights'
import StarIcon from '@mui/icons-material/Star'
import WifiIcon from '@mui/icons-material/WifiCalling3'
import {
  Box,
  Button,
  Fab,
  Card,
  CardActionArea,
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
import type { CalEvent, HomeCard, PageName, TeamMember } from '../../../shared/types'
import { api } from '../api'
import { emit } from '../bus'
import { ContactAvatar, StatusDot } from '../components/common'
import { GroupMissedDialog } from '../components/GroupMissed'
import { useApp } from '../state'
import { EventRow } from './CalendarPage'
import { HistoryItem, StatTile } from './HistoryPage'

const CARDS: Record<HomeCard, [string, ReactNode]> = {
  status: ['Status & Schnellwahl', <WifiIcon key="i" />],
  today: ['Heute', <InsightsIcon key="i" />],
  favorites: ['Favoriten', <StarIcon key="i" />],
  recent: ['Letzte Anrufe', <HistoryIcon key="i" />],
  events: ['Nächste Termine', <CalendarIcon key="i" />],
  team: ['Kollegen', <GroupsIcon key="i" />],
}
// Karten mit Listen dürfen in die Höhe wachsen, die anderen behalten ihre natürliche Größe
const GROWS = new Set<HomeCard>(['recent', 'events', 'team'])
// Ungefährer Platzbedarf, um die Karten gleichmäßig auf die Spalten zu verteilen
const WEIGHT: Record<HomeCard, number> = { status: 2, today: 1, favorites: 2, recent: 3, events: 3, team: 3 }
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
  const setGroup = (id: string, active: boolean): void =>
    void api.pbxSetGroup(id, active).then((r) => toast(r.ok ? (active ? 'In der Gruppe angemeldet' : 'Aus der Gruppe abgemeldet') : r.error))
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
      {state.settings.registered && (state.watchdog.level === 'warning' || state.watchdog.level === 'error') && (
        <Typography
          variant="caption"
          onClick={() => emit('open-preferences', 'diagnose')}
          sx={{ color: 'text.secondary', cursor: 'pointer', mt: -0.5 }}
        >
          Verbindung wird automatisch wiederhergestellt · Diagnose
        </Typography>
      )}
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
      {state.groups?.map((g) => (
        <FormControlLabel
          key={g.id}
          labelPlacement="start"
          sx={{ mx: 0, justifyContent: 'space-between' }}
          control={<Switch checked={g.active} onChange={(e) => setGroup(g.id, e.target.checked)} />}
          label={
            <Box>
              <Typography>{g.name || g.number}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Gruppe {g.number} · {g.active ? 'klingelt hier mit' : 'abgemeldet'}
              </Typography>
            </Box>
          }
        />
      ))}
      <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
        <TextField
          size="small"
          label="Nummer oder Name"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void dial()}
          slotProps={{ htmlInput: { inputMode: 'tel' } }}
        />
        <Fab size="small" color="success" aria-label="Anrufen" onClick={() => void dial()} sx={{ flexShrink: 0 }}>
          <CallIcon />
        </Fab>
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
    <CardActionArea
      title={number ? `${name} – ${number} anrufen` : name}
      onClick={() => number && void api.dial(number)}
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, p: 1, borderRadius: 1 }}
    >
      <ContactAvatar name={name} size={size} />
      <Typography variant="caption" noWrap sx={{ maxWidth: '100%' }}>
        {name.split(' ')[0]}
      </Typography>
    </CardActionArea>
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
          <Typography variant="subtitle2" sx={{ mt: 1 }}>
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

const LINE: Record<TeamMember['state'], [string, 'success' | 'warning' | 'error' | 'disabled']> = {
  idle: ['Frei', 'success'],
  ringing: ['Klingelt', 'warning'],
  busy: ['Im Gespräch', 'error'],
  offline: ['Nicht erreichbar', 'disabled'],
}

function minutes(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Kollegen mit Besetztanzeige und geparkte Gespräche (Telefonanlage) */
function TeamCard({ grow, fill }: { grow: boolean; fill: boolean }) {
  const { state } = useApp()
  const team = state.team
  const me = state.settings.provisioning.extension
  const [now, setNow] = useState(Date.now())
  const parked = team?.parked ?? []
  useEffect(() => {
    if (!parked.length) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [parked.length])
  const [missedOpen, setMissedOpen] = useState(false)
  const missed = state.groupMissed
  const name = (n: string): string => team?.extensions.find((e) => e.number === n)?.name || n
  const others = (team?.extensions ?? []).filter((e) => e.number !== me)
  return (
    <HomeCardBox card="team" grow={grow}>
      {!team ? (
        <Typography sx={{ color: 'text.secondary' }}>Die Telefonanlage ist gerade nicht erreichbar.</Typography>
      ) : (
        <>
          {missed && (
            <Button
              variant={missed.open ? 'contained' : 'text'}
              color={missed.open ? 'warning' : 'primary'}
              startIcon={<PhoneMissedIcon />}
              onClick={() => setMissedOpen(true)}
              sx={{ alignSelf: 'flex-start' }}
            >
              {missed.open ? `${missed.open} verpasste Gruppenanrufe offen` : 'Verpasste Gruppenanrufe'}
            </Button>
          )}
          <GroupMissedDialog open={missedOpen} onClose={() => setMissedOpen(false)} />
          {parked.length > 0 && (
            <Stack sx={{ gap: 0.5 }}>
              {parked.map((c) => (
                <Stack key={c.slot} direction="row" sx={{ alignItems: 'center', gap: 1.25, p: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <LocalParkingIcon color="primary" />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                      {c.name || c.number || 'Unbekannt'} auf {c.slot}
                    </Typography>
                    <Typography variant="caption" noWrap sx={{ color: 'text.secondary', display: 'block' }}>
                      {[c.name && c.number, c.by && `von ${name(c.by)}`, `seit ${minutes(now - c.since)}`].filter(Boolean).join(' · ')}
                    </Typography>
                  </Box>
                  <Button size="small" variant="contained" startIcon={<CallIcon />} onClick={() => void api.dial(c.slot)}>
                    Übernehmen
                  </Button>
                </Stack>
              ))}
            </Stack>
          )}
          {others.length ? (
            <CardList fill={fill}>
              {others.map((e) => {
                const [label, color] = LINE[e.state]
                let detail = e.dnd ? 'Nicht stören' : e.forward ? `Umgeleitet${e.forward === 'extern' ? '' : ` an ${name(e.forward)}`}` : label
                // Status aus dem Kalender („Urlaub bis Fr“)
                if (e.note) detail += ` · ${e.note}`
                return (
                  <ListItem key={e.number} disablePadding>
                    <CardActionArea sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1, py: 0.75, borderRadius: 2 }} onClick={() => void api.dial(e.number)}>
                      <Box sx={{ position: 'relative', display: 'flex' }}>
                        <ContactAvatar name={e.name || e.number} size={34} />
                        <Box sx={{ position: 'absolute', right: -2, bottom: -2, display: 'flex', bgcolor: 'background.paper', borderRadius: '50%', p: '1px' }}>
                          <TeamDot color={e.dnd ? 'error' : color} ringing={e.state === 'ringing'} />
                        </Box>
                      </Box>
                      <ListItemText primary={e.name || e.number} secondary={`${e.number} · ${detail}`} slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }} />
                    </CardActionArea>
                  </ListItem>
                )
              })}
            </CardList>
          ) : (
            <Typography sx={{ color: 'text.secondary' }}>Keine weiteren Nebenstellen.</Typography>
          )}
        </>
      )}
    </HomeCardBox>
  )
}

function TeamDot({ color, ringing }: { color: 'success' | 'warning' | 'error' | 'disabled'; ringing: boolean }) {
  return (
    <Box
      sx={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        bgcolor: color === 'disabled' ? 'action.disabled' : `${color}.main`,
        ...(ringing && { animation: 'pulse 1.2s ease-in-out infinite', '@keyframes pulse': { '50%': { opacity: 0.3 } } }),
      }}
    />
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
  const policy = state.settings.provisioning.policy
  const cards = (
    policy?.home_cards.length
      ? policy.home_cards
      : homeLayout(state.settings.home.cards)
          .filter(([, v]) => v)
          .map(([k]) => k)
  ).filter((k) => k !== 'team' || state.settings.provisioning.pbx)
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
      case 'team':
        return <TeamCard key={key} grow={grow} fill={fill} />
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
      {!policy?.lock_layout && (
        <Stack sx={{ alignItems: 'center', py: 1.5 }}>
          <Button size="small" startIcon={<EditIcon />} onClick={() => emit('customize-home')}>
            Startseite anpassen
          </Button>
        </Stack>
      )}
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
          {layout.map(([key, visible], i) =>
            key === 'team' && !state.settings.provisioning.pbx ? null : (
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
            ),
          )}
        </List>
        {!state.settings.provisioning.policy && (
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
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button variant="contained" onClick={onClose}>
          Fertig
        </Button>
      </DialogActions>
    </Dialog>
  )
}
