/**
 * Ablageorte. Unter Linux bleiben die XDG-Pfade der früheren GTK-Version
 * (~/.config/sip-telefon, ~/.local/share/sip-telefon …), damit Einstellungen,
 * Kontakte und Verlauf übernommen werden. macOS/Windows nutzen den
 * Benutzerordner der App.
 */

import { app } from 'electron'
import os from 'node:os'
import path from 'node:path'

const APP_DIR = 'sip-telefon'

function xdg(env: string, fallback: string): string {
  return path.join(process.env[env] || path.join(os.homedir(), fallback), APP_DIR)
}

function base(): Record<'config' | 'data' | 'state' | 'runtime', string> {
  if (process.platform === 'linux') {
    const runtime = process.env.XDG_RUNTIME_DIR
      ? path.join(process.env.XDG_RUNTIME_DIR, APP_DIR)
      : path.join(os.tmpdir(), `${APP_DIR}-${process.getuid?.() ?? 'user'}`)
    return {
      config: xdg('XDG_CONFIG_HOME', '.config'),
      data: xdg('XDG_DATA_HOME', '.local/share'),
      state: xdg('XDG_STATE_HOME', '.local/state'),
      runtime,
    }
  }
  const root = app.getPath('userData')
  return {
    config: root,
    data: path.join(root, 'data'),
    state: path.join(root, 'logs'),
    runtime: path.join(root, 'runtime'),
  }
}

export const DIRS = base()
export const RINGTONE_DIR = path.join(DIRS.data, 'ringtones')

/** Mitgelieferte Dateien (baresip für macOS/Windows, EDS-Helfer, Symbole). */
export function resourcePath(...parts: string[]): string {
  const root = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources')
  return path.join(root, ...parts)
}
