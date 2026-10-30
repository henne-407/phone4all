/**
 * Änderungsprotokoll der Weboberfläche: wer (Adresse) wann was geändert hat.
 * Eine JSON-Zeile je Eintrag; ab 1 MB wird die Datei einmal umbenannt (audit.1.jsonl).
 */

import fs from 'node:fs'
import path from 'node:path'

export interface AuditEntry {
  time: number
  ip: string
  action: string
  /** Zugang der Weboberfläche (ältere Einträge ohne) */
  user?: string
}

const MAX_BYTES = 1024 * 1024
const VERBS: Record<string, string> = { POST: 'Gespeichert', PUT: 'Geändert', DELETE: 'Gelöscht' }
const SPECIAL: Record<string, string> = {
  '/api/export': 'Export mit Passwörtern (verschlüsselt)',
  '/api/import': 'Konfiguration importiert',
}

/** Lesbarer Text zu einer Änderung über die Schnittstelle */
export function auditText(method: string, urlPath: string, result: unknown): string {
  if (SPECIAL[urlPath]) return SPECIAL[urlPath]
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>
  const label = [r.number, r.name].filter((v) => typeof v === 'string' && v).join(' ')
  return `${VERBS[method] ?? method}: ${urlPath}${label ? ` (${label.slice(0, 80)})` : ''}`
}

export class AuditLog {
  constructor(private file: string) {}

  add(ip: string, action: string, now = Date.now(), user?: string): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > MAX_BYTES) {
        fs.renameSync(this.file, this.file.replace(/\.jsonl$/, '.1.jsonl'))
      }
      fs.appendFileSync(this.file, JSON.stringify({ time: now, ip, action, ...(user ? { user } : {}) } satisfies AuditEntry) + '\n', { mode: 0o600 })
    } catch (e) {
      console.error('Änderungsprotokoll nicht schreibbar:', (e as Error).message)
    }
  }

  /** Neueste zuerst */
  list(limit = 200): AuditEntry[] {
    try {
      return fs
        .readFileSync(this.file, 'utf8')
        .trim()
        .split('\n')
        .slice(-limit)
        .reverse()
        .flatMap((l) => {
          try {
            return [JSON.parse(l) as AuditEntry]
          } catch {
            return []
          }
        })
    } catch {
      return []
    }
  }
}
