/** Vordergrunddienst (nur Android): hält die Verbindung zur Anlage im Hintergrund. */

import { requireOptionalNativeModule } from 'expo'

interface CallServiceModule {
  start(title: string, text: string): void
  stop(): void
  isIgnoringBatteryOptimizations(): boolean
  requestIgnoreBatteryOptimizations(): void
}

const native = requireOptionalNativeModule<CallServiceModule>('CallService')

export const available = Boolean(native)

export function startService(title: string, text: string): void {
  try {
    native?.start(title, text)
  } catch (e) {
    console.warn('Hintergrunddienst:', (e as Error).message)
  }
}

export function stopService(): void {
  native?.stop()
}

export function needsBatteryException(): boolean {
  return native ? !native.isIgnoringBatteryOptimizations() : false
}

export function requestBatteryException(): void {
  native?.requestIgnoreBatteryOptimizations()
}
