import * as Linking from 'expo-linking'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { useColorScheme } from 'react-native'
import { ActivityIndicator, PaperProvider } from 'react-native-paper'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StoreProvider, useStore } from './src/state'
import { CallScreen } from './src/ui/CallScreen'
import { MainScreen } from './src/ui/MainScreen'
import { SetupScreen } from './src/ui/SetupScreen'
import { darkTheme, lightTheme } from './src/ui/theme'

function Root() {
  const { ready, profile, phone } = useStore()
  const url = Linking.useLinkingURL()
  const [link, setLink] = useState<string | null>(null)
  const [resetup, setResetup] = useState(false)

  // Einrichtungslink aus E-Mail, Weboberfläche oder QR-Code-App
  useEffect(() => {
    if (url && /provision|setup/.test(url)) setLink(url)
  }, [url])

  if (!ready) return <ActivityIndicator style={{ flex: 1 }} />
  if (!profile || resetup || link) {
    return (
      <SetupScreen
        initial={link ?? ''}
        onCancel={profile ? () => (setResetup(false), setLink(null)) : undefined}
        onDone={() => (setResetup(false), setLink(null))}
      />
    )
  }
  return (
    <>
      <MainScreen onResetup={() => setResetup(true)} />
      {phone.call && <CallScreen />}
    </>
  )
}

export default function App() {
  const scheme = useColorScheme()
  return (
    <SafeAreaProvider>
      <PaperProvider theme={scheme === 'dark' ? darkTheme : lightTheme}>
        <StoreProvider>
          <Root />
        </StoreProvider>
        <StatusBar style="auto" />
      </PaperProvider>
    </SafeAreaProvider>
  )
}
