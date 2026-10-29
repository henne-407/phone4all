/**
 * Fax per E-Mail: Asterisk empfängt Faxe (ReceiveFAX, spandsp) als TIFF, die Anlage macht
 * daraus ein PDF und schickt es per E-Mail. Gesendet wird aus einem PDF, das Ghostscript in
 * ein Fax-TIFF umwandelt; Asterisk wählt über ein SIP-Konto und sendet es (SendFAX).
 * Die Liste der Faxe (ein- und ausgehend, 30 Tage) liegt in data/fax/faxes.json,
 * die PDFs daneben.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { loadJson, saveJson } from './files'
import type { FaxBox, PbxConfig } from './model'
import { routeOutbound, sameNumber } from './routing'
import { newId, safeList } from './store'

export type FaxStatus = 'queued' | 'sending' | 'ok' | 'failed'

export interface FaxRecord {
  id: string
  box: string
  direction: 'in' | 'out'
  /** ms */
  time: number
  /** Gegenstelle: Rufnummer */
  number: string
  /** Gegenstelle: Faxkennung */
  station: string
  pages: number
  status: FaxStatus
  error: string
  /** Wer gesendet hat (Nebenstelle oder „Verwaltung“) */
  by: string
  attempts: number
}

export class FaxError extends Error {}

const KEEP_DAYS = 30
const MAX_ATTEMPTS = 3
const RETRY_MS = 2 * 60000

/** Fehlertexte von spandsp/res_fax auf Deutsch */
export function faxErrorText(status: string, error: string): string {
  const e = error.toUpperCase()
  if (status === 'SUCCESS') return ''
  if (/NO_ANSWER|NOANSWER/.test(e)) return 'Keine Antwort'
  if (/BUSY/.test(e)) return 'Besetzt'
  if (/T30_ERR_RX|T30_ERR_TX|NEGOTIATE|NO_RESPONSE|HDLC|T30/.test(e)) return 'Die Gegenstelle antwortet nicht als Faxgerät'
  if (/HANGUP|CALL_DROPPED|DISCONNECTED/.test(e)) return 'Verbindung abgebrochen'
  if (/FILE|IMAGE|TIFF/.test(e)) return 'Datei konnte nicht verarbeitet werden'
  return error || status || 'Unbekannter Fehler'
}

function run(cmd: string, args: string[], timeout = 120000): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout }, (err, _out, stderr) => (err ? reject(new FaxError(`${path.basename(cmd)}: ${String(stderr).trim().split('\n').pop() || err.message}`)) : resolve())),
  )
}

/** Empfangenes Fax-TIFF → PDF */
export function tiffToPdf(tif: string, pdf: string): Promise<void> {
  return run('tiff2pdf', ['-o', pdf, '-p', 'A4', '-F', tif])
}

/** PDF → Fax-TIFF (Feinauflösung, 1728 Bildpunkte breit wie bei Faxgeräten üblich) */
export async function pdfToTiff(pdf: string, tif: string): Promise<void> {
  await run('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=tiffg4', '-r204x196', '-g1728x2292', '-dFIXEDMEDIA', '-dPDFFitPage', `-sOutputFile=${tif}`, pdf])
}

/** Seiten eines TIFF zählen (Bilddateiverzeichnisse) – genügt für die Anzeige vor dem Senden */
export function tiffPages(file: string): number {
  try {
    const b = fs.readFileSync(file)
    const le = b.toString('ascii', 0, 2) === 'II'
    const u16 = (o: number): number => (le ? b.readUInt16LE(o) : b.readUInt16BE(o))
    const u32 = (o: number): number => (le ? b.readUInt32LE(o) : b.readUInt32BE(o))
    let pages = 0
    for (let off = u32(4); off > 0 && off + 2 <= b.length && pages < 1000; pages++) off = u32(off + 2 + u16(off) * 12)
    return pages
  } catch {
    return 0
  }
}

/** Ziel für SendFAX: erste passende Leitung (Endpunkt, Nummer, Absender) wie bei Umleitungen nach außen */
export function faxRoute(cfg: PbxConfig, box: FaxBox, number: string): { endpoint: string; number: string; cid: string }[] {
  const reply = routeOutbound(cfg, { ext: '', fwd: 'flow', num: number, cid: '' })
  const parts = reply.split('|')
  if (parts[0] !== 'ok') return []
  const legs: { endpoint: string; number: string; cid: string }[] = []
  for (let i = 1; i + 1 < parts.length; i += 3) if (parts[i]) legs.push({ endpoint: parts[i], number: parts[i + 1], cid: parts[i + 2] ?? '' })
  if (!box.cid) return legs
  // Eigene Absendernummer: das Konto zuerst nehmen, zu dem sie gehört (nur dort darf sie angezeigt werden)
  const owner = cfg.trunks.find((t) => t.numbers.some((n) => sameNumber(n, box.cid, cfg)))
  const own = legs.filter((l) => owner && l.endpoint === `trunk-${owner.id}`).map((l) => ({ ...l, cid: box.cid }))
  return [...own, ...legs.filter((l) => !own.some((o) => o.endpoint === l.endpoint))]
}

export class FaxStore {
  private records: FaxRecord[]

  constructor(private dir: string) {
    this.records = loadJson<FaxRecord[]>(path.join(dir, 'faxes.json'), [])
    // Was beim Neustart noch lief, ist verloren
    for (const r of this.records) {
      if (r.status === 'sending' || r.status === 'queued') {
        r.status = 'failed'
        r.error = 'Neustart der Anlage während des Sendens'
      }
    }
  }

  private save(): void {
    saveJson(path.join(this.dir, 'faxes.json'), this.records)
  }

  pdf(id: string): string {
    return path.join(this.dir, `${id.replace(/[^\w-]/g, '')}.pdf`)
  }

  tif(id: string): string {
    return path.join(this.dir, `${id.replace(/[^\w-]/g, '')}.tif`)
  }

  list(boxes?: Set<string>): FaxRecord[] {
    return this.records.filter((r) => !boxes || boxes.has(r.box)).sort((a, b) => b.time - a.time)
  }

  get(id: string): FaxRecord | null {
    return this.records.find((r) => r.id === id) ?? null
  }

  add(r: Omit<FaxRecord, 'id'>): FaxRecord {
    const rec = { id: newId(), ...r }
    this.records.push(rec)
    this.save()
    return rec
  }

  update(id: string, patch: Partial<FaxRecord>): FaxRecord | null {
    const r = this.get(id)
    if (!r) return null
    Object.assign(r, patch)
    this.save()
    return r
  }

  remove(id: string): void {
    this.records = this.records.filter((r) => r.id !== id)
    fs.rmSync(this.pdf(id), { force: true })
    fs.rmSync(this.tif(id), { force: true })
    this.save()
  }

  /** Alte Faxe und Dateien ohne Eintrag entfernen */
  prune(now = Date.now()): void {
    const keep = now - KEEP_DAYS * 86400000
    const old = this.records.filter((r) => r.time < keep && r.status !== 'sending' && r.status !== 'queued')
    for (const r of old) this.remove(r.id)
    const known = new Set(this.records.map((r) => r.id))
    for (const f of safeList(this.dir)) {
      const m = /^(x[0-9a-f]+)\.(pdf|tif)$/.exec(f)
      if (m && !known.has(m[1])) fs.rmSync(path.join(this.dir, f), { force: true })
    }
  }
}

export { MAX_ATTEMPTS, RETRY_MS }
