/** Startseite mit Karten (Reihenfolge und Auswahl kann die Anlage vorgeben) */

import { ScrollView, StyleSheet, View } from 'react-native'
import { Button, Card, IconButton, List, Text, useTheme } from 'react-native-paper'
import { groupByDay, timeLabel } from '../dates'
import { findName } from '../numbers'
import { phone } from '../phone'
import type { AppHomeCard, AppPage } from '../provisioning'
import { useStore } from '../state'
import { toNamed } from '../contacts'
import { useEvents } from '../useEvents'
import { HistoryRow } from './HistoryScreen'
import { registrationLabel } from './common'
import { CALL_GREEN, CALL_RED } from './theme'

const DEFAULT_CARDS: AppHomeCard[] = ['status', 'today', 'favorites', 'recent', 'events']

function StatusCard() {
  const { phone: state, profile } = useStore()
  const theme = useTheme()
  const label = registrationLabel(state.registration)
  const color = state.registration === 'registered' ? CALL_GREEN : state.registration === 'failed' ? CALL_RED : theme.colors.onSurfaceVariant
  const ready = state.registration === 'registered' && !state.call
  return (
    <Card mode="contained" style={styles.card}>
      <Card.Title
        title={label.text}
        subtitle={state.error || `Nebenstelle ${profile?.extension ?? ''}`}
        left={(p) => <List.Icon {...p} icon={label.icon} color={color} />}
      />
      <Card.Actions>
        <Button icon="minus-circle-outline" disabled={!ready} onPress={() => phone.dial(profile?.features.dnd || '*76')}>
          Nicht stören
        </Button>
        <Button icon="voicemail" disabled={!ready} onPress={() => phone.dial(profile?.features.voicemail || '*97')}>
          Voicemail
        </Button>
      </Card.Actions>
    </Card>
  )
}

function TodayCard({ count }: { count: number }) {
  const now = new Date()
  return (
    <Card mode="contained" style={styles.card}>
      <Card.Content>
        <Text variant="headlineSmall">{now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
        <Text variant="bodyMedium">{count ? `${count} ${count === 1 ? 'Termin' : 'Termine'} heute` : 'Heute keine Termine'}</Text>
      </Card.Content>
    </Card>
  )
}

function FavoritesCard({ go }: { go: (p: AppPage) => void }) {
  const { settings, people, phone: state } = useStore()
  const named = toNamed(people)
  const theme = useTheme()
  return (
    <Card mode="contained" style={styles.card}>
      <Card.Title title="Favoriten" />
      {settings.favorites.length ? (
        <View style={styles.favs}>
          {settings.favorites.map((n) => (
            <Button
              key={n}
              mode="contained-tonal"
              icon="phone"
              disabled={state.registration !== 'registered' || Boolean(state.call)}
              onPress={() => phone.dial(n)}
              style={styles.fav}
            >
              {findName(n, named) || n}
            </Button>
          ))}
        </View>
      ) : (
        <Card.Content>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>Unter Kontakte eine Nummer mit dem Stern markieren.</Text>
        </Card.Content>
      )}
      <Card.Actions>
        <Button onPress={() => go('contacts')}>Kontakte</Button>
      </Card.Actions>
    </Card>
  )
}

function RecentCard({ go }: { go: (p: AppPage) => void }) {
  const { history } = useStore()
  return (
    <Card mode="contained" style={styles.card}>
      <Card.Title title="Letzte Anrufe" />
      {history.slice(0, 3).map((h) => (
        <HistoryRow key={h.id} entry={h} />
      ))}
      {!history.length && (
        <Card.Content>
          <Text>Noch keine Anrufe.</Text>
        </Card.Content>
      )}
      <Card.Actions>
        <Button onPress={() => go('history')}>Verlauf</Button>
      </Card.Actions>
    </Card>
  )
}

function EventsCard({ go, groups }: { go: (p: AppPage) => void; groups: ReturnType<typeof groupByDay> }) {
  const { profile } = useStore()
  const theme = useTheme()
  const colors = new Map((profile?.calendars ?? []).map((c) => [c.id, c.color]))
  const next = groups.flatMap((g) => g.events.map((e) => ({ ...e, day: g.label }))).slice(0, 4)
  return (
    <Card mode="contained" style={styles.card}>
      <Card.Title title="Nächste Termine" />
      {next.map((e) => (
        <List.Item
          key={`${e.calendar}/${e.uid}/${e.day}`}
          title={e.summary}
          description={`${e.day.replace(/,.*$/, '')} · ${timeLabel(e)}`}
          left={() => <View style={[styles.dot, { backgroundColor: colors.get(e.calendar) ?? theme.colors.primary }]} />}
        />
      ))}
      {!next.length && (
        <Card.Content>
          <Text>Keine Termine in den nächsten zwei Wochen.</Text>
        </Card.Content>
      )}
      <Card.Actions>
        <Button onPress={() => go('calendar')}>Kalender</Button>
      </Card.Actions>
    </Card>
  )
}

export function HomeScreen({ go }: { go: (p: AppPage) => void }) {
  const { profile } = useStore()
  const { events } = useEvents(14)
  const groups = groupByDay(events, new Date(), 14)
  const today = groups[0]?.label.startsWith('Heute') ? groups[0].events.length : 0
  const hasCalendars = Boolean(profile?.calendars.length)
  const cards = (profile?.app?.home_cards.length ? profile.app.home_cards : DEFAULT_CARDS).filter(
    (c) => hasCalendars || (c !== 'events' && c !== 'today'),
  )
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {cards.map((c) => {
        switch (c) {
          case 'status':
            return <StatusCard key={c} />
          case 'today':
            return <TodayCard key={c} count={today} />
          case 'favorites':
            return <FavoritesCard key={c} go={go} />
          case 'recent':
            return <RecentCard key={c} go={go} />
          case 'events':
            return <EventsCard key={c} go={go} groups={groups} />
        }
      })}
      <IconButton icon="dialpad" mode="contained" size={32} style={styles.dial} onPress={() => go('dial')} accessibilityLabel="Wählen" />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 12, paddingBottom: 32 },
  card: { marginBottom: 12 },
  favs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  fav: { marginBottom: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, marginLeft: 16, marginTop: 6 },
  dial: { alignSelf: 'center' },
})
