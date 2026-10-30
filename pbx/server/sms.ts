/**
 * SMS senden und empfangen. Anbieter: sipgate (REST) oder eine beliebige HTTP-Schnittstelle
 * mit Vorlage. Eingehende SMS kommen per Webhook an /sms/<schlüssel> und landen im
 * Messenger bei allen Nebenstellen mit dem Recht „SMS“.
 */

import type { SmsSettings } from './model'
import { toE164 } from './numbers'

export class SmsError extends Error {}

export const MAX_SMS = 1530

export interface SmsMessage {
  to: string
  text: string
}

/** Rufnummer für den Versand: international mit + */
export function smsNumber(raw: string, country: string, area = ''): string {
  const n = toE164(raw, country, area)
  if (!/^\+[1-9]\d{6,15}$/.test(n)) throw new SmsError(`Keine gültige Handynummer: ${raw}`)
  return n
}

/** Platzhalter {to}, {text}, {from} einsetzen: JSON-sicher, wenn die Vorlage JSON ist, sonst als Formularwert */
export function fillTemplate(template: string, values: Record<string, string>): { body: string; type: string } {
  const json = template.trim().startsWith('{')
  const body = template.replace(/\{(to|text|from)\}/g, (_, k: string) => {
    const v = values[k] ?? ''
    return json ? JSON.stringify(v).slice(1, -1) : encodeURIComponent(v)
  })
  return { body, type: json ? 'application/json' : 'application/x-www-form-urlencoded' }
}

export async function sendSms(s: SmsSettings, msg: SmsMessage): Promise<void> {
  if (!s.enabled) throw new SmsError('SMS ist nicht eingerichtet.')
  const text = msg.text.trim()
  if (!text) throw new SmsError('Leere Nachricht.')
  if (text.length > MAX_SMS) throw new SmsError(`Höchstens ${MAX_SMS} Zeichen.`)
  let r: Response
  try {
    if (s.provider === 'sipgate') {
      r = await fetch('https://api.sipgate.com/v2/sessions/sms', {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${s.user}:${s.password}`).toString('base64'),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ smsId: s.sender.trim(), recipient: msg.to, message: text }),
        signal: AbortSignal.timeout(20000),
      })
    } else {
      const { body, type } = fillTemplate(s.body || '{"to":"{to}","text":"{text}","from":"{from}"}', { to: msg.to, text, from: s.sender })
      const headers: Record<string, string> = { 'Content-Type': type, 'User-Agent': 'Phone4All' }
      if (s.user) headers.Authorization = 'Basic ' + Buffer.from(`${s.user}:${s.password}`).toString('base64')
      r = await fetch(s.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(20000) })
    }
  } catch (e) {
    throw new SmsError(`Anbieter nicht erreichbar: ${(e as Error).message}`)
  }
  if (r.status === 401 || r.status === 403) throw new SmsError('Anmeldung beim SMS-Anbieter fehlgeschlagen (Token prüfen)')
  if (!r.ok) {
    const detail = (await r.text().catch(() => '')).slice(0, 200)
    throw new SmsError(`SMS-Anbieter meldet Fehler ${r.status}${detail ? `: ${detail}` : ''}`)
  }
}

/** Eingehende SMS aus JSON oder Formular lesen; übliche Feldnamen verschiedener Anbieter */
export function parseInbound(body: Record<string, unknown>): { from: string; text: string } | null {
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = body[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
      if (typeof v === 'number') return String(v)
    }
    return ''
  }
  const from = pick('from', 'sender', 'msisdn', 'originator', 'number', 'From')
  const text = pick('text', 'message', 'body', 'content', 'Body')
  if (!from || !text) return null
  return { from: from.replace(/[^\d+]/g, ''), text: text.slice(0, MAX_SMS) }
}
