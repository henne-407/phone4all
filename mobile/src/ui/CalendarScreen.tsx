/** Zentrale Kalender der Anlage: Termine der nächsten Wochen, eigene Termine anlegen */

import { useMemo, useState } from 'react'
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native'
import { Button, Dialog, FAB, HelperText, List, Portal, SegmentedButtons, Switch, Text, TextInput, useTheme } from 'react-native-paper'
import { groupByDay, isoDate, timeLabel } from '../dates'
import { type CalendarEvent, deleteEvent, saveEvent } from '../provisioning'
import { useStore } from '../state'
import { useEvents } from '../useEvents'
import { Empty } from './common'

const DAYS = 60

/** „24.12.2026“ → Date */
export function parseGermanDate(s: string): Date | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s.trim())
  if (!m) return null
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return d.getDate() === Number(m[1]) ? d : null
}

function parseTime(s: string): [number, number] | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(s.trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return [Number(m[1]), Number(m[2])]
}

function newUid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}@sip-telefon`
}

function EventDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { profile } = useStore()
  const writable = profile?.calendars.filter((c) => c.writable) ?? []
  const today = new Date()
  const [calendar, setCalendar] = useState(writable[0]?.id ?? '')
  const [summary, setSummary] = useState('')
  const [date, setDate] = useState(today.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }))
  const [allDay, setAllDay] = useState(false)
  const [from, setFrom] = useState('09:00')
  const [to, setTo] = useState('10:00')
  const [location, setLocation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    const d = parseGermanDate(date)
    if (!summary.trim()) return setError('Bitte einen Titel eingeben.')
    if (!d) return setError('Datum bitte als TT.MM.JJJJ eingeben.')
    let start: string
    let end: string
    if (allDay) {
      start = isoDate(d)
      end = isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))
    } else {
      const a = parseTime(from)
      const b = parseTime(to)
      if (!a || !b) return setError('Uhrzeiten bitte als HH:MM eingeben.')
      const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), a[0], a[1])
      const e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), b[0], b[1])
      if (e <= s) return setError('Das Ende muss nach dem Beginn liegen.')
      start = s.toISOString()
      end = e.toISOString()
    }
    if (!profile) return
    setBusy(true)
    try {
      await saveEvent(profile, { uid: newUid(), calendar, summary: summary.trim(), start, end, allDay, location: location.trim(), description: '' })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog visible onDismiss={onClose}>
      <Dialog.Title>Neuer Termin</Dialog.Title>
      <Dialog.ScrollArea style={styles.dialogArea}>
        <View style={styles.form}>
          {writable.length > 1 && (
            <SegmentedButtons value={calendar} onValueChange={setCalendar} buttons={writable.map((c) => ({ value: c.id, label: c.name }))} />
          )}
          <TextInput mode="outlined" label="Titel" value={summary} onChangeText={setSummary} />
          <TextInput mode="outlined" label="Datum" value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" />
          <View style={styles.row}>
            <Text variant="bodyLarge">Ganztägig</Text>
            <Switch value={allDay} onValueChange={setAllDay} />
          </View>
          {!allDay && (
            <View style={styles.row}>
              <TextInput mode="outlined" label="Von" value={from} onChangeText={setFrom} style={styles.half} keyboardType="numbers-and-punctuation" />
              <TextInput mode="outlined" label="Bis" value={to} onChangeText={setTo} style={styles.half} keyboardType="numbers-and-punctuation" />
            </View>
          )}
          <TextInput mode="outlined" label="Ort" value={location} onChangeText={setLocation} />
          <HelperText type="error" visible={Boolean(error)}>
            {error}
          </HelperText>
        </View>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        <Button onPress={onClose}>Abbrechen</Button>
        <Button onPress={() => void save()} loading={busy} disabled={busy}>
          Speichern
        </Button>
      </Dialog.Actions>
    </Dialog>
  )
}

export function CalendarScreen() {
  const { profile } = useStore()
  const theme = useTheme()
  const { events, loading, error, reload } = useEvents(DAYS)
  const [adding, setAdding] = useState(false)
  const [remove, setRemove] = useState<CalendarEvent | null>(null)
  const sections = useMemo(() => groupByDay(events, new Date(), DAYS).map((g) => ({ title: g.label, data: g.events })), [events])
  const calendars = new Map((profile?.calendars ?? []).map((c) => [c.id, c]))
  const canWrite = (profile?.calendars ?? []).some((c) => c.writable)

  if (!profile?.calendars.length) {
    return <Empty icon="calendar-blank-outline" title="Keine Kalender" text="Die Telefonanlage stellt dieser Nebenstelle keine Kalender bereit." />
  }
  return (
    <View style={styles.screen}>
      {error ? <HelperText type="error">{error}</HelperText> : null}
      <SectionList
        sections={sections}
        keyExtractor={(e) => `${e.calendar}/${e.uid}/${e.start}`}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
        renderSectionHeader={({ section }) => (
          <Text variant="titleSmall" style={[styles.header, { color: theme.colors.primary, backgroundColor: theme.colors.background }]}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => {
          const cal = calendars.get(item.calendar)
          return (
            <List.Item
              title={item.summary || '(ohne Titel)'}
              description={[timeLabel(item), item.location, cal?.name].filter(Boolean).join(' · ')}
              left={() => <View style={[styles.dot, { backgroundColor: cal?.color ?? theme.colors.primary }]} />}
              onLongPress={() => cal?.writable && setRemove(item)}
            />
          )
        }}
        ListEmptyComponent={loading ? undefined : <Empty icon="calendar-check-outline" title="Keine Termine" text={`In den nächsten ${DAYS} Tagen steht nichts an.`} />}
        stickySectionHeadersEnabled
      />
      {canWrite && <FAB icon="plus" style={styles.fab} onPress={() => setAdding(true)} accessibilityLabel="Termin anlegen" />}
      <Portal>
        {adding && (
          <EventDialog
            onClose={() => setAdding(false)}
            onSaved={() => {
              setAdding(false)
              reload()
            }}
          />
        )}
        <Dialog visible={Boolean(remove)} onDismiss={() => setRemove(null)}>
          <Dialog.Title>Termin löschen?</Dialog.Title>
          <Dialog.Content>
            <Text>{remove?.summary}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRemove(null)}>Abbrechen</Button>
            <Button
              onPress={() => {
                const ev = remove
                setRemove(null)
                if (ev && profile) void deleteEvent(profile, ev).then(reload, reload)
              }}
            >
              Löschen
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, marginLeft: 16, marginTop: 6 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
  dialogArea: { paddingHorizontal: 0 },
  form: { gap: 8, padding: 24 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  half: { flex: 1 },
})
