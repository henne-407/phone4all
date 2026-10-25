/** Wähltastatur */

import { Pressable, StyleSheet, View } from 'react-native'
import { FAB, IconButton, Text, useTheme } from 'react-native-paper'
import { phone } from '../phone'
import { findName } from '../numbers'
import { useStore } from '../state'
import { toNamed } from '../contacts'
import { CALL_GREEN } from './theme'

export const KEYS: [string, string][] = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
]

export function Keypad({ onKey, onLong }: { onKey: (k: string) => void; onLong?: (k: string) => void }) {
  const theme = useTheme()
  return (
    <View style={styles.keys}>
      {KEYS.map(([k, sub]) => (
        <Pressable
          key={k}
          accessibilityLabel={k}
          onPress={() => onKey(k)}
          onLongPress={() => onLong?.(k)}
          style={({ pressed }) => [styles.key, { backgroundColor: pressed ? theme.colors.surfaceVariant : theme.colors.elevation.level2 }]}
        >
          <Text variant="headlineMedium">{k}</Text>
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, minHeight: 14 }}>
            {sub}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

export function DialScreen({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { people, profile, phone: state } = useStore()
  const theme = useTheme()
  const name = value.length >= 2 ? findName(value, toNamed(people)) : ''
  const canCall = state.registration === 'registered' && !state.call
  return (
    <View style={styles.screen}>
      <View style={styles.display}>
        <Text variant="displaySmall" numberOfLines={1} adjustsFontSizeToFit style={styles.number}>
          {value || ' '}
        </Text>
        <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, minHeight: 24 }}>
          {name}
        </Text>
      </View>
      <Keypad onKey={(k) => onChange(value + k)} onLong={(k) => k === '0' && onChange(value + '+')} />
      <View style={styles.actions}>
        <IconButton
          icon="voicemail"
          size={28}
          accessibilityLabel="Voicemail"
          onPress={() => phone.dial(profile?.features.voicemail || '*97')}
          disabled={!canCall}
        />
        <FAB
          icon="phone"
          color="#fff"
          style={{ backgroundColor: canCall && value ? CALL_GREEN : theme.colors.surfaceDisabled }}
          disabled={!canCall || !value}
          onPress={() => phone.dial(value)}
          accessibilityLabel="Anrufen"
        />
        <IconButton
          icon="backspace-outline"
          size={28}
          accessibilityLabel="Löschen"
          onPress={() => onChange(value.slice(0, -1))}
          onLongPress={() => onChange('')}
          disabled={!value}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'flex-end', padding: 16, paddingBottom: 24 },
  display: { alignItems: 'center', marginBottom: 16, minHeight: 80, justifyContent: 'flex-end' },
  number: { textAlign: 'center' },
  keys: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12, maxWidth: 360, alignSelf: 'center', width: '100%' },
  key: { width: '30%', aspectRatio: 1.5, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginTop: 20, maxWidth: 360, alignSelf: 'center', width: '100%' },
})
