/** Ersatz für src/main/files.ts: JSON-Dateien liegen im Speicher des Browsers (localStorage). */

const PREFIX = 'phone4all:'

export function loadJson<T>(file: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + file)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function saveJson(file: string, data: unknown): void {
  try {
    localStorage.setItem(PREFIX + file, JSON.stringify(data))
  } catch (e) {
    console.error('Speichern im Browser fehlgeschlagen:', file, e)
  }
}

/** Alles löschen, was der Web-Client abgelegt hat (Abmelden) */
export function clearAll(): void {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key)
  } catch {
    // Speicher gesperrt
  }
}

export function isExecutable(): boolean {
  return false
}

export function safeFileName(name: string): string {
  return String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || 'Datei'
}

export function writeDownload(): void {
  throw new Error('Kein Dateisystem im Browser')
}
