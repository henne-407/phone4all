/** Anrufverlauf dieses Geräts */

import { FlatList, StyleSheet, View } from 'react-native'
import { Button, Divider, IconButton, List, useTheme } from 'react-native-paper'
import { formatDuration } from '../numbers'
import { phone } from '../phone'
import { useStore } from '../state'
import type { HistoryEntry } from '../storage'
import { Empty } from './common'
import { CALL_RED } from './theme'

export function whenLabel(time: number, now = new Date()): string {
  const d = new Date(time)
  const sameDay = d.toDateString() === now.toDateString()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toDateString() === d.toDateString()
  const clock = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return clock
  if (yesterday) return `Gestern, ${clock}`
  return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${clock}`
}

export function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const theme = useTheme()
  const { phone: state } = useStore()
  const icon = entry.missed ? 'phone-missed' : entry.direction === 'in' ? 'phone-incoming' : 'phone-outgoing'
  const detail = [whenLabel(entry.time), entry.duration ? formatDuration(entry.duration) : entry.missed ? 'verpasst' : 'nicht verbunden']
  return (
    <List.Item
      title={entry.name || entry.number}
      titleStyle={entry.missed ? { color: CALL_RED } : undefined}
      description={[entry.name ? entry.number : '', ...detail].filter(Boolean).join(' · ')}
      left={(p) => <List.Icon {...p} icon={icon} color={entry.missed ? CALL_RED : theme.colors.onSurfaceVariant} />}
      right={() => (
        <IconButton
          icon="phone"
          iconColor={theme.colors.primary}
          disabled={state.registration !== 'registered' || Boolean(state.call)}
          onPress={() => phone.dial(entry.number)}
          accessibilityLabel="Zurückrufen"
        />
      )}
      style={styles.item}
    />
  )
}

export function HistoryScreen() {
  const { history, clearHistory } = useStore()
  return (
    <View style={styles.screen}>
      <FlatList
        data={history}
        keyExtractor={(h) => h.id}
        renderItem={({ item }) => <HistoryRow entry={item} />}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={<Empty icon="history" title="Noch keine Anrufe" />}
        ListFooterComponent={
          history.length ? (
            <Button style={styles.clear} onPress={clearHistory}>
              Verlauf löschen
            </Button>
          ) : undefined
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  item: { paddingLeft: 8 },
  clear: { margin: 16 },
})
