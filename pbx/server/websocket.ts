/**
 * Schlanker WebSocket-Server (RFC 6455) ohne Abhängigkeiten, für den Messenger.
 * Unterstützt Textnachrichten, Ping/Pong und geordnetes Schließen; keine Erweiterungen.
 */

import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type http from 'node:http'
import type { Duplex } from 'node:stream'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
/** Größte erlaubte Nachricht (Dateien laufen über HTTP, nicht über den WebSocket) */
const MAX_MESSAGE = 256 * 1024

export function acceptKey(key: string): string {
  return createHash('sha1').update(key + GUID).digest('base64')
}

/** Rahmen bauen (Server → Client, unmaskiert) */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length
  let header: Buffer
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len])
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payload])
}

export interface Frame {
  fin: boolean
  opcode: number
  payload: Buffer
}

/** Liest einen Rahmen vom Anfang des Puffers; null = unvollständig. Wirft bei Protokollfehlern. */
export function decodeFrame(buf: Buffer): { frame: Frame; rest: Buffer } | null {
  if (buf.length < 2) return null
  const fin = (buf[0] & 0x80) !== 0
  if (buf[0] & 0x70) throw new Error('Erweiterungen werden nicht unterstützt')
  const opcode = buf[0] & 0x0f
  const masked = (buf[1] & 0x80) !== 0
  let len = buf[1] & 0x7f
  let offset = 2
  if (len === 126) {
    if (buf.length < 4) return null
    len = buf.readUInt16BE(2)
    offset = 4
  } else if (len === 127) {
    if (buf.length < 10) return null
    const big = buf.readBigUInt64BE(2)
    if (big > BigInt(MAX_MESSAGE)) throw new Error('Nachricht zu groß')
    len = Number(big)
    offset = 10
  }
  if (len > MAX_MESSAGE) throw new Error('Nachricht zu groß')
  if (!masked) throw new Error('Rahmen vom Client ohne Maske')
  if (buf.length < offset + 4 + len) return null
  const mask = buf.subarray(offset, offset + 4)
  offset += 4
  const payload = Buffer.from(buf.subarray(offset, offset + len))
  for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]
  return { frame: { fin, opcode, payload }, rest: buf.subarray(offset + len) }
}

/** Eine WebSocket-Verbindung; Ereignisse: 'message' (string), 'close' */
export class WebSocketConnection extends EventEmitter {
  private buffer: Buffer = Buffer.alloc(0)
  private fragments: Buffer[] = []
  private alive = true
  private closed = false
  private pinger: NodeJS.Timeout

  constructor(private socket: Duplex) {
    super()
    socket.on('data', (chunk: Buffer) => this.onData(chunk))
    socket.on('close', () => this.finish())
    socket.on('error', () => this.finish())
    // Tote Verbindungen (Handy im Funkloch, Proxy ohne Abbau) nach spätestens einer Minute erkennen
    this.pinger = setInterval(() => {
      if (!this.alive) return this.terminate()
      this.alive = false
      this.write(0x9, Buffer.alloc(0))
    }, 30000)
    this.pinger.unref()
  }

  get open(): boolean {
    return !this.closed
  }

  send(text: string): void {
    this.write(0x1, Buffer.from(text, 'utf8'))
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason))
    payload.writeUInt16BE(code, 0)
    payload.write(reason, 2)
    this.write(0x8, payload)
    this.socket.end()
    this.finish()
  }

  terminate(): void {
    this.socket.destroy()
    this.finish()
  }

  private write(opcode: number, payload: Buffer): void {
    if (this.closed || this.socket.destroyed) return
    this.socket.write(encodeFrame(opcode, payload))
  }

  private finish(): void {
    if (this.closed) return
    this.closed = true
    clearInterval(this.pinger)
    this.emit('close')
  }

  private onData(chunk: Buffer): void {
    this.alive = true
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    try {
      for (;;) {
        const r = decodeFrame(this.buffer)
        if (!r) break
        this.buffer = r.rest
        this.onFrame(r.frame)
        if (this.closed) return
      }
    } catch {
      this.close(1002, 'Protokollfehler')
    }
  }

  private onFrame({ fin, opcode, payload }: Frame): void {
    switch (opcode) {
      case 0x0: // Fortsetzung
      case 0x1: // Text
      case 0x2: // Binär (wie Text behandelt)
        this.fragments.push(payload)
        if (this.fragments.reduce((n, b) => n + b.length, 0) > MAX_MESSAGE) throw new Error('Nachricht zu groß')
        if (fin) {
          const text = Buffer.concat(this.fragments).toString('utf8')
          this.fragments = []
          this.emit('message', text)
        }
        break
      case 0x8:
        this.close()
        break
      case 0x9:
        this.write(0xa, payload)
        break
      case 0xa:
        break
      default:
        throw new Error('Unbekannter Rahmentyp')
    }
  }
}

/** Handshake beantworten; null, wenn die Anfrage kein gültiger WebSocket-Aufbau ist. */
export function upgrade(req: http.IncomingMessage, socket: Duplex): WebSocketConnection | null {
  const key = req.headers['sec-websocket-key']
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || typeof key !== 'string' || !key) return null
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      '',
      '',
    ].join('\r\n'),
  )
  return new WebSocketConnection(socket)
}

/** Anfrage auf dem Upgrade-Weg ablehnen */
export function reject(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}
