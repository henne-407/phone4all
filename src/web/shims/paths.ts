/** Ersatz für src/main/paths.ts: „Verzeichnisse“ sind nur Namensteile der Schlüssel im Browser-Speicher. */

export const DIRS = { config: 'config', data: 'data', state: 'state', runtime: 'runtime' }
export const RINGTONE_DIR = 'data/ringtones'

export function resourcePath(...parts: string[]): string {
  return parts.join('/')
}
