/** Gesprächsansicht: eingehend, wählt, im Gespräch, beendet */

import { useKeepAwake } from 'expo-keep-awake'
import { useEffect, useState } from 'react'
import { Alert, Linking, Modal, StyleSheet, View } from 'react-native'
import { Button, Dialog, FAB, IconButton, Portal, Text, TextInput, useTheme } from 'react-native-paper'
import { SafeAreaView } from 'react-native-safe-area-context'
import { formatDuration } from '../numbers'
import { crmUrl } from '../provisioning'
import { type Call, phone } from '../phone'
import { useStore } from '../state'
import { PersonAvatar } from './common'
import { Keypad } from './DialScreen'
import { CALL_GREEN, CALL_RED } from './theme'


const ORIGIN: Record<string, string> = { internal: 'Interner Anruf', external: 'Anruf von außen', group: 'Gruppenanruf' }

function statusText(c: Call, now: number): string {
  switch (c.status) {
    case 'incoming':
      return 'Eingehender Anruf'
    case 'calling':
      return 'Wird verbunden …'
    case 'ringing':
      return 'Klingelt …'
    case 'active':
      return c.held ? 'Gehalten' : formatDuration((now - c.answered) / 1000)
    case 'ended':
      return c.reason || 'Beendet'
  }
}

function Toggle({ icon, label, active, onPress, disabled }: { icon: string; label: string; active?: boolean; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme()
  return (
    <View style={styles.toggle}>
      <IconButton
        icon={icon}
        size={30}
        mode={active ? 'contained' : 'contained-tonal'}
        selected={active}
        disabled={disabled}
        onPress={onPress}
        accessibilityLabel={label}
      />
      <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        {label}
      </Text>
    </View>
  )
}

export function CallScreen() {
  useKeepAwake()
  const { phone: state, profile } = useStore()
  const theme = useTheme()
  const call = state.call
  const [now, setNow] = useState(Date.now())
  const [keypad, setKeypad] = useState(false)
  const [digits, setDigits] = useState('')
  const [transfer, setTransfer] = useState<'' | 'transfer' | 'consult'>('')
  const [target, setTarget] = useState('')
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!call) return null
  const active = call.status === 'active'
  const ended = call.status === 'ended'
  const other = state.other
  const door = profile?.doors?.find((d) => d.number === call.number)
  const join = (mode: 'transfer' | 'conference'): void => {
    setJoining(true)
    phone
      .join(mode)
      .catch((e: Error) => Alert.alert(mode === 'transfer' ? 'Verbinden' : 'Konferenz', e.message))
      .finally(() => setJoining(false))
  }
  return (
    <Modal visible animationType="slide" onRequestClose={() => undefined} statusBarTranslucent>
      {/* Dialoge im Modal brauchen einen eigenen Portal-Host */}
      <Portal.Host>
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <View style={styles.top}>
          <PersonAvatar name={call.name || call.number} size={96} />
          <Text variant="headlineMedium" style={styles.center} numberOfLines={2}>
            {call.name || call.number}
          </Text>
          {call.name || call.origin ? (
            <Text variant="titleMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {[call.name && call.number, call.status === 'incoming' && call.origin ? ORIGIN[call.origin] : ''].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          <Text variant="titleMedium" style={{ color: ended && call.reason ? CALL_RED : theme.colors.primary, marginTop: 8 }}>
            {statusText(call, now)}
          </Text>
          {other && (
            <View style={styles.other}>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }} numberOfLines={1}>
                Gehalten: {other.name || other.number}
              </Text>
              <View style={styles.otherButtons}>
                <Button mode="outlined" compact icon="swap-horizontal" disabled={!active} onPress={() => phone.swap()}>
                  Makeln
                </Button>
                <Button mode="contained-tonal" compact icon="call-merge" disabled={!active || joining} onPress={() => join('transfer')}>
                  Verbinden
                </Button>
                <Button mode="contained-tonal" compact icon="account-group" disabled={!active || joining} onPress={() => join('conference')}>
                  Konferenz
                </Button>
              </View>
            </View>
          )}
          {keypad && (
            <Text variant="headlineSmall" style={styles.digits} numberOfLines={1}>
              {digits}
            </Text>
          )}
        </View>
        {call.status === 'incoming' ? (
          <View style={styles.incoming}>
            <View style={styles.toggle}>
              <FAB icon="phone-hangup" color="#fff" style={{ backgroundColor: CALL_RED }} onPress={() => phone.hangup()} accessibilityLabel="Ablehnen" />
              <Text variant="labelLarge">Ablehnen</Text>
            </View>
            <View style={styles.toggle}>
              <FAB icon="phone" color="#fff" style={{ backgroundColor: CALL_GREEN }} onPress={() => phone.answer()} accessibilityLabel="Annehmen" />
              <Text variant="labelLarge">Annehmen</Text>
            </View>
          </View>
        ) : (
          <View style={styles.bottom}>
            {keypad ? (
              <Keypad
                onKey={(k) => {
                  setDigits((d) => d + k)
                  phone.dtmf(k)
                }}
              />
            ) : (
              <View style={styles.grid}>
                <Toggle icon={call.muted ? 'microphone-off' : 'microphone'} label="Stumm" active={call.muted} onPress={() => phone.toggleMute()} disabled={ended} />
                <Toggle icon="dialpad" label="Tasten" onPress={() => setKeypad(true)} disabled={!active} />
                <Toggle icon="volume-high" label="Lautsprecher" active={call.speaker} onPress={() => phone.toggleSpeaker()} disabled={ended} />
                <Toggle icon={call.held ? 'play' : 'pause'} label={call.held ? 'Fortsetzen' : 'Halten'} active={call.held} onPress={() => phone.toggleHold()} disabled={!active} />
                <Toggle icon="phone-forward" label="Weiterleiten" onPress={() => setTransfer('transfer')} disabled={!active} />
                <Toggle icon="phone-plus" label="Rückfrage" onPress={() => setTransfer('consult')} disabled={!active || Boolean(other)} />
                {door && (
                  <Toggle
                    icon="door-open"
                    label="Tür öffnen"
                    disabled={!active}
                    onPress={() => [...door.dtmf].forEach((d, i) => setTimeout(() => phone.dtmf(d), i * 250))}
                  />
                )}
                {profile?.parking && <Toggle icon="parking" label="Parken" onPress={() => phone.transfer(profile.parking!.number)} disabled={!active} />}
                {profile?.crm && (
                  <Toggle icon="open-in-new" label="CRM" onPress={() => void Linking.openURL(crmUrl(profile.crm!.url, call.number, call.name)).catch(() => undefined)} />
                )}
              </View>
            )}
            <View style={styles.hangupRow}>
              {keypad && <Button onPress={() => setKeypad(false)}>Ausblenden</Button>}
              <FAB
                icon="phone-hangup"
                color="#fff"
                style={{ backgroundColor: ended ? theme.colors.surfaceDisabled : CALL_RED }}
                disabled={ended}
                onPress={() => phone.hangup()}
                accessibilityLabel="Auflegen"
              />
            </View>
          </View>
        )}
        <Portal>
          <Dialog visible={Boolean(transfer)} onDismiss={() => setTransfer('')}>
            <Dialog.Title>{transfer === 'consult' ? 'Rückfrage bei' : 'Weiterleiten an'}</Dialog.Title>
            <Dialog.Content>
              <TextInput mode="outlined" label="Nummer" value={target} onChangeText={setTarget} keyboardType="phone-pad" autoFocus />
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setTransfer('')}>Abbrechen</Button>
              <Button
                disabled={!target.trim()}
                onPress={() => {
                  setTransfer('')
                  if (transfer === 'consult') phone.consult(target)
                  else phone.transfer(target)
                  setTarget('')
                }}
              >
                {transfer === 'consult' ? 'Anrufen' : 'Weiterleiten'}
              </Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>
      </SafeAreaView>
      </Portal.Host>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'space-between', padding: 24 },
  top: { alignItems: 'center', gap: 4, marginTop: 32 },
  center: { textAlign: 'center', marginTop: 16 },
  digits: { marginTop: 12, letterSpacing: 2 },
  other: { alignItems: 'center', gap: 8, marginTop: 16 },
  otherButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  incoming: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 48 },
  bottom: { gap: 24, marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', rowGap: 16, columnGap: 24 },
  toggle: { alignItems: 'center', gap: 4, minWidth: 80 },
  hangupRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24 },
})
