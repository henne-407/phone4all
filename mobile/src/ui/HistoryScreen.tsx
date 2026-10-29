/** Anrufverlauf dieses Geräts */

import { useEffect, useState } from 'react'
import { Alert, FlatList, StyleSheet, View } from 'react-native'
import { Button, Divider, IconButton, List, SegmentedButtons, Text, useTheme } from 'react-native-paper'
import { formatDuration } from '../numbers'
import { phone } from '../phone'
import { type VoicemailMessage, blockNumber, deleteVoicemail, fetchVoicemail, markVoicemail } from '../provisioning'
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
  const { phone: state, profile } = useStore()
  // Anrufer von außen in der ganzen Anlage sperren (Recht „Rufnummern sperren“)
  const canBlock = Boolean(profile?.permissions?.includes('block_numbers')) && entry.direction === 'in' && entry.number.replace(/\D/g, '').length > 5
  const block = (): void => {
    if (!profile) return
    Alert.alert(`${entry.name || entry.number} sperren?`, 'Anrufe von dieser Nummer kommen danach bei niemandem in der Telefonanlage mehr durch.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Sperren',
        style: 'destructive',
        onPress: () =>
          void blockNumber(profile, entry.number, entry.name)
            .then(() => Alert.alert('Gesperrt', `${entry.number} ist jetzt gesperrt.`))
            .catch((e: Error) => Alert.alert('Sperren fehlgeschlagen', e.message)),
      },
    ])
  }
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
      onLongPress={canBlock ? block : undefined}
      style={styles.item}
    />
  )
}

/** Voicemail der Anlage. Abgehört wird per Anruf (*97), hier lassen sich Nachrichten sehen, abhaken und löschen. */
function VoicemailList() {
  const { profile, presence, phone: state } = useStore()
  const theme = useTheme()
  const [messages, setMessages] = useState<VoicemailMessage[] | null>(null)
  const [error, setError] = useState('')
  const revision = presence?.voicemail?.revision
  useEffect(() => {
    if (!profile) return
    fetchVoicemail(profile)
      .then((m) => {
        setMessages(m)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
  }, [profile?.url, revision])
  const ready = state.registration === 'registered' && !state.call
  const run = (fn: Promise<VoicemailMessage[]>): void => void fn.then(setMessages).catch((e: Error) => Alert.alert('Voicemail', e.message))
  return (
    <FlatList
      data={messages ?? []}
      keyExtractor={(m) => m.id}
      ListHeaderComponent={
        <View style={styles.vmHeader}>
          <Button icon="voicemail" mode="contained-tonal" disabled={!ready} onPress={() => phone.dial(profile?.features.voicemail || '*97')}>
            Voicemail anrufen und abhören
          </Button>
          {error ? <Text style={{ color: theme.colors.error }}>{error}</Text> : null}
        </View>
      }
      renderItem={({ item: m }) => (
        <List.Item
          title={m.name || m.number || 'Unbekannt'}
          titleStyle={m.unread ? { fontWeight: '700' } : undefined}
          description={
            [m.name ? m.number : '', whenLabel(m.time), formatDuration(m.duration)].filter(Boolean).join(' · ') +
            (m.text ? `\n„${m.text}“` : m.transcribing ? '\nWird in Text umgewandelt …' : '')
          }
          descriptionNumberOfLines={m.text ? 12 : 2}
          left={(p) => <List.Icon {...p} icon={m.unread ? 'voicemail' : 'email-open-outline'} color={m.unread ? theme.colors.primary : theme.colors.onSurfaceVariant} />}
          right={() => (
            <View style={styles.row}>
              {m.unread && profile && <IconButton icon="check" onPress={() => run(markVoicemail(profile, m.id))} accessibilityLabel="Als gehört markieren" />}
              {m.number ? (
                <IconButton icon="phone" iconColor={theme.colors.primary} disabled={!ready} onPress={() => phone.dial(m.number)} accessibilityLabel="Zurückrufen" />
              ) : null}
              {profile && <IconButton icon="delete-outline" onPress={() => run(deleteVoicemail(profile, m.id))} accessibilityLabel="Löschen" />}
            </View>
          )}
          style={styles.item}
        />
      )}
      ItemSeparatorComponent={Divider}
      ListEmptyComponent={messages ? <Empty icon="voicemail" title="Keine Nachrichten" /> : undefined}
    />
  )
}

export function HistoryScreen() {
  const { history, clearHistory, profile, presence } = useStore()
  const [tab, setTab] = useState('calls')
  const unread = presence?.voicemail?.unread ?? 0
  return (
    <View style={styles.screen}>
      {profile?.voicemail && presence?.voicemail && (
        <SegmentedButtons
          value={tab}
          onValueChange={setTab}
          style={styles.tabs}
          buttons={[
            { value: 'calls', label: 'Anrufe', icon: 'history' },
            { value: 'voicemail', label: unread ? `Voicemail (${unread})` : 'Voicemail', icon: 'voicemail' },
          ]}
        />
      )}
      {tab === 'voicemail' && presence?.voicemail ? (
        <VoicemailList />
      ) : (
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
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  item: { paddingLeft: 8 },
  clear: { margin: 16 },
  tabs: { margin: 12 },
  vmHeader: { padding: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
})
