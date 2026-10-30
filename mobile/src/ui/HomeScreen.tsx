/** Startseite mit Karten (Reihenfolge und Auswahl kann die Anlage vorgeben) */

import { useEffect, useState } from 'react'
import { Alert, ScrollView, StyleSheet, View } from 'react-native'
import { Button, Card, Dialog, IconButton, List, Portal, Switch, Text, useTheme } from 'react-native-paper'
import { groupByDay, timeLabel } from '../dates'
import { findName } from '../numbers'
import { phone } from '../phone'
import {
  type AppHomeCard,
  type AppPage,
  type ForwardInfo,
  type GroupMissed,
  actGroupMissed,
  fetchForward,
  fetchGroupMissed,
  setGroup,
  setMobileRing,
} from '../provisioning'
import { whenLabel } from './HistoryScreen'
import { useStore } from '../state'
import { toNamed } from '../contacts'
import { useEvents } from '../useEvents'
import { HistoryRow } from './HistoryScreen'
import { registrationLabel } from './common'
import { CALL_GREEN, CALL_RED } from './theme'

const DEFAULT_CARDS: AppHomeCard[] = ['status', 'today', 'team', 'favorites', 'recent', 'events']

const LINE: Record<string, [string, string]> = {
  idle: ['Frei', CALL_GREEN],
  ringing: ['Klingelt', '#e8a200'],
  busy: ['Im Gespräch', CALL_RED],
  offline: ['Nicht erreichbar', '#9e9e9e'],
}

/** Kollegen mit Besetztanzeige und geparkte Gespräche */
function TeamCard() {
  const { presence, profile, phone: state } = useStore()
  const theme = useTheme()
  if (!presence) return null
  const ready = state.registration === 'registered' && !state.call
  const name = (n: string): string => presence.extensions.find((e) => e.number === n)?.name || n
  const others = presence.extensions.filter((e) => e.number !== profile?.extension)
  return (
    <Card mode="contained" style={styles.card}>
      <Card.Title title="Kollegen" />
      {presence.parked.map((c) => (
        <List.Item
          key={c.slot}
          title={`${c.name || c.number || 'Unbekannt'} auf ${c.slot}`}
          description={[c.name && c.number, c.by && `geparkt von ${name(c.by)}`].filter(Boolean).join(' · ')}
          left={(p) => <List.Icon {...p} icon="parking" color={theme.colors.primary} />}
          right={() => (
            <Button mode="contained-tonal" disabled={!ready} onPress={() => phone.dial(c.slot)}>
              Übernehmen
            </Button>
          )}
        />
      ))}
      {others.map((e) => {
        const [label, color] = LINE[e.state] ?? LINE.offline
        let detail = e.dnd ? 'Nicht stören' : e.forward ? `Umgeleitet${e.forward === 'extern' ? '' : ` an ${name(e.forward)}`}` : label
        // Status aus dem Kalender („Urlaub bis Fr“)
        if (e.note) detail += ` · ${e.note}`
        return (
          <List.Item
            key={e.number}
            title={e.name || e.number}
            description={`${e.number} · ${detail}`}
            left={() => <View style={[styles.dot, { backgroundColor: e.dnd ? CALL_RED : color, marginTop: 16 }]} />}
            onPress={ready ? () => phone.dial(e.number) : undefined}
          />
        )
      })}
      {!others.length && (
        <Card.Content>
          <Text>Keine weiteren Nebenstellen.</Text>
        </Card.Content>
      )}
    </Card>
  )
}

const HOW: Record<GroupMissed['done_how'], string> = { '': '', callback: 'zurückgerufen', answered: 'Anrufer kam durch', manual: 'erledigt' }

/** Verpasste Gruppenanrufe gemeinsam abarbeiten */
function GroupMissedDialog({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const { profile, presence, phone: state } = useStore()
  const [list, setList] = useState<GroupMissed[] | null>(null)
  const me = profile?.extension ?? ''
  const revision = presence?.missed?.revision
  const name = (n: string): string => (n === me ? 'dir' : presence?.extensions.find((e) => e.number === n)?.name || n)
  useEffect(() => {
    if (!visible || !profile) return
    fetchGroupMissed(profile)
      .then(setList)
      .catch((e: Error) => Alert.alert('Verpasste Gruppenanrufe', e.message))
  }, [visible, revision, profile?.url])
  const act = (e: GroupMissed, action: 'claim' | 'release' | 'done' | 'reopen'): void => {
    if (profile) void actGroupMissed(profile, e, action).then(setList).catch((x: Error) => Alert.alert('Verpasste Gruppenanrufe', x.message))
  }
  const ready = state.registration === 'registered' && !state.call
  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={{ maxHeight: '85%' }}>
        <Dialog.Title>Verpasste Gruppenanrufe</Dialog.Title>
        <Dialog.ScrollArea>
          <ScrollView>
            {list?.map((e) => {
              const status = e.done_by
                ? `${HOW[e.done_how]} von ${name(e.done_by)}`
                : e.claimed_by
                  ? e.claimed_by === me
                    ? 'Du kümmerst dich'
                    : `${name(e.claimed_by)} kümmert sich`
                  : 'offen'
              return (
                <List.Item
                  key={`${e.group}-${e.id}`}
                  title={e.name || e.number || 'Unbekannt'}
                  titleStyle={!e.done_by && !e.claimed_by ? { fontWeight: '700' } : undefined}
                  description={[e.group_name, whenLabel(e.time), status].filter(Boolean).join(' · ')}
                  descriptionNumberOfLines={2}
                  style={{ opacity: e.done_by ? 0.6 : 1, paddingHorizontal: 0 }}
                  right={() => (
                    <View style={styles.row}>
                      {!e.done_by && e.number ? (
                        <IconButton
                          icon="phone"
                          disabled={!ready}
                          onPress={() => {
                            if (!e.claimed_by) act(e, 'claim')
                            phone.dial(e.number)
                            onDismiss()
                          }}
                          accessibilityLabel="Zurückrufen"
                        />
                      ) : null}
                      {!e.done_by && !e.claimed_by && <IconButton icon="hand-back-left-outline" onPress={() => act(e, 'claim')} accessibilityLabel="Ich kümmere mich" />}
                      {e.done_by ? (
                        <IconButton icon="undo" onPress={() => act(e, 'reopen')} accessibilityLabel="Wieder öffnen" />
                      ) : (
                        <IconButton icon="check" onPress={() => act(e, 'done')} accessibilityLabel="Erledigt" />
                      )}
                    </View>
                  )}
                />
              )
            })}
            {list && !list.length && <Text style={{ paddingVertical: 16 }}>Keine verpassten Anrufe in deinen Gruppen.</Text>}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Schließen</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  )
}

/** Gruppen an-/abmelden, Handy klingelt mit, verpasste Gruppenanrufe */
function ReachCard() {
  const { profile, presence } = useStore()
  const [forward, setForward] = useState<ForwardInfo | null>(null)
  const [missed, setMissed] = useState(false)
  const canForward = Boolean(profile?.permissions?.includes('forward'))
  useEffect(() => {
    if (profile && canForward) fetchForward(profile).then(setForward).catch(() => setForward(null))
  }, [profile?.url, canForward])
  const groups = presence?.groups ?? []
  const open = presence?.missed?.open ?? 0
  if (!profile || (!groups.length && !forward?.mobile && !presence?.missed)) return null
  const fail = (e: Error): void => Alert.alert('Telefonanlage', e.message)
  return (
    <Card mode="contained" style={styles.card}>
      <Card.Title title="Erreichbarkeit" />
      {groups.map((g) => (
        <List.Item
          key={g.id}
          title={g.name || g.number}
          description={`Gruppe ${g.number} · ${g.active ? 'klingelt hier mit' : 'abgemeldet'}`}
          right={() => <Switch value={g.active} onValueChange={(v) => void setGroup(profile, g.id, v).catch(fail)} />}
        />
      ))}
      {forward?.mobile && (
        <List.Item
          title="Handy klingelt mit"
          description={forward.mobile.number}
          right={() => <Switch value={forward.mobile!.enabled} onValueChange={(v) => void setMobileRing(profile, v).then(setForward).catch(fail)} />}
        />
      )}
      {presence?.missed && (
        <Card.Actions>
          <Button icon="phone-missed" mode={open ? 'contained' : 'text'} onPress={() => setMissed(true)}>
            {open ? `${open} verpasste Gruppenanrufe offen` : 'Verpasste Gruppenanrufe'}
          </Button>
        </Card.Actions>
      )}
      <GroupMissedDialog visible={missed} onDismiss={() => setMissed(false)} />
    </Card>
  )
}

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
  const { profile, presence } = useStore()
  const { events } = useEvents(14)
  const groups = groupByDay(events, new Date(), 14)
  const today = groups[0]?.label.startsWith('Heute') ? groups[0].events.length : 0
  const hasCalendars = Boolean(profile?.calendars.length)
  const cards = (profile?.app?.home_cards.length ? profile.app.home_cards : DEFAULT_CARDS).filter(
    (c) => (hasCalendars || (c !== 'events' && c !== 'today')) && (c !== 'team' || presence),
  )
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {cards.map((c) => {
        switch (c) {
          case 'status':
            return (
              <View key={c}>
                <StatusCard />
                <ReachCard />
              </View>
            )
          case 'today':
            return <TodayCard key={c} count={today} />
          case 'favorites':
            return <FavoritesCard key={c} go={go} />
          case 'recent':
            return <RecentCard key={c} go={go} />
          case 'events':
            return <EventsCard key={c} go={go} groups={groups} />
          case 'team':
            return <TeamCard key={c} />
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
  row: { flexDirection: 'row', alignItems: 'center' },
})
