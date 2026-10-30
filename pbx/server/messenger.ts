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
const FILES_PER_WINDOW = 30
const FILE_WINDOW = 10 * 60000

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

/** Nummer der letzten Nachricht in einer Raumdatei (liest nur das Ende) */
export function lastSeq(file: string): number {
  let fd: number
  try {
    fd = fs.openSync(file, 'r')
  } catch {
    return 0
  }
  try {
    const size = fs.fstatSync(fd).size
    const len = Math.min(size, 64 * 1024)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim())
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return Number((JSON.parse(lines[i]) as ChatMessage).seq) || 0
      } catch {
        // abgeschnittene Zeile: die davor nehmen
      }
    }
    return 0
  } finally {
    fs.closeSync(fd)
  }
}

/** Verwaltet die Gruppe: wer sie angelegt hat – ist er nicht mehr dabei, jedes Mitglied */
export function isGroupAdmin(r: ChatRoom, ext: string): boolean {
  return r.created_by === ext || !r.members.includes(r.created_by)
}

/** Unterhaltung aus Sicht einer Nebenstelle */
export interface RoomView extends ChatRoom {
  last: ChatMessage | null
  unread: number
}

export class MessengerStore {
  rooms = new Map<string, ChatRoom>()
  /** Geladene Nachrichten je Raum (erst beim ersten Zugriff gelesen, zuletzt benutzte zuletzt) */
  private cache = new Map<string, ChatMessage[]>()
  /** Ungefähre Größe je geladenem Raum in Bytes */
  private sizes = new Map<string, number>()
  private saveTimer: NodeJS.Timeout | null = null

  /** @param cacheBytes so viel Verlauf bleibt höchstens im Speicher, ältere Räume werden bei Bedarf neu gelesen */
  constructor(
    readonly dir: string,
    readonly cacheBytes = 32 * 1024 * 1024,
  ) {
    for (const r of loadJson<ChatRoom[]>(path.join(dir, 'rooms.json'), [])) {
      // rooms.json wird verzögert gespeichert: Nach einem Absturz kann der Zähler hinter
      // den schon geschriebenen Nachrichten liegen – dann würden Nummern doppelt vergeben
      r.seq = Math.max(r.seq, lastSeq(this.roomFile(r.id)))
      this.rooms.set(r.id, r)
    }
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
    if (list) {
      // ans Ende rücken: zuletzt benutzt
      this.cache.delete(room)
      this.cache.set(room, list)
      return list
    }
    list = []
    let size = 0
    try {
      for (const line of fs.readFileSync(this.roomFile(room), 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          list.push(JSON.parse(line) as ChatMessage)
          size += line.length
        } catch {
          // beschädigte Zeile überspringen
        }
      }
    } catch {
      // noch keine Nachrichten
    }
    this.remember(room, list, size)
    return list
  }

  private remember(room: string, list: ChatMessage[], size: number): void {
    this.cache.delete(room)
    this.cache.set(room, list)
    this.sizes.set(room, size)
    let total = [...this.sizes.values()].reduce((a, b) => a + b, 0)
    for (const old of this.cache.keys()) {
      if (total <= this.cacheBytes || old === room) break
      total -= this.sizes.get(old) ?? 0
      this.forgetCache(old)
    }
  }

  private forgetCache(room: string): void {
    this.cache.delete(room)
    this.sizes.delete(room)
  }

  private rewrite(room: string, list: ChatMessage[]): void {
    const file = this.roomFile(room)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const text = list.map((m) => JSON.stringify(m) + '\n').join('')
    fs.writeFileSync(file, text, { mode: 0o600 })
    this.remember(room, list, text.length)
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
    // Nach dem Umnummerieren passt die ID nicht mehr zu den Mitgliedern: nach Mitgliedern suchen
    let r = [...this.rooms.values()].find((x) => x.kind === 'direct' && x.members.length === 2 && pair.every((m) => x.members.includes(m)))
    let id = `d-${pair[0]}-${pair[1]}`.replace(/[^\w-]/g, '_')
    // Die ID gehört einem früheren Chat (z. B. einer gelöschten Nebenstelle): neue ID
    if (!r && this.rooms.has(id)) id = `${id}-${newId()}`
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
  updateGroup(r: ChatRoom, change: { name?: string; members?: string[] }, by = ''): string[] {
    if (r.kind !== 'group') throw new ChatError('Nur Gruppen lassen sich ändern.')
    const before = r.members
    // Hinzufügen und Umbenennen darf jedes Mitglied, andere entfernen nur, wer die Gruppe verwaltet
    if (by && change.members && !isGroupAdmin(r, by) && before.some((m) => m !== by && !change.members?.includes(m))) {
      throw new ChatError('Mitglieder entfernen kann nur, wer die Gruppe angelegt hat.')
    }
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

  /** Nebenstelle hat eine neue Nummer: Ihre Chats gehen mit */
  renumber(from: string, to: string): void {
    let changed = false
    for (const r of this.rooms.values()) {
      if (r.created_by === from) {
        r.created_by = to
        changed = true
      }
      if (!r.members.includes(from)) continue
      r.members = r.members.map((m) => (m === from ? to : m))
      if (from in r.read) {
        r.read[to] = r.read[from]
        delete r.read[from]
      }
      changed = true
    }
    if (changed) this.flush()
  }

  /**
   * Nebenstelle gelöscht: Sie verlässt alle Unterhaltungen, damit eine spätere
   * Nebenstelle mit derselben Nummer die alten Chats nicht sieht.
   */
  forget(number: string): string[] {
    const affected: string[] = []
    for (const r of [...this.rooms.values()]) {
      // Eine spätere Nebenstelle mit derselben Nummer verwaltet die alten Gruppen nicht
      if (r.created_by === number) r.created_by = ''
      if (!r.members.includes(number)) continue
      affected.push(r.id)
      r.members = r.members.filter((m) => m !== number)
      delete r.read[number]
      if (!r.members.length) this.removeRoom(r.id)
    }
    if (affected.length) this.flush()
    return affected
  }

  removeRoom(id: string): void {
    this.rooms.delete(id)
    this.forgetCache(id)
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
    const line = JSON.stringify(msg) + '\n'
    fs.appendFileSync(target, line, { mode: 0o600 })
    list.push(msg)
    if (this.cache.get(r.id) === list) this.sizes.set(r.id, (this.sizes.get(r.id) ?? 0) + line.length)
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

  /** Anhänge, die eine Nebenstelle verschickt hat: Größe in Bytes und Zeitpunkte */
  filesOf(ext: string): { bytes: number; times: number[] } {
    let bytes = 0
    const times: number[] = []
    for (const id of this.rooms.keys()) {
      for (const m of this.messages(id)) {
        if (m.from !== ext || !m.file) continue
        bytes += m.file.size
        times.push(m.time)
      }
    }
    return { bytes, times }
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
   * Aufräumen: älteste Nachrichten (mit Anhängen) löschen, solange der Messenger mehr als
   * sein Kontingent belegt. Ist die Platte aus anderen Gründen knapp, wird höchstens die
   * Hälfte des Messengers geopfert – sonst wäre am Ende der ganze Verlauf weg, ohne dass
   * es etwas nützt. Gibt die Zahl der gelöschten Nachrichten zurück.
   */
  cleanup(limits: { freeBytes: () => number | null; minFree: number; maxUsage: number; usage?: () => number }): number {
    const usage = limits.usage ?? (() => this.usage())
    const start = usage()
    let removed = 0
    for (;;) {
      const used = usage()
      const free = limits.freeBytes()
      const overQuota = used > limits.maxUsage
      const diskLow = free !== null && free < limits.minFree && used > start / 2
      if (!overQuota && !diskLow) return removed
      // Nur Zeit und Nummer sammeln: Der Zwischenspeicher kann Räume unterwegs verwerfen und neu lesen
      const all = [...this.rooms.keys()].flatMap((id) => this.messages(id).map((m) => ({ room: id, seq: m.seq, time: m.time })))
      if (!all.length) return removed
      // In Schritten von einem Zehntel löschen, damit nicht mehr als nötig verschwindet
      all.sort((a, b) => a.time - b.time || a.seq - b.seq)
      const doomed = new Set(all.slice(0, Math.ceil(all.length / 10)).map((m) => `${m.room}:${m.seq}`))
      for (const id of this.rooms.keys()) {
        const list = this.messages(id)
        const keep = list.filter((m) => !doomed.has(`${id}:${m.seq}`))
        if (keep.length === list.length) continue
        for (const m of list) if (doomed.has(`${id}:${m.seq}`) && m.file) fs.rmSync(path.join(this.fileDir(id), m.file.id), { force: true })
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
  | { t: 'decline'; room: string }

/** Laufender Videoanruf eines Raums (Konferenz p4a-chat-<raum>) */
interface Call {
  since: number
  /** wer angefangen hat */
  by: string
  /** Kanal → Nebenstelle */
  channels: Map<string, string>
  /** alle, die irgendwann dabei waren */
  joined: Set<string>
}

export interface CallView {
  since: number
  by: string
  participants: string[]
}

/** Konferenzraum der Anlage zu einem Chat */
export const CALL_PREFIX = 'p4a-chat-'

function duration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} Std.` : `${m}:${String(s % 60).padStart(2, '0')} Min.`
}

interface Client {
  ext: string
  token: string
  conn: WebSocketConnection
}

/** Absender von Hinweisen der Anlage (Zusammenfassungen, Rückrufnotizen) */
export const SYSTEM_SENDER = 'Telefonanlage'

export class MessengerHub {
  private clients = new Set<Client>()
  private calls = new Map<string, Call>()
  /** Nachricht in einer SMS-Unterhaltung geschrieben: als SMS versenden */
  onSms?: (room: ChatRoom, msg: ChatMessage, ext: string) => void

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
        calls: Object.fromEntries(
          this.store
            .roomsFor(ext)
            .filter((r) => this.calls.has(r.id))
            .map((r) => [r.id, this.callView(r.id)]),
        ),
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
        const m = s.post(r, c.ext, String(msg.text ?? ''))
        this.publishMessage(r, m, msg.ref)
        if (r.sms) this.onSms?.(r, m, c.ext)
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
        s.updateGroup(r, { name: msg.name === undefined ? undefined : String(msg.name), members }, c.ext)
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
      case 'decline': {
        // Anruf abgelehnt: alle Geräte hören auf zu klingeln, im Einzelchat legt der Anrufer auf
        const r = s.room(String(msg.room), c.ext)
        for (const m of r.members) this.sendTo(m, { t: 'declined', room: r.id, ext: c.ext })
        break
      }
    }
  }

  /** Datei wurde per HTTP hochgeladen: als Nachricht verschicken */
  postFile(ext: string, room: string, name: string, type: string, data: Buffer, text = '', now = Date.now()): ChatMessage {
    const r = this.store.room(room, ext)
    // Kontingent: Speicher je Nebenstelle und höchstens 30 Dateien in 10 Minuten
    const quota = this.config().messenger.quota_mb * 1024 * 1024
    const mine = this.store.filesOf(ext)
    if (quota > 0 && mine.bytes + data.length > quota) {
      throw new ChatError(`Ihr Speicher im Messenger ist voll (${this.config().messenger.quota_mb} MB). Bitte die Verwaltung, alte Unterhaltungen zu löschen.`)
    }
    if (mine.times.filter((t) => t > now - FILE_WINDOW).length >= FILES_PER_WINDOW) {
      throw new ChatError('Zu viele Dateien in kurzer Zeit. Bitte etwas warten.')
    }
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
      if (!ext || !ext.devices.some((d) => d.token === c.token)) c.conn.close(4003, 'Kein Zugriff mehr')
    }
    this.broadcast({ t: 'users', users: this.users() })
  }

  // -- Videoanrufe ---------------------------------------------------------------------

  /** Darf die Nebenstelle dem Videoanruf des Raums beitreten? (Abfrage aus dem Wählplan) */
  mayJoin(ext: string, room: string): boolean {
    const cfg = this.config()
    if (!cfg.messenger.video || !messengerUsers(cfg).some((e) => e.number === ext)) return false
    return this.store.rooms.get(room)?.members.includes(ext) ?? false
  }

  get activeCalls(): number {
    return this.calls.size
  }

  private callView(room: string): CallView | null {
    const call = this.calls.get(room)
    return call ? { since: call.since, by: call.by, participants: [...new Set(call.channels.values())] } : null
  }

  private publishCall(room: string): void {
    const r = this.store.rooms.get(room)
    if (!r) return
    for (const m of r.members) this.sendTo(m, { t: 'call', room, call: this.callView(room) })
  }

  /** Ereignisse der Konferenzen (AMI): wer ist im Videoanruf welches Raums */
  onAmi(e: Record<string, string>): void {
    if (e.Event !== 'ConfbridgeJoin' && e.Event !== 'ConfbridgeLeave') return
    if (!e.Conference?.startsWith(CALL_PREFIX)) return
    const room = e.Conference.slice(CALL_PREFIX.length)
    const ext = /^PJSIP\/(.+)-video-[0-9a-f]+$/.exec(e.Channel ?? '')?.[1] ?? e.CallerIDNum ?? ''
    let call = this.calls.get(room)
    if (e.Event === 'ConfbridgeJoin') {
      if (!call) {
        call = { since: Date.now(), by: ext, channels: new Map(), joined: new Set() }
        this.calls.set(room, call)
      }
      call.channels.set(e.Channel, ext)
      call.joined.add(ext)
      this.publishCall(room)
      return
    }
    if (!call) return
    call.channels.delete(e.Channel)
    if (call.channels.size) return void this.publishCall(room)
    this.calls.delete(room)
    this.publishCall(room)
    const r = this.store.rooms.get(room)
    if (!r) return
    const text =
      call.joined.size > 1
        ? `Videoanruf, ${duration(Date.now() - call.since)}`
        : `Verpasster Videoanruf von ${this.nameOf(call.by)}`
    this.publishMessage(r, this.store.post(r, '', text))
  }

  /** Verbindung zu Asterisk verloren: Anrufe sind beendet */
  resetCalls(): void {
    const rooms = [...this.calls.keys()]
    this.calls.clear()
    for (const room of rooms) this.publishCall(room)
  }

  /** Nebenstelle gelöscht: aus allen Unterhaltungen nehmen und die übrigen Mitglieder informieren */
  forgotten(number: string): void {
    for (const id of this.store.forget(number)) {
      const r = this.store.rooms.get(id)
      if (r) this.publishRoom(r)
    }
  }

  /** Hinweis der Anlage (z. B. Notruf) im Einzelchat zwischen zwei Nebenstellen */
  notice(to: string, about: string, text: string): void {
    const users = messengerUsers(this.config())
    if (to === about || !users.some((e) => e.number === to) || !users.some((e) => e.number === about)) return
    const r = this.store.direct(to, about)
    this.publishMessage(r, this.store.post(r, '', text))
  }

  /** Nachricht der Anlage an eine Nebenstelle (eigene Unterhaltung „Telefonanlage“, zählt als ungelesen) */
  inbox(to: string, text: string): boolean {
    if (!messengerUsers(this.config()).some((e) => e.number === to)) return false
    const id = `g-p4a-${to}`.replace(/[^\w-]/g, '_')
    let r = this.store.rooms.get(id)
    if (!r || !r.members.includes(to)) {
      if (r) this.store.removeRoom(id)
      r = { id, kind: 'group', name: SYSTEM_SENDER, members: [to], created: Date.now(), created_by: '', seq: 0, read: {} }
      this.store.rooms.set(id, r)
      this.store.flush()
    }
    this.publishMessage(r, this.store.post(r, SYSTEM_SENDER, text))
    return true
  }

  /** SMS-Unterhaltung mit einer Rufnummer; Mitglieder sind alle Nebenstellen mit SMS-Recht */
  smsRoom(number: string, name: string, members: string[]): ChatRoom {
    const users = new Set(messengerUsers(this.config()).map((e) => e.number))
    const list = members.filter((m) => users.has(m))
    if (!list.length) throw new ChatError('Niemand mit SMS-Recht nutzt den Messenger.')
    let r = [...this.store.rooms.values()].find((x) => x.sms === number)
    if (!r) {
      r = { id: `g-${newId()}`, kind: 'group', name: `SMS ${name || number}`.slice(0, 80), members: list, created: Date.now(), created_by: '', seq: 0, read: {}, sms: number }
      this.store.rooms.set(r.id, r)
      this.store.flush()
      this.publishRoom(r)
    } else if (list.some((m) => !r!.members.includes(m))) {
      r.members = [...new Set([...r.members, ...list])]
      this.store.flush()
      this.publishRoom(r)
    }
    return r
  }

  /** SMS empfangen: in der Unterhaltung mit dem Absender zeigen */
  smsReceived(number: string, name: string, text: string, members: string[]): ChatMessage {
    const r = this.smsRoom(number, name, members)
    const msg = this.store.post(r, number, text)
    this.publishMessage(r, msg)
    return msg
  }

  /** Nachricht im Namen einer Nebenstelle (z. B. aus der App gesendete SMS) */
  postAs(room: ChatRoom, ext: string, text: string): void {
    this.publishMessage(room, this.store.post(room, ext, text))
  }

  /** Hinweis der Anlage in eine Unterhaltung (ohne Absender) */
  note(room: ChatRoom, text: string): void {
    this.publishMessage(room, this.store.post(room, '', text))
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
