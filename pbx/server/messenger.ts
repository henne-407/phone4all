/**
 * Messenger: Einzel- und Gruppenchats zwischen den Nebenstellen. Die Apps verbinden
 * sich per WebSocket unter /provision/<token>/chat; Dateien laufen über HTTP.
 *
 * Ablage unter data/messenger: rooms.json (Unterhaltungen), rooms/<id>.jsonl
 * (Nachrichten, eine pro Zeile) und files/<raum>/<id> (Anhänge). Gelöscht wird nur,
 * wenn der Speicher knapp wird – dann die ältesten Nachrichten samt Anhängen zuerst.
 */

import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { loadJson, saveJson } from './files'
import type { ChatFile, ChatMessage, ChatRoom, Extension, PbxConfig } from './model'
import type { WebSocketConnection } from './websocket'

const MAX_TEXT = 8000
const MAX_MEMBERS = 50
const PAGE = 50

export class ChatError extends Error {}

function newId(): string {
  return randomBytes(9).toString('base64url')
}

/** Nebenstellen, die den Messenger nutzen dürfen (App-Profil mit Seite „Messenger“ oder ohne Profil) */
export function messengerUsers(cfg: PbxConfig): Extension[] {
  if (!cfg.messenger.enabled) return []
  return cfg.extensions.filter((e) => {
    const p = cfg.appprofiles.find((x) => x.id === e.app_profile)
    return !p || p.pages.includes('messenger')
  })
}

/** Unterhaltung aus Sicht einer Nebenstelle */
export interface RoomView extends ChatRoom {
  last: ChatMessage | null
  unread: number
}

export class MessengerStore {
  rooms = new Map<string, ChatRoom>()
  /** Geladene Nachrichten je Raum (erst beim ersten Zugriff gelesen) */
  private cache = new Map<string, ChatMessage[]>()
  private saveTimer: NodeJS.Timeout | null = null

  constructor(readonly dir: string) {
    for (const r of loadJson<ChatRoom[]>(path.join(dir, 'rooms.json'), [])) this.rooms.set(r.id, r)
  }

  // -- Ablage ---------------------------------------------------------------

  private roomFile(id: string): string {
    return path.join(this.dir, 'rooms', `${id}.jsonl`)
  }

  fileDir(room: string): string {
    return path.join(this.dir, 'files', room)
  }

  filePath(room: string, id: string): string {
    if (!/^[\w-]+$/.test(room) || !/^[\w-]+$/.test(id)) throw new ChatError('Ungültige Datei.')
    return path.join(this.fileDir(room), id)
  }

  /** Raumliste sofort schreiben (z. B. beim Beenden) */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    saveJson(path.join(this.dir, 'rooms.json'), [...this.rooms.values()])
  }

  /** Lesestände ändern sich oft: gebündelt speichern */
  private saveSoon(): void {
    this.saveTimer ??= setTimeout(() => this.flush(), 2000)
    this.saveTimer.unref?.()
  }

  messages(room: string): ChatMessage[] {
    let list = this.cache.get(room)
    if (!list) {
      list = []
      try {
        for (const line of fs.readFileSync(this.roomFile(room), 'utf8').split('\n')) {
          if (!line.trim()) continue
          try {
            list.push(JSON.parse(line) as ChatMessage)
          } catch {
            // beschädigte Zeile überspringen
          }
        }
      } catch {
        // noch keine Nachrichten
      }
      this.cache.set(room, list)
    }
    return list
  }

  private rewrite(room: string, list: ChatMessage[]): void {
    const file = this.roomFile(room)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, list.map((m) => JSON.stringify(m) + '\n').join(''), { mode: 0o600 })
    this.cache.set(room, list)
  }

  // -- Unterhaltungen -------------------------------------------------------

  room(id: string, ext: string): ChatRoom {
    const r = this.rooms.get(id)
    if (!r || !r.members.includes(ext)) throw new ChatError('Unterhaltung nicht gefunden.')
    return r
  }

  roomsFor(ext: string): ChatRoom[] {
    return [...this.rooms.values()].filter((r) => r.members.includes(ext))
  }

  view(r: ChatRoom, ext: string): RoomView {
    const list = this.messages(r.id)
    const read = r.read[ext] ?? 0
    const unread = list.filter((m) => m.seq > read && m.from !== ext && m.from).length
    return { ...r, last: list.at(-1) ?? null, unread }
  }

  /** Einzelchat zwischen zwei Nebenstellen (wird beim ersten Mal angelegt) */
  direct(a: string, b: string): ChatRoom {
    if (a === b) throw new ChatError('Ein Chat mit sich selbst ist nicht möglich.')
    const pair = [a, b].sort()
    const id = `d-${pair[0]}-${pair[1]}`.replace(/[^\w-]/g, '_')
    let r = this.rooms.get(id)
    if (!r) {
      r = { id, kind: 'direct', name: '', members: pair, created: Date.now(), created_by: a, seq: 0, read: {} }
      this.rooms.set(id, r)
      this.flush()
    }
    return r
  }

  createGroup(by: string, name: string, members: string[]): ChatRoom {
    const clean = name.trim().slice(0, 80)
    if (!clean) throw new ChatError('Die Gruppe braucht einen Namen.')
    const list = [...new Set([by, ...members])]
    if (list.length > MAX_MEMBERS) throw new ChatError(`Höchstens ${MAX_MEMBERS} Mitglieder.`)
    const r: ChatRoom = { id: `g-${newId()}`, kind: 'group', name: clean, members: list, created: Date.now(), created_by: by, seq: 0, read: {} }
    this.rooms.set(r.id, r)
    this.flush()
    return r
  }

  /** Gruppe umbenennen oder Mitglieder ändern; liefert die bisherigen Mitglieder */
  updateGroup(r: ChatRoom, change: { name?: string; members?: string[] }): string[] {
    if (r.kind !== 'group') throw new ChatError('Nur Gruppen lassen sich ändern.')
    const before = r.members
    if (change.name !== undefined) {
      const clean = change.name.trim().slice(0, 80)
      if (!clean) throw new ChatError('Die Gruppe braucht einen Namen.')
      r.name = clean
    }
    if (change.members) {
      const list = [...new Set(change.members)]
      if (!list.length) throw new ChatError('Eine Gruppe braucht Mitglieder.')
      if (list.length > MAX_MEMBERS) throw new ChatError(`Höchstens ${MAX_MEMBERS} Mitglieder.`)
      r.members = list
    }
    this.flush()
    return before
  }

  leave(r: ChatRoom, ext: string): void {
    if (r.kind !== 'group') throw new ChatError('Einzelchats kann man nicht verlassen.')
    r.members = r.members.filter((m) => m !== ext)
    delete r.read[ext]
    if (!r.members.length) this.removeRoom(r.id)
    else this.flush()
  }

  removeRoom(id: string): void {
    this.rooms.delete(id)
    this.cache.delete(id)
    fs.rmSync(this.roomFile(id), { force: true })
    fs.rmSync(this.fileDir(id), { recursive: true, force: true })
    this.flush()
  }

  // -- Nachrichten ----------------------------------------------------------

  post(r: ChatRoom, from: string, text: string, file?: ChatFile): ChatMessage {
    const clean = text.replace(/\r\n/g, '\n').trim().slice(0, MAX_TEXT)
    if (!clean && !file) throw new ChatError('Leere Nachricht.')
    r.seq++
    const msg: ChatMessage = { seq: r.seq, room: r.id, from, time: Date.now(), text: clean, ...(file ? { file } : {}) }
    const list = this.messages(r.id) // vor dem Anhängen laden, sonst doppelt im Speicher
    const target = this.roomFile(r.id)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.appendFileSync(target, JSON.stringify(msg) + '\n', { mode: 0o600 })
    list.push(msg)
    // Eigene Nachrichten gelten als gelesen
    if (from) r.read[from] = r.seq
    this.saveSoon()
    return msg
  }

  /** Seite des Verlaufs: die `limit` Nachrichten vor `before` (ohne = die neuesten) */
  history(room: string, before?: number, limit = PAGE): { messages: ChatMessage[]; complete: boolean } {
    const list = this.messages(room)
    const end = before ? list.findIndex((m) => m.seq >= before) : -1
    const stop = end === -1 ? list.length : end
    const start = Math.max(0, stop - Math.min(Math.max(limit, 1), 200))
    return { messages: list.slice(start, stop), complete: start === 0 }
  }

  markRead(r: ChatRoom, ext: string, seq: number): boolean {
    const value = Math.min(Math.max(0, Math.floor(seq)), r.seq)
    if (value <= (r.read[ext] ?? 0)) return false
    r.read[ext] = value
    this.saveSoon()
    return true
  }

  saveFile(room: string, name: string, type: string, data: Buffer): ChatFile {
    const id = newId()
    const dir = this.fileDir(room)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, id), data, { mode: 0o600 })
    const clean = path.basename(name).replace(/[\x00-\x1f"\\/]/g, '_').slice(0, 120) || 'datei'
    return { id, name: clean, size: data.length, type: /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream' }
  }

  /** Belegter Speicher in Bytes (Nachrichten und Anhänge) */
  usage(): number {
    let total = 0
    const walk = (dir: string): void => {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.isFile()) total += fs.statSync(p).size
      }
    }
    walk(this.dir)
    return total
  }

  /**
   * Speicher knapp: älteste Nachrichten (mit Anhängen) löschen, bis wieder genug frei ist.
   * Gibt die Zahl der gelöschten Nachrichten zurück.
   */
  cleanup(freeBytes: () => number | null, minFree: number): number {
    let removed = 0
    for (;;) {
      const free = freeBytes()
      if (free === null || free >= minFree) return removed
      const all = [...this.rooms.keys()].flatMap((id) => this.messages(id))
      if (!all.length) return removed
      // In Schritten von einem Zehntel löschen, damit nicht mehr als nötig verschwindet
      all.sort((a, b) => a.time - b.time)
      const cut = all[Math.max(0, Math.ceil(all.length / 10) - 1)].time
      for (const id of this.rooms.keys()) {
        const list = this.messages(id)
        const keep = list.filter((m) => m.time > cut)
        if (keep.length === list.length) continue
        for (const m of list) if (m.time <= cut && m.file) fs.rmSync(path.join(this.fileDir(id), m.file.id), { force: true })
        removed += list.length - keep.length
        this.rewrite(id, keep)
      }
    }
  }
}

// -- Verbindungen der Apps ----------------------------------------------------

/** Nachrichten der App an die Anlage */
type ClientMessage =
  | { t: 'history'; room: string; before?: number; limit?: number }
  | { t: 'send'; room: string; text: string; ref?: string }
  | { t: 'direct'; with: string; ref?: string }
  | { t: 'group'; name: string; members: string[]; ref?: string }
  | { t: 'update'; room: string; name?: string; members?: string[]; ref?: string }
  | { t: 'leave'; room: string }
  | { t: 'read'; room: string; seq: number }
  | { t: 'typing'; room: string }

interface Client {
  ext: string
  token: string
  conn: WebSocketConnection
}

export class MessengerHub {
  private clients = new Set<Client>()

  constructor(
    readonly store: MessengerStore,
    private config: () => PbxConfig,
  ) {}

  private users(): { number: string; name: string }[] {
    return messengerUsers(this.config())
      .map((e) => ({ number: e.number, name: e.name }))
      .sort((a, b) => a.number.localeCompare(b.number, 'de', { numeric: true }))
  }

  online(): string[] {
    return [...new Set([...this.clients].map((c) => c.ext))]
  }

  get connections(): number {
    return this.clients.size
  }

  private sendTo(ext: string, data: unknown): void {
    const text = JSON.stringify(data)
    for (const c of this.clients) if (c.ext === ext) c.conn.send(text)
  }

  private broadcast(data: unknown): void {
    const text = JSON.stringify(data)
    for (const c of this.clients) c.conn.send(text)
  }

  /** Raum an alle Mitglieder senden (jeweils mit eigenem Ungelesen-Zähler) */
  private publishRoom(r: ChatRoom): void {
    for (const m of r.members) this.sendTo(m, { t: 'room', room: this.store.view(r, m) })
  }

  private publishMessage(r: ChatRoom, msg: ChatMessage, ref?: string): void {
    // Erste Nachricht eines Einzelchats: Die Gegenseite kennt den Raum noch nicht
    if (msg.seq === 1) this.publishRoom(r)
    for (const m of r.members) this.sendTo(m, { t: 'message', message: msg, ...(ref ? { ref } : {}) })
  }

  /** Neue Verbindung einer Nebenstelle */
  attach(ext: string, token: string, conn: WebSocketConnection): void {
    const client: Client = { ext, token, conn }
    const wasOnline = this.online().includes(ext)
    this.clients.add(client)
    conn.send(
      JSON.stringify({
        t: 'init',
        me: ext,
        users: this.users(),
        online: this.online(),
        rooms: this.store.roomsFor(ext).map((r) => this.store.view(r, ext)),
      }),
    )
    if (!wasOnline) this.broadcast({ t: 'presence', online: this.online() })
    conn.on('message', (text: string) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(text) as ClientMessage
      } catch {
        return
      }
      try {
        this.handle(client, msg)
      } catch (e) {
        const ref = (msg as { ref?: string }).ref
        conn.send(JSON.stringify({ t: 'error', text: e instanceof ChatError ? e.message : 'Interner Fehler', ...(ref ? { ref } : {}) }))
        if (!(e instanceof ChatError)) console.error('Messenger:', e)
      }
    })
    conn.on('close', () => {
      this.clients.delete(client)
      if (!this.online().includes(ext)) this.broadcast({ t: 'presence', online: this.online() })
    })
  }

  private member(ext: string): void {
    if (!messengerUsers(this.config()).some((e) => e.number === ext)) throw new ChatError(`Nebenstelle ${ext} kann den Messenger nicht nutzen.`)
  }

  private handle(c: Client, msg: ClientMessage): void {
    const s = this.store
    switch (msg.t) {
      case 'history': {
        s.room(String(msg.room), c.ext)
        const page = s.history(String(msg.room), Number(msg.before) || undefined, Number(msg.limit) || undefined)
        c.conn.send(JSON.stringify({ t: 'history', room: msg.room, ...page }))
        break
      }
      case 'send': {
        const r = s.room(String(msg.room), c.ext)
        this.publishMessage(r, s.post(r, c.ext, String(msg.text ?? '')), msg.ref)
        break
      }
      case 'direct': {
        const other = String(msg.with ?? '')
        this.member(other)
        const r = s.direct(c.ext, other)
        c.conn.send(JSON.stringify({ t: 'room', room: s.view(r, c.ext), ...(msg.ref ? { ref: msg.ref } : {}) }))
        break
      }
      case 'group': {
        const members = (Array.isArray(msg.members) ? msg.members : []).map(String)
        for (const m of members) this.member(m)
        const r = s.createGroup(c.ext, String(msg.name ?? ''), members)
        s.post(r, '', `${this.nameOf(c.ext)} hat die Gruppe „${r.name}“ erstellt`)
        this.publishRoom(r)
        if (msg.ref) c.conn.send(JSON.stringify({ t: 'room', room: s.view(r, c.ext), ref: msg.ref }))
        break
      }
      case 'update': {
        const r = s.room(String(msg.room), c.ext)
        const members = Array.isArray(msg.members) ? msg.members.map(String) : undefined
        const before = r.members
        if (members) for (const m of members.filter((x) => !before.includes(x))) this.member(m)
        const oldName = r.name
        s.updateGroup(r, { name: msg.name === undefined ? undefined : String(msg.name), members })
        const added = r.members.filter((m) => !before.includes(m))
        const gone = before.filter((m) => !r.members.includes(m))
        const notes: string[] = []
        if (r.name !== oldName) notes.push(`${this.nameOf(c.ext)} hat die Gruppe in „${r.name}“ umbenannt`)
        if (added.length) notes.push(`${this.nameOf(c.ext)} hat ${added.map((m) => this.nameOf(m)).join(', ')} hinzugefügt`)
        if (gone.length) notes.push(`${this.nameOf(c.ext)} hat ${gone.map((m) => this.nameOf(m)).join(', ')} entfernt`)
        for (const n of notes) this.publishMessage(r, s.post(r, '', n))
        for (const m of gone) this.sendTo(m, { t: 'removed', room: r.id })
        this.publishRoom(r)
        break
      }
      case 'leave': {
        const r = s.room(String(msg.room), c.ext)
        s.leave(r, c.ext)
        this.sendTo(c.ext, { t: 'removed', room: r.id })
        if (s.rooms.has(r.id)) {
          this.publishMessage(r, s.post(r, '', `${this.nameOf(c.ext)} hat die Gruppe verlassen`))
          this.publishRoom(r)
        }
        break
      }
      case 'read': {
        const r = s.room(String(msg.room), c.ext)
        if (s.markRead(r, c.ext, Number(msg.seq) || 0)) {
          for (const m of r.members) this.sendTo(m, { t: 'read', room: r.id, ext: c.ext, seq: r.read[c.ext] })
        }
        break
      }
      case 'typing': {
        const r = s.room(String(msg.room), c.ext)
        for (const m of r.members) if (m !== c.ext) this.sendTo(m, { t: 'typing', room: r.id, ext: c.ext })
        break
      }
    }
  }

  /** Datei wurde per HTTP hochgeladen: als Nachricht verschicken */
  postFile(ext: string, room: string, name: string, type: string, data: Buffer, text = ''): ChatMessage {
    const r = this.store.room(room, ext)
    const file = this.store.saveFile(r.id, name, type, data)
    const msg = this.store.post(r, ext, text, file)
    this.publishMessage(r, msg)
    return msg
  }

  private nameOf(ext: string): string {
    return this.config().extensions.find((e) => e.number === ext)?.name || ext
  }

  /** Nach Konfigurationsänderungen: Verbindungen ohne Berechtigung trennen, Liste der Nutzer neu senden */
  refresh(): void {
    const cfg = this.config()
    const allowed = messengerUsers(cfg)
    for (const c of [...this.clients]) {
      const ext = allowed.find((e) => e.number === c.ext)
      if (!ext || ext.provision_token !== c.token) c.conn.close(4003, 'Kein Zugriff mehr')
    }
    this.broadcast({ t: 'users', users: this.users() })
  }

  /** Unterhaltung wurde in der Verwaltung gelöscht */
  removed(room: string, members: string[]): void {
    for (const m of members) this.sendTo(m, { t: 'removed', room })
  }

  /** Nachrichten wurden beim Aufräumen gelöscht: Apps laden neu */
  reloadAll(): void {
    for (const c of [...this.clients]) c.conn.close(4000, 'Bitte neu verbinden')
  }

  close(): void {
    for (const c of [...this.clients]) c.conn.close(1001, 'Anlage wird beendet')
    this.store.flush()
  }
}
