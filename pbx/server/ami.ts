/** Minimaler Client für das Asterisk Manager Interface (AMI). */

import { EventEmitter } from 'node:events'
import net from 'node:net'

export type AmiMessage = Record<string, string>

interface Pending {
  resolve: (msgs: AmiMessage[]) => void
  reject: (e: Error) => void
  messages: AmiMessage[]
  list: boolean
  timer: NodeJS.Timeout
}

export function parseMessage(block: string): AmiMessage {
  const msg: AmiMessage = {}
  for (const line of block.split('\r\n')) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    const key = line.slice(0, i).trim()
    const value = line.slice(i + 1).trim()
    msg[key] = key in msg ? `${msg[key]}\n${value}` : value
  }
  return msg
}

/** Ereignisse: 'event' (AmiMessage), 'connected', 'disconnected'. */
export class Ami extends EventEmitter {
  private sock: net.Socket | null = null
  private buffer = ''
  private seq = 0
  private pending = new Map<string, Pending>()
  connected = false

  async connect(port: number, user: string, secret: string): Promise<void> {
    this.close()
    const sock = net.connect({ host: '127.0.0.1', port })
    this.sock = sock
    sock.setEncoding('utf8')
    await new Promise<void>((resolve, reject) => {
      sock.once('connect', resolve)
      sock.once('error', reject)
    })
    sock.on('data', (chunk: string) => this.onData(chunk))
    sock.on('error', () => undefined)
    sock.on('close', () => {
      if (this.sock !== sock) return
      this.sock = null
      this.connected = false
      for (const p of this.pending.values()) {
        clearTimeout(p.timer)
        p.reject(new Error('AMI-Verbindung getrennt'))
      }
      this.pending.clear()
      this.emit('disconnected')
    })
    const [res] = await this.action({ Action: 'Login', Username: user, Secret: secret, Events: 'on' })
    if (res?.Response !== 'Success') {
      this.close()
      throw new Error(`AMI-Anmeldung fehlgeschlagen: ${res?.Message ?? ''}`)
    }
    this.connected = true
    this.emit('connected')
  }

  close(): void {
    const sock = this.sock
    this.sock = null
    this.connected = false
    sock?.destroy()
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    // Begrüßungszeile „Asterisk Call Manager/…“ hat kein Leerzeilen-Ende
    if (this.buffer.startsWith('Asterisk Call Manager')) {
      const nl = this.buffer.indexOf('\r\n')
      if (nl < 0) return
      this.buffer = this.buffer.slice(nl + 2)
    }
    let end: number
    while ((end = this.buffer.indexOf('\r\n\r\n')) >= 0) {
      const block = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 4)
      if (block.trim()) this.dispatch(parseMessage(block))
    }
  }

  private dispatch(msg: AmiMessage): void {
    const id = msg.ActionID
    const p = id ? this.pending.get(id) : undefined
    if (!p) {
      if (msg.Event) this.emit('event', msg)
      return
    }
    if (msg.Response) {
      p.messages.push(msg)
      p.list = msg.EventList === 'start' || /will follow/i.test(msg.Message ?? '')
      if (!p.list || msg.Response !== 'Success') this.finish(id!)
      return
    }
    if (msg.EventList === 'Complete') {
      this.finish(id!)
      return
    }
    p.messages.push(msg)
  }

  private finish(id: string): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    clearTimeout(p.timer)
    p.resolve(p.messages)
  }

  /** Antwort plus (bei Listen) alle Listen-Ereignisse. */
  action(fields: Record<string, string>, timeout = 10000): Promise<AmiMessage[]> {
    const sock = this.sock
    if (!sock) return Promise.reject(new Error('Asterisk ist nicht verbunden'))
    const id = `p4a-${++this.seq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Zeitüberschreitung bei ${fields.Action}`))
      }, timeout)
      this.pending.set(id, { resolve, reject, messages: [], list: false, timer })
      const lines = Object.entries({ ...fields, ActionID: id }).map(([k, v]) => `${k}: ${v.replace(/[\r\n]/g, ' ')}`)
      sock.write(lines.join('\r\n') + '\r\n\r\n')
    })
  }

  /** Listen-Ereignisse ohne die einleitende Antwort. */
  async list(fields: Record<string, string>): Promise<AmiMessage[]> {
    const msgs = await this.action(fields)
    return msgs.filter((m) => m.Event)
  }

  async command(cmd: string): Promise<string> {
    const [res] = await this.action({ Action: 'Command', Command: cmd })
    return res?.Output ?? res?.Message ?? ''
  }
}
