/**
 * KI-Telefonassistent: Asterisk reicht den Anruf per AudioSocket (TCP, 8 kHz slin) an den
 * Verwaltungsdienst. Der Assistent begrüßt, hört zu (Pausenerkennung), wandelt das Gesagte
 * in Text (Spracherkennung), fragt das Sprachmodell nach der Antwort und spricht sie
 * (Sprachausgabe). Er kann mit festgelegten Stellen verbinden oder eine Rückrufnotiz
 * aufnehmen; danach geht der Anruf im Wählplan weiter (/internal/ai-end).
 *
 * AudioSocket-Rahmen: 1 Byte Art, 2 Byte Länge (Big Endian), Nutzdaten.
 * Art 0x00 Ende, 0x01 Kennung (UUID), 0x03 Taste, 0x10 Ton (16 Bit, 8 kHz, mono), 0xff Fehler.
 */

import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import net from 'node:net'
import type { ChatFn, ChatTurn } from './llm'
import { parseJsonReply } from './llm'
import type { AiAgent } from './model'

export const KIND = { hangup: 0x00, uuid: 0x01, dtmf: 0x03, audio: 0x10, error: 0xff } as const
/** 20 ms bei 8 kHz, 16 Bit */
export const FRAME_BYTES = 320
const FRAME_MS = 20

export function frame(kind: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(3)
  head.writeUInt8(kind, 0)
  head.writeUInt16BE(payload.length, 1)
  return Buffer.concat([head, payload])
}

/** Rahmen aus einem TCP-Datenstrom lesen (Teilstücke werden gesammelt) */
export class FrameReader {
  private buf: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): { kind: number; payload: Buffer }[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    const out: { kind: number; payload: Buffer }[] = []
    while (this.buf.length >= 3) {
      const len = this.buf.readUInt16BE(1)
      if (this.buf.length < 3 + len) break
      out.push({ kind: this.buf[0], payload: this.buf.subarray(3, 3 + len) })
      this.buf = this.buf.subarray(3 + len)
    }
    return out
  }
}

/** UUID aus 16 Byte */
export function uuidOf(b: Buffer): string {
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/** Lautstärke eines Rahmens (RMS, 0–32767) */
export function rms(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2)
  if (!n) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const v = pcm.readInt16LE(i * 2)
    sum += v * v
  }
  return Math.sqrt(sum / n)
}

/** WAV-Kopf für 8 kHz, 16 Bit, mono */
export function wav8k(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii')
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write('WAVEfmt ', 8, 'ascii')
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(8000, 24)
  h.writeUInt32LE(16000, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36, 'ascii')
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/**
 * Pausenerkennung: Sprache beginnt nach drei lauten Rahmen, endet nach 0,8 s Stille
 * (oder spätestens nach 20 s). Liefert das Gesagte als PCM.
 */
export class Utterance {
  private frames: Buffer[] = []
  private loud = 0
  private quiet = 0
  private speaking = false

  constructor(
    private threshold = 700,
    private silenceFrames = 40,
    private maxFrames = 1000,
  ) {}

  reset(): void {
    this.frames = []
    this.loud = 0
    this.quiet = 0
    this.speaking = false
  }

  get active(): boolean {
    return this.speaking
  }

  /** Rahmen hinzufügen; fertiges Gesagtes oder null */
  push(pcm: Buffer): Buffer | null {
    const level = rms(pcm)
    if (!this.speaking) {
      // Etwas Vorlauf behalten, damit der Wortanfang nicht fehlt
      this.frames.push(pcm)
      if (this.frames.length > 10) this.frames.shift()
      this.loud = level > this.threshold ? this.loud + 1 : 0
      if (this.loud >= 3) this.speaking = true
      return null
    }
    this.frames.push(pcm)
    this.quiet = level > this.threshold ? 0 : this.quiet + 1
    if (this.quiet >= this.silenceFrames || this.frames.length >= this.maxFrames) {
      const out = Buffer.concat(this.frames)
      this.reset()
      return out
    }
    return null
  }
}

export interface AgentReply {
  say: string
  action: 'continue' | 'transfer' | 'message' | 'hangup'
  target: string
  message: string
}

export interface AgentNote {
  agent: string
  from: string
  from_name: string
  message: string
  transcript: string
}

export interface AgentDeps {
  /** PCM (8 kHz) → Text */
  stt: (pcm: Buffer) => Promise<string>
  chat: ChatFn
  /** Text → PCM (8 kHz, ohne Kopf) */
  tts: (text: string, voice: string) => Promise<Buffer>
  note: (note: AgentNote) => void
  /** Firmenname, Datum, Uhrzeit für die Anweisung */
  context: () => { company: string; now: string }
}

/** Anweisung an das Sprachmodell */
export function systemPrompt(agent: AiAgent, from: string, ctx: { company: string; now: string }): string {
  const targets = agent.targets.length ? agent.targets.map((t) => `- ${t.name}: ${t.number}`).join('\n') : '- (niemand – nur Rückrufnotizen)'
  return `Du bist „${agent.name}“, der telefonische Assistent von ${ctx.company}. Du sprichst am Telefon mit einem Anrufer.
Antworte ausschließlich mit einem JSON-Objekt:
{"say": "…", "action": "continue|transfer|message|hangup", "target": "", "message": ""}

say: Was du als Nächstes sagst – kurz (höchstens zwei Sätze), natürliche gesprochene Sprache, keine Listen, keine Abkürzungen, Zahlen ausgeschrieben, wo es hilft.
action:
- continue: weiter zuhören
- transfer: mit einer Stelle verbinden; target = deren Nummer aus der Liste unten. Sage vorher, dass du verbindest.
- message: Rückrufnotiz – erst wenn Name, Rückrufnummer und Anliegen klar sind; message = vollständige Notiz. Verabschiede dich in say.
- hangup: das Gespräch ist erledigt; verabschiede dich in say.
Verbinden darfst du nur mit:
${targets}
Wenn du etwas nicht weißt, biete eine Rückrufnotiz an. Erfinde keine Auskünfte, Preise oder Termine.
Rufnummer des Anrufers: ${from || 'unbekannt'}. Jetzt: ${ctx.now}.

Wissen und Anweisungen:
${agent.instructions.trim() || '(keine)'}`
}

/** Antwort des Modells prüfen; unbekannte Ziele werden zu „continue“ */
export function readReply(agent: AiAgent, text: string): AgentReply {
  const j = parseJsonReply<Partial<AgentReply>>(text)
  if (!j) return { say: text.replace(/[{}"]/g, '').trim().slice(0, 400), action: 'continue', target: '', message: '' }
  const action = (['continue', 'transfer', 'message', 'hangup'] as const).includes(j.action as AgentReply['action']) ? (j.action as AgentReply['action']) : 'continue'
  const target = String(j.target ?? '').replace(/[^\d*#+]/g, '')
  const reply: AgentReply = { say: String(j.say ?? '').trim().slice(0, 600), action, target, message: String(j.message ?? '').trim().slice(0, 2000) }
  if (action === 'transfer' && !agent.targets.some((t) => t.number === target)) {
    reply.action = 'continue'
    reply.target = ''
  }
  return reply
}

/** Ergebnis eines Gesprächs: '' = Ausweichziel, 'hangup' oder Nummer für die Weiterleitung */
export type AgentResult = { kind: 'fallback' } | { kind: 'hangup' } | { kind: 'transfer'; number: string }

/** Ein Gespräch mit dem Assistenten */
export class AgentCall extends EventEmitter {
  readonly id = randomUUID()
  result: AgentResult = { kind: 'fallback' }
  transcript: ChatTurn[] = []
  private history: ChatTurn[] = []
  private socket: net.Socket | null = null
  private reader = new FrameReader()
  private utterance = new Utterance()
  private playing: Buffer[] = []
  private timer: NodeJS.Timeout | null = null
  private thinking = false
  private ended = false
  private finished = false
  attached = false
  private misses = 0
  private greeting: Promise<Buffer> | null = null
  private deadline: NodeJS.Timeout | null = null
  readonly created = Date.now()

  constructor(
    readonly agent: AiAgent,
    readonly from: string,
    readonly fromName: string,
    private deps: AgentDeps,
  ) {
    super()
    this.history.push({ role: 'system', content: systemPrompt(agent, from, deps.context()) })
    // Begrüßung schon vorbereiten, bevor Asterisk verbindet
    this.greeting = deps.tts(agent.greeting, agent.voice)
    this.greeting.catch(() => {})
  }

  /** Asterisk hat verbunden (nach dem UUID-Rahmen) */
  attach(socket: net.Socket, rest: { kind: number; payload: Buffer }[] = []): void {
    this.socket = socket
    this.attached = true
    socket.on('data', (d: Buffer) => this.onFrames(this.reader.push(d)))
    socket.on('close', () => this.finish())
    socket.on('error', () => this.finish())
    this.onFrames(rest)
    const max = Math.min(1800, Math.max(30, this.agent.max_seconds || 300)) * 1000
    this.deadline = setTimeout(() => void this.say('Ich verbinde Sie jetzt weiter.', () => this.end({ kind: 'fallback' })), max)
    void (async () => {
      try {
        this.play(await this.greeting!)
        this.transcript.push({ role: 'assistant', content: this.agent.greeting })
        this.history.push({ role: 'assistant', content: JSON.stringify({ say: this.agent.greeting, action: 'continue' }) })
      } catch {
        this.end({ kind: 'fallback' })
      }
    })()
  }

  private onFrames(frames: { kind: number; payload: Buffer }[]): void {
    for (const f of frames) {
      if (f.kind === KIND.hangup || f.kind === KIND.error) {
        this.finish()
        return
      }
      if (f.kind !== KIND.audio || this.ended) continue
      // Halbduplex: während der Assistent spricht oder nachdenkt, nicht zuhören
      if (this.playing.length || this.thinking) continue
      const said = this.utterance.push(f.payload)
      if (said) void this.respond(said)
    }
  }

  /** PCM in 20-ms-Rahmen im Takt abspielen */
  private play(pcm: Buffer, then?: () => void): void {
    for (let i = 0; i < pcm.length; i += FRAME_BYTES) {
      const chunk = pcm.subarray(i, i + FRAME_BYTES)
      this.playing.push(chunk.length === FRAME_BYTES ? chunk : Buffer.concat([chunk, Buffer.alloc(FRAME_BYTES - chunk.length)]))
    }
    if (then) this.once('drained', then)
    if (this.timer) return
    this.timer = setInterval(() => {
      const next = this.playing.shift()
      if (next && this.socket && !this.socket.destroyed) this.socket.write(frame(KIND.audio, next))
      if (!this.playing.length) {
        clearInterval(this.timer!)
        this.timer = null
        this.utterance.reset()
        this.emit('drained')
      }
    }, FRAME_MS)
  }

  private async say(text: string, then?: () => void): Promise<void> {
    try {
      this.play(await this.deps.tts(text, this.agent.voice), then)
    } catch {
      then?.()
    }
  }

  private async respond(pcm: Buffer): Promise<void> {
    this.thinking = true
    try {
      const text = (await this.deps.stt(pcm)).trim()
      if (!text || /^\[.*\]$/.test(text)) {
        this.misses++
        this.thinking = false
        if (this.misses >= 3) return void this.say('Ich verbinde Sie mit einem Mitarbeiter.', () => this.end({ kind: 'fallback' }))
        return void this.say('Entschuldigung, das habe ich nicht verstanden. Können Sie das bitte wiederholen?')
      }
      this.misses = 0
      this.transcript.push({ role: 'user', content: text })
      this.history.push({ role: 'user', content: text })
      const raw = await this.deps.chat(this.history.slice(-30), { json: true, maxTokens: 400, timeoutMs: 30000 })
      const reply = readReply(this.agent, raw)
      this.history.push({ role: 'assistant', content: JSON.stringify(reply) })
      if (reply.say) this.transcript.push({ role: 'assistant', content: reply.say })
      this.thinking = false
      const after = (): void => {
        if (reply.action === 'transfer') this.end({ kind: 'transfer', number: reply.target })
        else if (reply.action === 'hangup') this.end({ kind: 'hangup' })
        else if (reply.action === 'message') {
          this.deps.note({ agent: this.agent.name, from: this.from, from_name: this.fromName, message: reply.message || text, transcript: this.transcriptText() })
          this.end({ kind: 'hangup' })
        }
      }
      if (reply.say) await this.say(reply.say, after)
      else after()
    } catch (e) {
      console.error('KI-Telefonassistent:', (e as Error).message)
      this.thinking = false
      this.end({ kind: 'fallback' })
    }
  }

  transcriptText(): string {
    return this.transcript.map((t) => `${t.role === 'user' ? 'Anrufer' : 'Assistent'}: ${t.content}`).join('\n')
  }

  get done(): boolean {
    return this.ended
  }

  /** Gespräch beenden: Asterisk setzt den Wählplan fort */
  end(result: AgentResult): void {
    if (this.ended) return
    this.result = result
    this.ended = true
    if (this.socket && !this.socket.destroyed) this.socket.end(frame(KIND.hangup))
    this.finish()
  }

  private finish(): void {
    if (this.finished) return
    this.finished = true
    this.ended = true
    if (this.timer) clearInterval(this.timer)
    if (this.deadline) clearTimeout(this.deadline)
    this.timer = null
    this.playing = []
    this.emit('end')
  }
}

/** AudioSocket-Server und laufende Gespräche */
export class AgentServer {
  private calls = new Map<string, AgentCall>()
  private server: net.Server | null = null

  constructor(private deps: AgentDeps) {}

  start(port: number, host = '127.0.0.1'): void {
    this.server = net.createServer((socket) => {
      const reader = new FrameReader()
      const first = (d: Buffer): void => {
        const frames = reader.push(d)
        if (!frames.length) return
        socket.off('data', first)
        const call = frames[0].kind === KIND.uuid ? this.calls.get(uuidOf(frames[0].payload)) : undefined
        if (!call) return void socket.destroy()
        call.attach(socket, frames.slice(1))
      }
      socket.on('data', first)
      socket.on('error', () => {})
    })
    this.server.on('error', (e) => console.error('KI-Telefonassistent (AudioSocket):', e.message))
    this.server.listen(port, host)
  }

  /** Neues Gespräch (vom Wählplan vor AudioSocket) */
  open(agent: AiAgent, from: string, name: string): AgentCall {
    const call = new AgentCall(agent, from, name, this.deps)
    this.calls.set(call.id, call)
    // Verbindet Asterisk nicht, gilt das Gespräch nach einer Minute als beendet
    setTimeout(() => {
      if (!call.attached) call.end({ kind: 'fallback' })
    }, 60000).unref()
    // Ergebnis noch kurz für /internal/ai-end aufheben
    call.once('end', () => setTimeout(() => this.calls.delete(call.id), 60000).unref())
    return call
  }

  get(id: string): AgentCall | undefined {
    return this.calls.get(id)
  }

  get active(): number {
    return [...this.calls.values()].filter((c) => c.attached && !c.done).length
  }

  close(): void {
    for (const c of this.calls.values()) c.end({ kind: 'fallback' })
    this.server?.close()
  }
}
