/**
 * Voicemail für die Apps: Nachrichten einer Nebenstelle auflisten, abspielen, als
 * gehört markieren und löschen. Gelesen wird direkt aus dem Spool von Asterisk,
 * verschoben und gelöscht über das AMI (VoicemailMove/VoicemailRemove), damit
 * Asterisk die Nummerierung und die Anzeige an den Telefonen (MWI) richtig führt.
 */

import fs from 'node:fs'
import path from 'node:path'
import { safeList } from './store'

export type VoicemailFolder = 'INBOX' | 'Old'

export interface VoicemailMessage {
  /** msg_id von Asterisk, bleibt beim Verschieben gleich */
  id: string
  folder: VoicemailFolder
  /** Neu (noch nicht gehört) */
  unread: boolean
  /** Unix-Zeit in ms */
  time: number
  number: string
  name: string
  /** Sekunden */
  duration: number
}

/** Inhalt einer msgNNNN.txt ([message]-Abschnitt) */
export function parseInfo(text: string): Record<string, string> {
  const info: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^([a-z_]+)=(.*)$/.exec(line.trim())
    if (m) info[m[1]] = m[2]
  }
  return info
}

/** callerid="Anna Müller" <0301234> → Name und Nummer */
export function parseCallerId(raw: string): { name: string; number: string } {
  const m = /^"?(.*?)"?\s*<([^>]*)>$/.exec(raw.trim())
  if (m) return { name: m[1].trim(), number: m[2].trim() }
  return { name: '', number: raw.trim() }
}

export class VoicemailBox {
  constructor(private spool: string) {}

  private dir(mailbox: string, folder: VoicemailFolder): string {
    return path.join(this.spool, 'voicemail', 'default', mailbox, folder)
  }

  list(mailbox: string): VoicemailMessage[] {
    if (!/^\d+$/.test(mailbox)) return []
    const result: VoicemailMessage[] = []
    for (const folder of ['INBOX', 'Old'] as const) {
      const dir = this.dir(mailbox, folder)
      for (const f of safeList(dir).filter((f) => /^msg\d{4}\.txt$/.test(f))) {
        let info: Record<string, string>
        try {
          info = parseInfo(fs.readFileSync(path.join(dir, f), 'utf8'))
        } catch {
          continue
        }
        const caller = parseCallerId(info.callerid ?? '')
        result.push({
          id: info.msg_id || `${folder}-${f}`,
          folder,
          unread: folder === 'INBOX',
          time: (Number(info.origtime) || 0) * 1000,
          number: caller.number === 'Unknown' ? '' : caller.number,
          name: caller.name,
          duration: Number(info.duration) || 0,
        })
      }
    }
    return result.sort((a, b) => b.time - a.time)
  }

  /** WAV-Datei (8 kHz PCM) einer Nachricht oder null */
  file(mailbox: string, id: string): string | null {
    for (const folder of ['INBOX', 'Old'] as const) {
      const dir = this.dir(mailbox, folder)
      for (const f of safeList(dir).filter((f) => /^msg\d{4}\.txt$/.test(f))) {
        try {
          if (parseInfo(fs.readFileSync(path.join(dir, f), 'utf8')).msg_id !== id) continue
        } catch {
          continue
        }
        const wav = path.join(dir, f.replace(/\.txt$/, '.wav'))
        return fs.existsSync(wav) ? wav : null
      }
    }
    return null
  }

  find(mailbox: string, id: string): VoicemailMessage | null {
    return this.list(mailbox).find((m) => m.id === id) ?? null
  }

  /** Kennzeichen für Änderungen (neue, gehörte, gelöschte Nachrichten), ohne die Nachrichten zu lesen */
  revision(mailbox: string): string {
    if (!/^\d+$/.test(mailbox)) return ''
    return (['INBOX', 'Old'] as const)
      .map((folder) => {
        try {
          const dir = this.dir(mailbox, folder)
          return `${fs.statSync(dir).mtimeMs.toFixed(0)}.${safeList(dir).length}`
        } catch {
          return '0'
        }
      })
      .join('-')
  }

  /** Anzahl neuer Nachrichten */
  unread(mailbox: string): number {
    return /^\d+$/.test(mailbox) ? safeList(this.dir(mailbox, 'INBOX')).filter((f) => /^msg\d{4}\.txt$/.test(f)).length : 0
  }
}
