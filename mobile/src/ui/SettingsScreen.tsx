/** Einstellungen: Konto, Erreichbarkeit im Hintergrund, Gerätekontakte */

import Constants from 'expo-constants'
import { useState } from 'react'
import { Platform, ScrollView, StyleSheet } from 'react-native'
import { Appbar, Button, Dialog, Divider, List, Portal, Switch, Text } from 'react-native-paper'
import { SafeAreaView } from 'react-native-safe-area-context'
import { available as serviceAvailable, needsBatteryException, requestBatteryException } from '../../modules/call-service'
import { useStore } from '../state'
import { registrationLabel } from './common'

export function SettingsScreen({ onClose, onResetup }: { onClose: () => void; onResetup: () => void }) {
  const { profile, phone, settings, updateSettings, reloadProfile, reset } = useStore()
  const [confirm, setConfirm] = useState(false)
  const [message, setMessage] = useState('')
  const status = registrationLabel(phone.registration)
  const battery = Platform.OS === 'android' && serviceAvailable && needsBatteryException()
  return (
    <SafeAreaView style={styles.fill} edges={['bottom']}>
      <Appbar.Header>
        <Appbar.BackAction onPress={onClose} />
        <Appbar.Content title="Einstellungen" />
      </Appbar.Header>
      <ScrollView>
        <List.Section title="Konto">
          <List.Item title={profile?.account.display_name} description={`Nebenstelle ${profile?.extension}`} left={(p) => <List.Icon {...p} icon="account" />} />
          <List.Item title={profile?.pbx.name} description={`Telefonanlage ${profile?.pbx.version}`} left={(p) => <List.Icon {...p} icon="phone-classic" />} />
          <List.Item
            title={status.text}
            description={phone.error || profile?.remote?.websocket}
            descriptionNumberOfLines={2}
            left={(p) => <List.Icon {...p} icon={status.icon} />}
          />
          <List.Item
            title="Von der Anlage aktualisieren"
            description={message || 'Kontakte, Kalender und Vorgaben neu laden'}
            left={(p) => <List.Icon {...p} icon="refresh" />}
            onPress={() =>
              void reloadProfile()
                .then(() => setMessage('Aktualisiert'))
                .catch((e: Error) => setMessage(e.message))
            }
          />
        </List.Section>
        <Divider />
        <List.Section title="Erreichbarkeit">
          <List.Item
            title="Durchsagen selbst annehmen"
            description="Durchsagen und Gegensprechen der Anlage gehen ohne Klingeln auf den Lautsprecher"
            descriptionNumberOfLines={2}
            left={(p) => <List.Icon {...p} icon="bullhorn-outline" />}
            right={() => <Switch value={settings.autoAnswerPages} onValueChange={(v) => updateSettings({ autoAnswerPages: v })} />}
          />
          {Platform.OS === 'android' ? (
            <>
              <List.Item
                title="Im Hintergrund erreichbar"
                description="Hält die Verbindung zur Anlage, eine Benachrichtigung zeigt das an"
                descriptionNumberOfLines={2}
                left={(p) => <List.Icon {...p} icon="bell-ring-outline" />}
                right={() => <Switch value={settings.background} onValueChange={(v) => updateSettings({ background: v })} />}
              />
              {battery && settings.background && (
                <List.Item
                  title="Akku-Optimierung ausschalten"
                  description="Sonst trennt Android die Verbindung nach einiger Zeit"
                  descriptionNumberOfLines={2}
                  left={(p) => <List.Icon {...p} icon="battery-alert-variant-outline" />}
                  onPress={requestBatteryException}
                />
              )}
            </>
          ) : (
            <List.Item
              title="Anrufe bei geöffneter App"
              description="Auf dem iPhone kommen Anrufe an, solange die App geöffnet ist. Für Anrufe bei geschlossener App braucht es Push-Benachrichtigungen (geplant)."
              descriptionNumberOfLines={4}
              left={(p) => <List.Icon {...p} icon="information-outline" />}
            />
          )}
        </List.Section>
        <Divider />
        <List.Section title="Kontakte">
          <List.Item
            title="Kontakte des Geräts"
            description="Zusätzlich zum Telefonbuch der Anlage anzeigen und für Anrufernamen nutzen"
            descriptionNumberOfLines={2}
            left={(p) => <List.Icon {...p} icon="contacts-outline" />}
            right={() => <Switch value={settings.deviceContacts} onValueChange={(v) => updateSettings({ deviceContacts: v })} />}
          />
        </List.Section>
        <Divider />
        <List.Section title="Einrichtung">
          {!profile?.app?.lock_account && (
            <List.Item title="Neu einrichten" description="Andere Nebenstelle oder neuer Einrichtungslink" left={(p) => <List.Icon {...p} icon="qrcode-scan" />} onPress={onResetup} />
          )}
          <List.Item title="Vom Gerät entfernen" titleStyle={styles.danger} left={(p) => <List.Icon {...p} icon="delete-outline" color="#c62828" />} onPress={() => setConfirm(true)} />
        </List.Section>
        <Text variant="bodySmall" style={styles.version}>
          SIP-Telefon {Constants.expoConfig?.version ?? ''}
        </Text>
      </ScrollView>
      <Portal>
        <Dialog visible={confirm} onDismiss={() => setConfirm(false)}>
          <Dialog.Title>Vom Gerät entfernen?</Dialog.Title>
          <Dialog.Content>
            <Text>Konto, Verlauf und Zugangsdaten werden gelöscht. Danach lässt sich die App mit dem QR-Code neu einrichten.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirm(false)}>Abbrechen</Button>
            <Button
              textColor="#c62828"
              onPress={() => {
                setConfirm(false)
                onClose()
                void reset()
              }}
            >
              Entfernen
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  danger: { color: '#c62828' },
  version: { textAlign: 'center', opacity: 0.6, margin: 24 },
})
