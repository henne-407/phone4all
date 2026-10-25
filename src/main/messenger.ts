/**
 * Messenger: Verbindung zur Phone4all-Telefonanlage (WebSocket unter <Profil-URL>/chat).
 * Hält Unterhaltungen, Nutzer und Anwesenheit; Nachrichten lädt die Oberfläche seitenweise.
 * Dateien gehen per HTTP an <Profil-URL>/chat/files.
 */

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type { ChatFile, ChatMessage, ChatRoom, ChatUser, MessengerState } from '../shared/types'

/** Wie lange „schreibt gerade …“ angezeigt wird */
const TYPING_MS = 5000
const REQUEST_MS = 15000

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
}

export function mimeOf(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** Fehlermeldung aus einer JSON-Antwort der Anlage */
async function errorOf(r: Response): Promise<string> {
  try {
    return String(((await r.json()) as { error?: string }).error ?? '')
  } catch {
    return ''
  }
}

/** Nachrichten der Anlage */
type ServerMessage =
  | { t: 'init'; me: string; users: ChatUser[]; online: string[]; rooms: ChatRoom[] }
  | { t: 'users'; users: ChatUser[] }
  | { t: 'presence'; online: string[] }
  | { t: 'room'; room: ChatRoom; ref?: string }
  | { t: 'removed'; room: string }
  | { t: 'message'; message: ChatMessage; ref?: string }
  | { t: 'history'; room: string; messages: ChatMessage[]; complete: boolean }
  | { t: 'read'; room: string; ext: string; seq: number }
  | { t: 'typing'; room: string; ext: string }
  | { t: 'error'; text: string; ref?: string }

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export interface MessengerHost {
  /** Profil-Adresse der Anlage (…/provision/<token>), leer = nicht eingerichtet */
  url: () => string
  enabled: () => boolean
}

/** Ereignisse: 'changed' (Zustand), 'message' (neue Nachricht), 'reset' (Verlauf neu laden) */
export class Messenger extends EventEmitter {
  private ws: WebSocket | null = null
  private wsUrl = ''
  private retry: NodeJS.Timeout | null = null
  private delay = 2000
  private seq = 0
  private pending = new Map<string, Pending>()
  private history = new Map<string, Pending[]>()
  private typingTimers = new Map<string, NodeJS.Timeout>()
  readonly state: MessengerState = { status: 'off', me: '', users: [], online: [], rooms: [], typing: {} }

  constructor(private host: MessengerHost) {
    super()
  }

  get unread(): number {
    return this.state.rooms.reduce((n, r) => n + r.unread, 0)
  }

  private changed(): void {
    this.emit('changed')
  }

  /** Verbindung passend zur Einrichtung auf- oder abbauen (nach Profiländerungen aufrufen) */
  update(): void {
    const base = this.host.enabled() ? this.host.url() : ''
    const target = base ? `${base.replace(/^http/, 'ws')}/chat` : ''
    if (target === this.wsUrl && (this.ws || this.retry)) return
    this.disconnect()
    this.wsUrl = target
    if (!target) {
      Object.assign(this.state, { status: 'off', me: '', users: [], online: [], rooms: [], typing: {} })
      this.changed()
      return
    }
    this.connect()
  }

  /** Nach dem Ruhezustand oder Netzwechsel sofort neu verbinden */
  reconnect(): void {
    if (!this.wsUrl) return
    this.disconnect()
    this.delay = 2000
    this.connect()
  }

  private connect(): void {
    this.retry = null
    if (this.state.status !== 'online') {
      this.state.status = 'connecting'
      this.changed()
    }
    let ws: WebSocket
    try {
      ws = new WebSocket(this.wsUrl)
    } catch {
      this.scheduleRetry()
      return
    }
    this.ws = ws
    ws.addEventListener('message', (e) => {
      if (this.ws !== ws) return
      try {
        this.onMessage(JSON.parse(String(e.data)) as ServerMessage)
      } catch (err) {
        console.error('Messenger:', err)
      }
    })
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return
      this.ws = null
      this.failPending('Verbindung zur Telefonanlage unterbrochen')
      this.state.status = 'offline'
      this.state.online = []
      this.changed()
      this.scheduleRetry()
    })
    ws.addEventListener('error', () => {
      // close folgt
    })
  }

  private scheduleRetry(): void {
    if (this.retry || !this.wsUrl) return
    this.retry = setTimeout(() => this.connect(), this.delay)
    this.retry.unref()
    this.delay = Math.min(this.delay * 2, 60000)
  }

  private disconnect(): void {
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.failPending('Verbindung getrennt')
  }

  stop(): void {
    this.wsUrl = ''
    this.disconnect()
    this.state.status = 'off'
  }

  private failPending(text: string): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error(text))
    }
    this.pending.clear()
    for (const list of this.history.values()) {
      for (const p of list) {
        clearTimeout(p.timer)
        p.reject(new Error(text))
      }
    }
    this.history.clear()
  }

  private send(data: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('Keine Verbindung zur Telefonanlage')
    this.ws.send(JSON.stringify(data))
  }

  /** Anfrage mit Kennung; erfüllt durch die Antwort mit derselben ref */
  private request<T>(data: object): Promise<T> {
    const ref = String(++this.seq)
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(ref)
        reject(new Error('Die Telefonanlage antwortet nicht'))
      }, REQUEST_MS)
      this.pending.set(ref, { resolve: resolve as (v: unknown) => void, reject, timer })
      try {
        this.send({ ...data, ref })
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(ref)
        reject(e as Error)
      }
    })
  }

  private settle(ref: string | undefined, value: unknown, error?: string): void {
    const p = ref ? this.pending.get(ref) : undefined
    if (!p) return
    this.pending.delete(ref!)
    clearTimeout(p.timer)
    if (error) p.reject(new Error(error))
    else p.resolve(value)
  }

  private upsertRoom(room: ChatRoom): void {
    const i = this.state.rooms.findIndex((r) => r.id === room.id)
    if (i >= 0) this.state.rooms[i] = room
    else this.state.rooms.push(room)
  }

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case 'init':
        this.delay = 2000
        Object.assign(this.state, { status: 'online', me: m.me, users: m.users, online: m.online, rooms: m.rooms, typing: {} })
        // Nachrichten können während der Trennung gekommen sein
        this.emit('reset')
        break
      case 'users':
        this.state.users = m.users
        break
      case 'presence':
        this.state.online = m.online
        break
      case 'room':
        this.upsertRoom(m.room)
        this.settle(m.ref, m.room)
        break
      case 'removed':
        this.state.rooms = this.state.rooms.filter((r) => r.id !== m.room)
        break
      case 'message': {
        const room = this.state.rooms.find((r) => r.id === m.message.room)
        if (room && m.message.seq > room.seq) {
          room.seq = m.message.seq
          room.last = m.message
          if (m.message.from === this.state.me) room.read[this.state.me] = m.message.seq
          else if (m.message.from) room.unread++
        }
        this.clearTyping(m.message.room, m.message.from)
        this.settle(m.ref, m.message)
        this.emit('message', m.message)
        break
      }
      case 'history': {
        const waiting = this.history.get(m.room)?.shift()
        if (waiting) {
          clearTimeout(waiting.timer)
          waiting.resolve({ messages: m.messages, complete: m.complete })
        }
        return
      }
      case 'read': {
        const room = this.state.rooms.find((r) => r.id === m.room)
        if (!room) return
        room.read[m.ext] = m.seq
        if (m.ext === this.state.me) room.unread = 0
        break
      }
      case 'typing': {
        const list = this.state.typing[m.room] ?? []
        if (!list.includes(m.ext)) this.state.typing[m.room] = [...list, m.ext]
        const key = `${m.room}/${m.ext}`
        clearTimeout(this.typingTimers.get(key))
        this.typingTimers.set(
          key,
          setTimeout(() => {
            this.clearTyping(m.room, m.ext)
            this.changed()
          }, TYPING_MS),
        )
        break
      }
      case 'error':
        this.settle(m.ref, null, m.text)
        return
    }
    this.changed()
  }

  private clearTyping(room: string, ext: string): void {
    const list = this.state.typing[room]
    if (!list?.includes(ext)) return
    const rest = list.filter((e) => e !== ext)
    if (rest.length) this.state.typing[room] = rest
    else delete this.state.typing[room]
    clearTimeout(this.typingTimers.get(`${room}/${ext}`))
  }

  // -- Aufrufe aus der Oberfläche -------------------------------------------

  loadHistory(room: string, before?: number): Promise<{ messages: ChatMessage[]; complete: boolean }> {
    return new Promise((resolve, reject) => {
      const entry: Pending = {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer: setTimeout(() => {
          const list = this.history.get(room) ?? []
          this.history.set(
            room,
            list.filter((p) => p !== entry),
          )
          reject(new Error('Die Telefonanlage antwortet nicht'))
        }, REQUEST_MS),
      }
      try {
        this.send({ t: 'history', room, ...(before ? { before } : {}) })
        this.history.set(room, [...(this.history.get(room) ?? []), entry])
      } catch (e) {
        clearTimeout(entry.timer)
        reject(e as Error)
      }
    })
  }

  sendText(room: string, text: string): Promise<ChatMessage> {
    return this.request<ChatMessage>({ t: 'send', room, text })
  }

  openDirect(ext: string): Promise<ChatRoom> {
    return this.request<ChatRoom>({ t: 'direct', with: ext })
  }

  createGroup(name: string, members: string[]): Promise<ChatRoom> {
    return this.request<ChatRoom>({ t: 'group', name, members })
  }

  updateGroup(room: string, change: { name?: string; members?: string[] }): void {
    this.send({ t: 'update', room, ...change })
  }

  leave(room: string): void {
    this.send({ t: 'leave', room })
  }

  markRead(room: string, seq: number): void {
    const r = this.state.rooms.find((x) => x.id === room)
    if (!r || (r.read[this.state.me] ?? 0) >= seq) return
    try {
      this.send({ t: 'read', room, seq })
    } catch {
      // wird beim nächsten Öffnen erneut gemeldet
    }
  }

  typing(room: string): void {
    try {
      this.send({ t: 'typing', room })
    } catch {
      // ohne Verbindung egal
    }
  }

  private fileUrl(room: string, file: ChatFile): string {
    const base = this.host.url()
    if (!base) throw new Error('Keine Telefonanlage eingerichtet')
    return `${base}/chat/files/${encodeURIComponent(room)}/${encodeURIComponent(file.id)}`
  }

  async upload(room: string, name: string, type: string, data: Uint8Array): Promise<ChatMessage> {
    const base = this.host.url()
    if (!base) throw new Error('Keine Telefonanlage eingerichtet')
    const q = new URLSearchParams({ room, name })
    const r = await fetch(`${base}/chat/files?${q}`, {
      method: 'POST',
      headers: { 'Content-Type': type || 'application/octet-stream' },
      body: new Uint8Array(data),
      signal: AbortSignal.timeout(10 * 60000),
    })
    if (!r.ok) {
      const text = await errorOf(r)
      throw new Error(text || (r.status === 413 ? 'Die Datei ist zu groß.' : `Hochladen fehlgeschlagen (${r.status})`))
    }
    return (await r.json()) as ChatMessage
  }

  uploadPath(room: string, file: string): Promise<ChatMessage> {
    return this.upload(room, path.basename(file), mimeOf(file), fs.readFileSync(file))
  }

  async download(room: string, file: ChatFile): Promise<Buffer> {
    const r = await fetch(this.fileUrl(room, file), { signal: AbortSignal.timeout(10 * 60000) })
    if (!r.ok) {
      const text = await errorOf(r)
      throw new Error(text || `Herunterladen fehlgeschlagen (${r.status})`)
    }
    return Buffer.from(await r.arrayBuffer())
  }
}
