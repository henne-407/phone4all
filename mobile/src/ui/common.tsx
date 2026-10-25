/** Gemeinsame Bausteine der Oberfläche */

import { StyleSheet, View } from 'react-native'
import { Avatar, Text, useTheme } from 'react-native-paper'
import type { Registration } from '../phone'

export function registrationLabel(r: Registration): { text: string; icon: string } {
  switch (r) {
    case 'registered':
      return { text: 'Erreichbar', icon: 'check-circle' }
    case 'connecting':
      return { text: 'Verbindet …', icon: 'progress-clock' }
    case 'failed':
      return { text: 'Abgelehnt', icon: 'alert-circle' }
    default:
      return { text: 'Aus', icon: 'phone-off' }
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '#'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function PersonAvatar({ name, size = 40 }: { name: string; size?: number }) {
  const theme = useTheme()
  return (
    <Avatar.Text
      size={size}
      label={initials(name || '#')}
      style={{ backgroundColor: theme.colors.primaryContainer }}
      color={theme.colors.onPrimaryContainer}
    />
  )
}

export function Empty({ icon, title, text }: { icon: string; title: string; text?: string }) {
  const theme = useTheme()
  return (
    <View style={styles.empty}>
      <Avatar.Icon size={64} icon={icon} style={{ backgroundColor: theme.colors.surfaceVariant }} color={theme.colors.onSurfaceVariant} />
      <Text variant="titleMedium">{title}</Text>
      {text && (
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
          {text}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 32, flex: 1 },
})
