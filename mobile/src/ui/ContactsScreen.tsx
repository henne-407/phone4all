/** Kontakte: zentrales Telefonbuch der Anlage und Kontakte des Geräts */

import { useMemo, useState } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
import { Divider, IconButton, List, Searchbar, SegmentedButtons, Text, useTheme } from 'react-native-paper'
import { type Person, searchPeople } from '../contacts'
import { phone } from '../phone'
import { useStore } from '../state'
import { Empty, PersonAvatar } from './common'

export function PersonRow({ person }: { person: Person }) {
  const { settings, toggleFavorite, phone: state } = useStore()
  const [open, setOpen] = useState(false)
  const theme = useTheme()
  const main = person.phones[0]?.number ?? ''
  const canCall = state.registration === 'registered' && !state.call
  return (
    <>
      <List.Item
        title={person.name}
        description={[person.company, person.phones.length > 1 ? `${person.phones.length} Nummern` : main].filter(Boolean).join(' · ')}
        left={() => <PersonAvatar name={person.name} />}
        right={() => (
          <IconButton icon="phone" iconColor={theme.colors.primary} disabled={!canCall || !main} onPress={() => phone.dial(main)} accessibilityLabel={`${person.name} anrufen`} />
        )}
        onPress={() => setOpen(!open)}
        style={styles.item}
      />
      {open &&
        person.phones.map((p) => (
          <List.Item
            key={p.number}
            title={p.number}
            description={p.label}
            style={styles.sub}
            left={() => (
              <IconButton
                icon={settings.favorites.includes(p.number) ? 'star' : 'star-outline'}
                onPress={() => toggleFavorite(p.number)}
                accessibilityLabel="Favorit"
              />
            )}
            right={() => <IconButton icon="phone-outline" disabled={!canCall} onPress={() => phone.dial(p.number)} />}
            onPress={() => canCall && phone.dial(p.number)}
          />
        ))}
    </>
  )
}

export function ContactsScreen() {
  const { people, settings, contactsError } = useStore()
  const [q, setQ] = useState('')
  const [source, setSource] = useState<'all' | 'pbx' | 'device'>('all')
  const list = useMemo(() => searchPeople(source === 'all' ? people : people.filter((p) => p.source === source), q), [people, q, source])
  return (
    <View style={styles.screen}>
      <Searchbar placeholder="Name oder Nummer" value={q} onChangeText={setQ} style={styles.search} />
      {settings.deviceContacts && (
        <SegmentedButtons
          style={styles.segments}
          value={source}
          onValueChange={(v) => setSource(v as typeof source)}
          buttons={[
            { value: 'all', label: 'Alle' },
            { value: 'pbx', label: 'Anlage' },
            { value: 'device', label: 'Gerät' },
          ]}
        />
      )}
      {contactsError ? (
        <Text style={styles.error} variant="bodyMedium">
          {contactsError}
        </Text>
      ) : null}
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PersonRow person={item} />}
        ItemSeparatorComponent={Divider}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Empty icon="account-search-outline" title={q ? 'Nichts gefunden' : 'Keine Kontakte'} text={q ? undefined : 'Die Anlage verteilt ihr Telefonbuch; Gerätekontakte lassen sich in den Einstellungen einblenden.'} />}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  search: { margin: 12, marginBottom: 8 },
  segments: { marginHorizontal: 12, marginBottom: 8 },
  item: { paddingLeft: 12 },
  sub: { paddingLeft: 56 },
  error: { marginHorizontal: 16, marginBottom: 8, color: '#c62828' },
})
