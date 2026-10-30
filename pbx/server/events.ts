/**
 * Anruf-Ereignisse für Webhooks und Hausautomation: aus den AMI-Ereignissen von
 * Asterisk (DialBegin, DialEnd, Hangup, MessageWaiting) wird ein einfaches Modell –
 * „klingelt bei 10“, „angenommen von 10“, „beendet“, „verpasst“, „neue Voicemail“.
 */

import { createHmac } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { AmiMessage } from './ami'
import type { PbxConfig, Webhook, WebhookEvent } from './model'

export interface CallEventData {
  /** Kennung des Gesprächs (Linkedid), gleich für alle Ereignisse eines Anrufs */
  call: string
  direction: 'in' | 'out' | 'internal'
  /** Anrufer: Rufnummer (extern) oder Nebenstelle */
  from: string
  from_name: string
  /** Gewählte Rufnummer (nur nach außen) */
  to?: string
  /** Nebenstelle, bei der es klingelt bzw. die angenommen hat */
  extension?: string
  /** Bei beendeten Anrufen: angenommen, von wem, Dauer in Sekunden */
  answered?: boolean
  answered_by?: string
  duration?: number
}

export interface PbxEvent {
  event: WebhookEvent
  time: string
  data: Record<string, unknown>
}

interface Call {
  id: string
  direction: CallEventData['direction']
  from: string
  fromName: string
  start: number
  answered: string
  answeredAt: number
  ringing: Set<string>
  /** Nach außen gewählte Nummer */
  to: string
  /** Gruppen, die der Anruf durchlaufen hat (UserEvent P4AGroup aus dem Wählplan) */
  groups: Set<string>
}

/** Verpasster Anruf, der über Gruppen lief (für die gemeinsame Liste) */
export interface GroupMissedCall {
  call: string
  groups: string[]
  from: string
  from_name: string
}

function clean(v: string | undefined): string {
  const s = (v ?? '').trim()
  return s === '<unknown>' || s === '<Unknown>' ? '' : s
}

/** „PJSIP/10-00000003“, „PJSIP/10-app-0000000a“ → „10“; SIP-Konten und Local-Kanäle → '' */
export function extOfChannel(channel: string): string {
  return /^PJSIP\/(\d+)(?:-app|-video)?-[0-9a-f]+$/.exec(channel ?? '')?.[1] ?? ''
}

const isTrunkChannel = (channel: string): boolean => /^PJSIP\/trunk-/.test(channel ?? '')

/** Ereignisse: 'event' (PbxEvent), 'group-missed' (GroupMissedCall) */
export class CallTracker extends EventEmitter {
  private calls = new Map<string, Call>()
  private mailboxes = new Map<string, number>()

  constructor(private now: () => number = Date.now) {
    super()
  }

  private publish(event: WebhookEvent, data: Record<string, unknown>): void {
    this.emit('event', { event, time: new Date(this.now()).toISOString(), data } satisfies PbxEvent)
  }

  private callData(c: Call): CallEventData {
    return { call: c.id, direction: c.direction, from: c.from, from_name: c.fromName, ...(c.to ? { to: c.to } : {}) }
  }

  onAmi(e: AmiMessage): void {
    switch (e.Event) {
      case 'Newchannel': {
        // Nur der erste Kanal eines Gesprächs (Uniqueid = Linkedid) legt den Anruf an
        if (!e.Uniqueid || e.Uniqueid !== e.Linkedid || this.calls.has(e.Linkedid)) return
        const ext = extOfChannel(e.Channel)
        if (!ext && !isTrunkChannel(e.Channel)) return
        this.calls.set(e.Linkedid, {
          id: e.Linkedid,
          direction: ext ? 'internal' : 'in',
          from: ext || clean(e.CallerIDNum),
          fromName: clean(e.CallerIDName),
          start: this.now(),
          answered: '',
          answeredAt: 0,
          ringing: new Set(),
          to: '',
          groups: new Set(),
        })
        return
      }
      case 'DialBegin': {
        const c = this.calls.get(e.Linkedid ?? '')
        if (!c) return
        // Eingehend hat der Wählplan Nummer und Namen inzwischen aufbereitet
        if (c.direction === 'in') {
          c.from = clean(e.CallerIDNum) || c.from
          c.fromName = clean(e.CallerIDName) || c.fromName
        }
        if (isTrunkChannel(e.DestChannel)) {
          if (c.direction === 'internal') c.direction = 'out'
          // DialString „030123456@trunk-x“
          if (c.direction === 'out' && !c.to) c.to = /^([^@]+)@/.exec(e.DialString ?? '')?.[1] ?? ''
          return
        }
        const ext = extOfChannel(e.DestChannel)
        if (!ext || c.ringing.has(ext) || ext === c.from) return
        c.ringing.add(ext)
        this.publish('call.ringing', { ...this.callData(c), extension: ext })
        return
      }
      case 'DialEnd': {
        const c = this.calls.get(e.Linkedid ?? '')
        if (!c || e.DialStatus !== 'ANSWER' || c.answered) return
        c.answered = extOfChannel(e.DestChannel) || (isTrunkChannel(e.DestChannel) ? 'extern' : '')
        c.answeredAt = this.now()
        this.publish('call.answered', { ...this.callData(c), extension: c.answered })
        return
      }
      case 'Hangup': {
        if (!e.Uniqueid || e.Uniqueid !== e.Linkedid) return
        const c = this.calls.get(e.Linkedid)
        if (!c) return
        this.calls.delete(c.id)
        const duration = c.answeredAt ? Math.round((this.now() - c.answeredAt) / 1000) : 0
        this.publish('call.ended', { ...this.callData(c), answered: Boolean(c.answered), answered_by: c.answered, duration })
        if (c.direction === 'in' && !c.answered) {
          this.publish('call.missed', { ...this.callData(c), extensions: [...c.ringing] })
          if (c.groups.size) this.emit('group-missed', { call: c.id, groups: [...c.groups], from: c.from, from_name: c.fromName } satisfies GroupMissedCall)
        }
        return
      }
      case 'UserEvent': {
        if (e.UserEvent !== 'P4AGroup') return
        const c = this.calls.get(e.Linkedid ?? '')
        if (c && e.Group) c.groups.add(e.Group)
        return
      }
      case 'MessageWaiting': {
        // Mailbox: 10@default, New: Anzahl neuer Nachrichten
        const box = /^(\d+)@/.exec(e.Mailbox ?? '')?.[1]
        if (!box) return
        const count = Number(e.New) || 0
        const before = this.mailboxes.get(box)
        this.mailboxes.set(box, count)
        if (before !== undefined && count > before) this.publish('voicemail.new', { extension: box, new: count })
        return
      }
    }
  }

  /** Verbindung zu Asterisk verloren: laufende Anrufe vergessen */
  reset(): void {
    this.calls.clear()
  }

  /** Bekannter Stand der Mailboxen (damit der erste MessageWaiting nach dem Start nicht als neu zählt) */
  setMailbox(box: string, count: number): void {
    this.mailboxes.set(box, count)
  }

  /** Ereignis von außerhalb des AMI (Notruf, Sperre) */
  report(event: WebhookEvent, data: Record<string, unknown>): void {
    this.publish(event, data)
  }
}

/** Signatur wie bei GitHub: „sha256=<hex>“ über den unveränderten Body */
export function signature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

export interface WebhookStatus {
  /** Letzte Zustellung (ms) */
  time: number
  ok: boolean
  /** HTTP-Status oder Fehlertext */
  result: string
}

/** Verschickt Ereignisse an die eingetragenen Webhooks (ohne Wiederholung, 5 s Zeitlimit) */
export class Webhooks {
  status = new Map<string, WebhookStatus>()

  constructor(
    private config: () => PbxConfig,
    private send: typeof fetch = fetch,
  ) {}

  targets(event: WebhookEvent): Webhook[] {
    return this.config().webhooks.filter((w) => w.enabled && w.url && (!w.events.length || w.events.includes(event)))
  }

  dispatch(e: PbxEvent): Promise<void>[] {
    const body = JSON.stringify({ ...e, pbx: this.config().system.name })
    return this.targets(e.event).map((w) => this.deliver(w, e.event, body))
  }

  async deliver(w: Webhook, event: string, body: string): Promise<void> {
    try {
      const r = await this.send(w.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Phone4all-PBX',
          'X-Phone4all-Event': event,
          'X-Phone4all-Signature': signature(w.secret, body),
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      })
      this.status.set(w.id, { time: Date.now(), ok: r.ok, result: `HTTP ${r.status}` })
    } catch (err) {
      this.status.set(w.id, { time: Date.now(), ok: false, result: (err as Error).message })
    }
  }
}
