/** Material Design 3 in den Farben der Telefonanlage */

import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper'

export const lightTheme: MD3Theme = {
  ...MD3LightTheme,
  colors: { ...MD3LightTheme.colors, primary: '#6750a4' },
}

export const darkTheme: MD3Theme = {
  ...MD3DarkTheme,
  colors: { ...MD3DarkTheme.colors, primary: '#d0bcff' },
}

/** Farben für Anrufstatus */
export const CALL_GREEN = '#1b873f'
export const CALL_RED = '#c62828'
