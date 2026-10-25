/** App-Profile: welche Ansichten die Phone4All-App einer Nebenstelle zeigt. */

import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import ContactsIcon from '@mui/icons-material/Contacts'
import DialpadIcon from '@mui/icons-material/Dialpad'
import DoNotDisturbOnIcon from '@mui/icons-material/DoNotDisturbOn'
import ChatIcon from '@mui/icons-material/Chat'
import EventIcon from '@mui/icons-material/Event'
import HistoryIcon from '@mui/icons-material/History'
import HomeIcon from '@mui/icons-material/Home'
import LockIcon from '@mui/icons-material/Lock'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import StarIcon from '@mui/icons-material/Star'
import TodayIcon from '@mui/icons-material/Today'
import { Box, Checkbox, Chip, FormControlLabel, FormGroup, Stack, Switch, TextField, Typography, useTheme } from '@mui/material'
import type { ReactNode } from 'react'
import { APP_HOME_CARDS, APP_PAGES, type AppHomeCard, type AppPage, type AppProfile } from '../../../server/model'
import { CollectionPage, FormGrid, FormHeading, Full, Select } from '../components/common'
import { DragColumns } from '../components/DragColumns'
import { usePbx } from '../state'

const PAGE_ICONS: Record<AppPage, ReactNode> = {
  home: <HomeIcon fontSize="small" />,
  dial: <DialpadIcon fontSize="small" />,
  contacts: <ContactsIcon fontSize="small" />,
  calendar: <CalendarMonthIcon fontSize="small" />,
  history: <HistoryIcon fontSize="small" />,
  messenger: <ChatIcon fontSize="small" />,
}

const CARD_ICONS: Record<AppHomeCard, ReactNode> = {
  status: <DoNotDisturbOnIcon fontSize="small" />,
  today: <TodayIcon fontSize="small" />,
  favorites: <StarIcon fontSize="small" />,
  recent: <HistoryIcon fontSize="small" />,
  events: <EventIcon fontSize="small" />,
}

const label = (list: [string, string][], key: string): string => list.find(([k]) => k === key)?.[1] ?? key

/** Vorschau: so sieht die App mit diesem Profil aus (Navigation links, Startseite rechts). */
export function PhonePreview({ profile }: { profile: AppProfile }) {
  const theme = useTheme()
  const pages = profile.pages.map((p): [AppPage, string] => [p, label(APP_PAGES, p)])
  return (
    <Box sx={{ display: 'flex', border: 2, borderColor: theme.m3.outline, borderRadius: 3, overflow: 'hidden', height: 216, bgcolor: 'background.default' }}>
      <Stack sx={{ width: 56, py: 1, gap: 0.25, alignItems: 'center', bgcolor: theme.m3.sidebar, borderRight: 1, borderColor: theme.m3.outlineVariant }}>
        {pages.map(([p, l]) => (
          <Stack key={p} sx={{ alignItems: 'center' }}>
            <Box
              sx={{
                px: 1.25,
                py: 0.25,
                borderRadius: 3,
                display: 'flex',
                bgcolor: p === profile.start_tab ? theme.m3.secondaryContainer : 'transparent',
                color: p === profile.start_tab ? theme.m3.onSecondaryContainer : 'text.secondary',
              }}
            >
              {PAGE_ICONS[p]}
            </Box>
            <Typography sx={{ fontSize: 9, color: 'text.secondary' }}>{l}</Typography>
          </Stack>
        ))}
      </Stack>
      <Box sx={{ flex: 1, p: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 600, mb: 0.75 }}>{label(APP_PAGES, profile.start_tab)}</Typography>
        {profile.start_tab === 'home' && profile.home_cards.length ? (
          profile.home_cards.slice(0, 4).map((c) => (
            <Box key={c} sx={{ border: 1, borderColor: theme.m3.outlineVariant, bgcolor: 'background.paper', borderRadius: 1.5, px: 1, py: 0.5, mb: 0.5 }}>
              <Typography noWrap sx={{ fontSize: 10 }}>
                {label(APP_HOME_CARDS, c)}
              </Typography>
            </Box>
          ))
        ) : (
          <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>
            {profile.start_tab === 'home' ? 'Startseite wie in der App eingestellt' : 'Öffnet direkt diese Ansicht'}
          </Typography>
        )}
      </Box>
    </Box>
  )
}

function ProfileForm({ value, onChange }: { value: AppProfile; onChange: (v: AppProfile) => void }) {
  const { config } = usePbx()
  const set = <K extends keyof AppProfile>(k: K, v: AppProfile[K]): void => onChange({ ...value, [k]: v })
  const setPages = (pages: AppPage[]): void =>
    onChange({ ...value, pages, start_tab: pages.includes(value.start_tab) ? value.start_tab : (pages[0] ?? 'home') })
  return (
    <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 240px' } }}>
      <FormGrid>
        <Full>
          <TextField label="Name" value={value.name} onChange={(e) => set('name', e.target.value)} required autoFocus helperText="z. B. „Empfang“, „Außendienst“, „Nur telefonieren“" />
        </Full>
        <Full>
          <FormHeading hint="Ziehen zum Ordnen, Ein- und Ausblenden – so erscheint die Navigation in der App">Bereiche der App</FormHeading>
          <DragColumns options={APP_PAGES} value={value.pages} onChange={setPages} icons={PAGE_ICONS} chosenTitle="In der App" restTitle="Ausgeblendet" emptyText="Mindestens einen Bereich hierher ziehen" />
        </Full>
        <Select label="Öffnet mit" value={value.start_tab} onChange={(v) => set('start_tab', v)} options={APP_PAGES.filter(([p]) => value.pages.includes(p))} />
        <Box />
        {value.pages.includes('home') && (
          <Full>
            <FormHeading hint="In dieser Reihenfolge von oben nach unten. Leer = jede Person stellt selbst ein">Karten auf der Startseite</FormHeading>
            <DragColumns
              options={APP_HOME_CARDS}
              value={value.home_cards}
              onChange={(v) => set('home_cards', v)}
              icons={CARD_ICONS}
              chosenTitle="Auf der Startseite"
              restTitle="Weitere Karten"
              emptyText="Keine Vorgabe – Karten hierher ziehen"
            />
          </Full>
        )}
        <Full>
          <FormHeading>Sperren</FormHeading>
          <FormControlLabel control={<Switch checked={value.lock_layout} onChange={(e) => set('lock_layout', e.target.checked)} />} label="Startseite in der App nicht anpassbar" />
          <br />
          <FormControlLabel control={<Switch checked={value.lock_account} onChange={(e) => set('lock_account', e.target.checked)} />} label="Kontodaten (Server, Nebenstelle, Passwort) nicht änderbar" />
        </Full>
        <Full>
          <FormHeading hint="Nichts ausgewählt = alle zentralen Kalender">Zentrale Kalender</FormHeading>
          {config.calendars.length ? (
            <FormGroup row>
              {config.calendars.map((c) => (
                <FormControlLabel
                  key={c.id}
                  control={
                    <Checkbox
                      checked={value.calendars.includes(c.id)}
                      onChange={(e) => set('calendars', e.target.checked ? [...value.calendars, c.id] : value.calendars.filter((x) => x !== c.id))}
                    />
                  }
                  label={c.name}
                />
              ))}
            </FormGroup>
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Noch keine zentralen Kalender angelegt.
            </Typography>
          )}
        </Full>
      </FormGrid>
      <Box>
        <FormHeading>Vorschau</FormHeading>
        <PhonePreview profile={value} />
      </Box>
    </Box>
  )
}

export default function AppProfiles() {
  const { config } = usePbx()
  return (
    <CollectionPage<AppProfile>
      kind="appprofiles"
      overline="Zusammenarbeit"
      title="App-Profile"
      singular="App-Profil"
      description="Legt fest, was die Phone4All-App zeigt: Bereiche, Startansicht, Karten der Startseite und zentrale Kalender. Ein Profil wird der Nebenstelle zugewiesen; die App übernimmt Änderungen innerhalb von zwei Minuten."
      emptyText="Ohne Profil zeigt die App alles und jede Person richtet sie selbst ein."
      emptyIcon={<PhoneAndroidIcon />}
      columns={[
        { label: 'Name', render: (p) => <b>{p.name}</b> },
        {
          label: 'Nebenstellen',
          render: (p) =>
            config.extensions
              .filter((e) => e.app_profile === p.id)
              .map((e) => e.number)
              .join(', ') || '–',
        },
        {
          label: 'Gesperrt',
          render: (p) => (
            <Stack direction="row" sx={{ gap: 0.75 }}>
              {p.lock_layout && <Chip size="small" icon={<LockIcon />} label="Startseite" />}
              {p.lock_account && <Chip size="small" icon={<LockIcon />} label="Konto" />}
              {!p.lock_layout && !p.lock_account && '–'}
            </Stack>
          ),
          hideOnMobile: true,
        },
      ]}
      card={(p) => {
        const users = config.extensions.filter((e) => e.app_profile === p.id)
        return (
          <Box>
            <Typography variant="h6" sx={{ mb: 0.5 }}>
              {p.name}
            </Typography>
            <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap', mb: 1.5, alignItems: 'center' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {users.length ? users.map((e) => e.number).join(', ') : 'Keiner Nebenstelle zugewiesen'}
              </Typography>
              {p.lock_layout && <Chip size="small" icon={<LockIcon />} label="Startseite" />}
              {p.lock_account && <Chip size="small" icon={<LockIcon />} label="Konto" />}
            </Stack>
            <PhonePreview profile={p} />
          </Box>
        )
      }}
      Form={ProfileForm}
    />
  )
}
