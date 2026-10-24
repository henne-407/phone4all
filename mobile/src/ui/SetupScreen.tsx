/** Einrichtung: QR-Code scannen, Link einfügen oder Anlage + Nebenstelle + PIN. */

import { CameraView, useCameraPermissions } from 'expo-camera'
import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { Appbar, Button, Card, Divider, HelperText, Text, TextInput } from 'react-native-paper'
import { SafeAreaView } from 'react-native-safe-area-context'
import { type Profile, fetchProfile, parseSetupInput, setupWithPin } from '../provisioning'
import { useStore } from '../state'

export function SetupScreen({ initial, onCancel, onDone }: { initial: string; onCancel?: () => void; onDone: () => void }) {
  const { setup } = useStore()
  const [link, setLink] = useState(initial)
  const [server, setServer] = useState('')
  const [ext, setExt] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [scan, setScan] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()
  const scanned = useRef(false)

  const finish = async (load: () => Promise<Profile>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const p = await load()
      await setup(p)
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const applyLink = (text: string): void => {
    const target = parseSetupInput(text)
    if (!target) {
      setError('Das ist kein Einrichtungslink der Telefonanlage.')
      return
    }
    if (target.kind === 'server') {
      // Nur die Adresse: Nebenstelle und PIN fehlen noch
      setServer(target.base)
      setLink('')
      setError('Bitte noch Nebenstelle und Einrichtungs-PIN eingeben.')
      return
    }
    void finish(() => fetchProfile(target.url))
  }

  useEffect(() => {
    if (initial) applyLink(initial)
    // nur beim Öffnen mit Link
  }, [initial])

  const startScan = async (): Promise<void> => {
    const p = permission?.granted ? permission : await requestPermission()
    if (!p.granted) {
      setError('Ohne Kamera kein QR-Code – den Link alternativ einfügen.')
      return
    }
    scanned.current = false
    setScan(true)
  }

  if (scan) {
    return (
      <View style={styles.fill}>
        <CameraView
          style={styles.fill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (scanned.current) return
            scanned.current = true
            setScan(false)
            setLink(data)
            applyLink(data)
          }}
        />
        <SafeAreaView style={styles.scanBar} edges={['bottom']}>
          <Text variant="titleMedium" style={styles.scanText}>
            QR-Code der Nebenstelle in den Rahmen halten
          </Text>
          <Button mode="contained-tonal" onPress={() => setScan(false)}>
            Abbrechen
          </Button>
        </SafeAreaView>
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.fill} edges={['bottom']}>
      <Appbar.Header>
        {onCancel && <Appbar.BackAction onPress={onCancel} />}
        <Appbar.Content title="SIP-Telefon einrichten" />
      </Appbar.Header>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text variant="bodyLarge" style={styles.intro}>
            Die App holt Konto, Kontakte und Kalender von Ihrer Phone4all-Telefonanlage – im Büro und unterwegs über HTTPS.
          </Text>
          <Card mode="contained" style={styles.card}>
            <Card.Title title="QR-Code scannen" subtitle="Weboberfläche → Nebenstellen → Bearbeiten" />
            <Card.Actions>
              <Button mode="contained" icon="qrcode-scan" onPress={() => void startScan()} disabled={busy}>
                Scannen
              </Button>
            </Card.Actions>
          </Card>
          <Card mode="contained" style={styles.card}>
            <Card.Title title="Einrichtungslink" subtitle="Aus der Einladungs-E-Mail" />
            <Card.Content>
              <TextInput mode="outlined" label="Link" value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            </Card.Content>
            <Card.Actions>
              <Button mode="contained" onPress={() => applyLink(link)} disabled={busy || !link.trim()}>
                Einrichten
              </Button>
            </Card.Actions>
          </Card>
          <Divider style={styles.divider} />
          <Card mode="contained" style={styles.card}>
            <Card.Title title="Mit Nebenstelle und PIN" />
            <Card.Content style={styles.gap}>
              <TextInput mode="outlined" label="Anlage" placeholder="https://telefon.example.de" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
              <TextInput mode="outlined" label="Nebenstelle" value={ext} onChangeText={(t) => setExt(t.replace(/\D/g, ''))} keyboardType="number-pad" />
              <TextInput mode="outlined" label="Einrichtungs-PIN" value={pin} onChangeText={(t) => setPin(t.replace(/\D/g, ''))} keyboardType="number-pad" secureTextEntry />
            </Card.Content>
            <Card.Actions>
              <Button
                mode="contained"
                loading={busy}
                disabled={busy || !server.trim() || !ext || !pin}
                onPress={() => void finish(() => setupWithPin(server, ext, pin))}
              >
                Einrichten
              </Button>
            </Card.Actions>
          </Card>
          <HelperText type="error" visible={Boolean(error)} style={styles.error}>
            {error}
          </HelperText>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  intro: { marginBottom: 16 },
  card: { marginBottom: 12 },
  gap: { gap: 8 },
  divider: { marginVertical: 8 },
  error: { fontSize: 15 },
  scanBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 24, gap: 12, backgroundColor: 'rgba(0,0,0,0.55)' },
  scanText: { color: '#fff', textAlign: 'center' },
})
