/**
 * Ablage auf dem Gerät: Passwort und Einrichtungslink (der Token ist eine Berechtigung)
 * im sicheren Speicher (Schlüsselbund / Keystore), alles andere in AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import type { Profile } from './provisioning'

const PROFILE = 'profile'
const SECRET = 'zugang'
const HISTORY = 'verlauf'
const SETTINGS = 'einstellungen'

export interface HistoryEntry {
  id: string
  number: string
  name: string
  direction: 'in' | 'out'
  /** Beginn (ms) */
  time: number
  /** Gesprächsdauer in Sekunden, 0 = nicht zustande gekommen */
  duration: number
  missed: boolean
}

export interface Settings {
  /** Android: im Hintergrund erreichbar bleiben (Dienst mit Benachrichtigung) */
  background: boolean
  /** Kontakte des Geräts zeigen und für Anrufernamen nutzen */
  deviceContacts: boolean
  /** Favoriten (Rufnummern) */
  favorites: string[]
}

export const DEFAULT_SETTINGS: Settings = { background: true, deviceContacts: false, favorites: [] }

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export async function loadProfile(): Promise<Profile | null> {
  const rest = await readJson<Omit<Profile, 'password' | 'url'> | null>(PROFILE, null)
  const secret = await SecureStore.getItemAsync(SECRET)
  if (!rest || !secret) return null
  const { password, url } = JSON.parse(secret) as { password: string; url: string }
  return { ...rest, password, url } as Profile
}

export async function saveProfile(p: Profile): Promise<void> {
  const { password, url, ...rest } = p
  await SecureStore.setItemAsync(SECRET, JSON.stringify({ password, url }), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  })
  await AsyncStorage.setItem(PROFILE, JSON.stringify(rest))
}

export async function clearProfile(): Promise<void> {
  await SecureStore.deleteItemAsync(SECRET)
  await AsyncStorage.multiRemove([PROFILE, HISTORY])
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  return readJson<HistoryEntry[]>(HISTORY, [])
}

export async function saveHistory(list: HistoryEntry[]): Promise<void> {
  await AsyncStorage.setItem(HISTORY, JSON.stringify(list.slice(0, 300)))
}

export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await readJson<Partial<Settings>>(SETTINGS, {})) }
}

export async function saveSettings(s: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS, JSON.stringify(s))
}
