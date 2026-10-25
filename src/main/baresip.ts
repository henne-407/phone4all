/**
 * Steuerung einer baresip-Instanz als SIP-/Audio-Engine.
 *
 * baresip wird als Kindprozess mit einer eigenen, generierten Konfiguration
 * gestartet und über das ctrl_tcp-Modul (JSON in Netstrings) gesteuert.
 *
 * Linux: baresip aus der Distribution (Module als .so, Audio über PipeWire).
 * macOS/Windows: mitgeliefertes, statisch gebautes baresip (Audio über PortAudio),
 * beschrieben durch resources/baresip/engine.json.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { AccountSettings } from '../shared/types'
import { resourcePath } from './paths'

const MODULE_DIRS = [
  '/usr/lib64/baresip/modules',
  '/usr/lib/baresip/modules',
  '/usr/local/lib64/baresip/modules',
  '/usr/local/lib/baresip/modules',
  '/usr/lib/x86_64-linux-gnu/baresip/modules',
  '/usr/lib/aarch64-linux-gnu/baresip/modules',
]
const AUDIO_DIRS = ['/usr/share/baresip', '/usr/local/share/baresip']

const CODECS = ['opus', 'g722', 'libg722', 'g711']
const LINUX_AUDIO = ['pipewire', 'pulse', 'alsa']
const OPTIONAL_MODULES = ['auconv', 'auresamp', 'stun', 'turn', 'ice', 'srtp', 'dtls_srtp']
const APP_MODULES = ['account', 'menu', 'ctrl_tcp']

export interface Engine {
  binary: string
  /** Verfügbare Module (ohne Endung) */
  modules: Set<string>
  /** Modulverzeichnis; null bei statisch gebautem baresip */
  moduleDir: string | null
  audioDriver: string
  soundDir: string | null
  bundled: boolean
}

function which(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const file = path.join(dir, name)
    try {
      fs.accessSync(file, fs.constants.X_OK)
      return file
    } catch {
      // weitersuchen
    }
  }
  return null
}

/** Findet baresip: mitgeliefert (engine.json) oder aus dem System. */
export function findEngine(): Engine | null {
  const bundledDir = process.env.SIP_TELEFON_ENGINE_DIR || resourcePath('baresip')
  const manifest = path.join(bundledDir, 'engine.json')
  if (fs.existsSync(manifest)) {
    const conf = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
      binary: string
      modules: string[]
      audio: string
      moduleDir?: string
    }
    return {
      binary: path.join(bundledDir, conf.binary),
      modules: new Set(conf.modules),
      moduleDir: conf.moduleDir ? path.join(bundledDir, conf.moduleDir) : null,
      audioDriver: conf.audio,
      soundDir: path.join(bundledDir, 'share'),
      bundled: true,
    }
  }
  const binary = process.env.SIP_TELEFON_BARESIP || which('baresip')
  if (!binary) return null
  const envDir = process.env.SIP_TELEFON_MODULE_PATH
  const moduleDir = (envDir ? [envDir] : MODULE_DIRS).find((d) => fs.existsSync(path.join(d, 'ctrl_tcp.so')))
  if (!moduleDir) return null
  const modules = new Set(fs.readdirSync(moduleDir).filter((f) => f.endsWith('.so')).map((f) => f.slice(0, -3)))
  const audioDriver = LINUX_AUDIO.find((d) => modules.has(d)) ?? ''
  const envAudio = process.env.SIP_TELEFON_AUDIO_PATH
  const soundDir = [envAudio, ...AUDIO_DIRS].find((d) => d && fs.existsSync(path.join(d, 'ring.wav'))) ?? null
  return { binary, modules, moduleDir, audioDriver, soundDir, bundled: false }
}

function quote(value: string): string {
  return '"' + value.replace(/"/g, '') + '"'
}

/** Erzeugt eine Zeile für die baresip-accounts-Datei. */
export function accountLine(acc: AccountSettings, password: string): string | null {
  const user = (acc.user ?? '').trim()
  const domain = (acc.domain ?? '').trim()
  if (!user || !domain) return null

  const transport = acc.transport || 'udp'
  const port = Number(acc.port) || 0
  const hostport = port ? `${domain}:${port}` : domain
  let uri = `sip:${user}@${hostport}`
  if (transport !== 'udp') uri += `;transport=${transport}`

  const name = (acc.display_name ?? '').trim()
  const line = name ? `${quote(name)} <${uri}>` : `<${uri}>`

  const params = [`auth_user=${(acc.auth_user ?? '').trim() || user}`]
  if (password) params.push(`auth_pass=${password}`)
  let outbound = (acc.outbound ?? '').trim()
  if (outbound) {
    if (!outbound.startsWith('sip:')) outbound = 'sip:' + outbound
    params.push(`outbound=${quote(outbound)}`)
  }
  let stun = (acc.stun ?? '').trim()
  if (stun) {
    if (!stun.startsWith('stun:')) stun = 'stun:' + stun
    params.push(`stunserver=${stun}`, 'medianat=stun')
  }
  if (acc.mediaenc) params.push(`mediaenc=${acc.mediaenc}`)
  params.push(`regint=${Number(acc.regint) || 600}`, 'answermode=manual')
  return line + ';' + params.join(';')
}

export interface AudioConf {
  source: string
  sink: string
  alert: string
  soundDir: string | null
}

export type EngineState = 'starting' | 'running' | 'stopped' | 'error'

export interface BaresipEvent {
  event: true
  class?: string
  type?: string
  param?: string
  id?: string
  peeruri?: string
  peerdisplayname?: string
  from?: string
  [key: string]: unknown
}

type Callback = (ok: boolean, data: string) => void

interface Start {
  accLine: string | null
  localPort: number
  audio: AudioConf
}

/** Startet baresip; Ereignisse: 'event' (BaresipEvent), 'state' (EngineState, Meldung). */
export class Baresip extends EventEmitter {
  engine: Engine | null = null
  private proc: ChildProcess | null = null
  private sock: net.Socket | null = null
  private buffer = Buffer.alloc(0)
  private token = 0
  private callbacks = new Map<string, Callback>()
  private port = 0
  private pendingStart: Start | null = null
  private connectTimer: NodeJS.Timeout | null = null
  stopping = false

  constructor(
    private runtimeDir: string,
    readonly logPath: string,
  ) {
    super()
  }

  get running(): boolean {
    return this.sock !== null
  }

  get driver(): string {
    return this.engine?.audioDriver ?? ''
  }

  private freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer()
      srv.unref()
      srv.on('error', reject)
      srv.listen(0, '127.0.0.1', () => {
        const port = (srv.address() as net.AddressInfo).port
        srv.close(() => resolve(port))
      })
    })
  }

  private writeConfig(engine: Engine, accLine: string | null, localPort: number, audio: AudioConf): void {
    const missing = APP_MODULES.filter((m) => !engine.modules.has(m))
    if (missing.length) throw new Error('baresip-Module fehlen: ' + missing.join(', '))
    const driver = engine.audioDriver
    if (!driver) throw new Error('Kein Audio-Modul gefunden (z. B. Paket baresip-pipewire installieren)')

    let player = audio.sink
    let source = audio.source
    let alert = audio.alert || audio.sink
    if (driver === 'alsa') player = source = alert = 'default' // ALSA kennt die PipeWire-Gerätenamen nicht

    const lines: string[] = []
    if (process.platform === 'linux') lines.push('poll_method epoll')
    if (engine.moduleDir) lines.push(`module_path ${engine.moduleDir}`)
    lines.push(
      `audio_player ${driver},${player}`,
      `audio_source ${driver},${source}`,
      `audio_alert ${driver},${alert}`,
      // Mikrofon immer mono öffnen: Opus wird mit 2 Kanälen ausgehandelt, viele Mikrofone
      // (Headsets, Notebook) können unter PortAudio aber nur 1 Kanal ("Invalid number of
      // channels"). auresamp wandelt für den Encoder auf die Kanalzahl des Codecs um.
      'ausrc_channels 1',
      'call_max_calls 4',
      `ctrl_tcp_listen 127.0.0.1:${this.port}`,
    )
    if (localPort) lines.push(`sip_listen 0.0.0.0:${localPort}`)
    const soundDir = audio.soundDir || engine.soundDir
    if (soundDir) lines.push(`audio_path ${soundDir}`)
    for (const m of [...CODECS, driver, ...OPTIONAL_MODULES]) if (engine.modules.has(m)) lines.push(`module ${m}.so`)
    for (const m of APP_MODULES) lines.push(`module_app ${m}.so`)

    fs.mkdirSync(this.runtimeDir, { recursive: true, mode: 0o700 })
    fs.chmodSync(this.runtimeDir, 0o700)
    fs.writeFileSync(path.join(this.runtimeDir, 'config'), lines.join('\n') + '\n')
    const accPath = path.join(this.runtimeDir, 'accounts')
    fs.writeFileSync(accPath, accLine ? accLine + '\n' : '', { mode: 0o600 })
    fs.chmodSync(accPath, 0o600)
    // baresip legt sonst eine Kontaktdatei mit Beispielen an
    fs.appendFileSync(path.join(this.runtimeDir, 'contacts'), '')
  }

  /** Startet baresip (neu) mit der angegebenen Kontozeile. */
  async start(accLine: string | null, localPort = 0, audio: AudioConf): Promise<void> {
    if (this.proc) {
      // Erst nach dem Beenden der alten Instanz neu starten
      this.pendingStart = { accLine, localPort, audio }
      this.stop()
      return
    }
    this.engine = findEngine()
    if (!this.engine) {
      const hint =
        process.platform === 'linux'
          ? 'baresip ist nicht installiert (z. B. sudo dnf install baresip baresip-pipewire)'
          : 'Die SIP-Engine (baresip) fehlt im Programmpaket'
      this.emit('state', 'error', hint)
      return
    }
    try {
      this.port = await this.freePort()
      this.writeConfig(this.engine, accLine, localPort, audio)
    } catch (e) {
      this.emit('state', 'error', (e as Error).message)
      return
    }

    fs.mkdirSync(path.dirname(this.logPath), { recursive: true })
    // Anhängen (eine beendete Instanz schreibt evtl. noch), bei mehr als 2 MB neu beginnen
    if (fs.existsSync(this.logPath) && fs.statSync(this.logPath).size > 2_000_000) fs.rmSync(this.logPath)
    const log = fs.openSync(this.logPath, 'a')
    fs.writeSync(log, `\n--- ${new Date().toISOString()} Start ---\n`)
    let proc: ChildProcess
    try {
      proc = spawn(this.engine.binary, ['-f', this.runtimeDir], {
        stdio: ['ignore', log, log],
        windowsHide: true,
      })
    } catch (e) {
      fs.closeSync(log)
      this.emit('state', 'error', (e as Error).message)
      return
    }
    fs.closeSync(log)
    this.proc = proc
    this.stopping = false
    proc.on('error', (e) => {
      if (proc === this.proc) this.emit('state', 'error', `baresip konnte nicht starten: ${e.message}`)
    })
    proc.on('exit', () => this.onExit(proc))
    this.emit('state', 'starting', '')
    let attempts = 0
    const tryConnect = (): void => {
      this.connectTimer = null
      if (this.proc !== proc) return
      const sock = net.connect(this.port, '127.0.0.1')
      sock.once('connect', () => {
        sock.removeAllListeners('error')
        this.attach(sock)
      })
      sock.once('error', () => {
        sock.destroy()
        if (++attempts > 60) {
          this.emit('state', 'error', 'Keine Verbindung zu baresip')
          return
        }
        this.connectTimer = setTimeout(tryConnect, 150)
      })
    }
    this.connectTimer = setTimeout(tryConnect, 150)
  }

  private attach(sock: net.Socket): void {
    this.sock = sock
    this.buffer = Buffer.alloc(0)
    sock.setNoDelay(true)
    sock.on('data', (data: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, data])
      this.parse()
    })
    sock.on('close', () => {
      if (this.sock === sock) this.closeSocket()
    })
    sock.on('error', () => undefined)
    this.emit('state', 'running', '')
  }

  stop(): void {
    if (!this.proc) return
    this.stopping = true
    const proc = this.proc
    if (this.sock) {
      this.send('quit')
      setTimeout(() => proc.exitCode === null && proc.kill(), 1500)
    } else {
      proc.kill()
    }
  }

  /** Beim Programmende: baresip sauber abmelden lassen und warten (max. 1,5 s). */
  stopAndWait(): Promise<void> {
    this.pendingStart = null
    const proc = this.proc
    if (!proc) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        proc.kill()
        resolve()
      }, 1500)
      proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      this.stopping = true
      if (this.sock) this.send('quit')
      else proc.kill()
    })
  }

  private onExit(proc: ChildProcess): void {
    if (proc !== this.proc) return
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.closeSocket()
    this.proc = null
    if (this.pendingStart) {
      const { accLine, localPort, audio } = this.pendingStart
      this.pendingStart = null
      void this.start(accLine, localPort, audio)
    } else if (this.stopping) {
      this.emit('state', 'stopped', '')
    } else {
      this.emit('state', 'error', `baresip wurde unerwartet beendet (siehe ${this.logPath})`)
    }
  }

  private closeSocket(): void {
    this.sock?.destroy()
    this.sock = null
    for (const cb of this.callbacks.values()) cb(false, 'SIP-Engine beendet')
    this.callbacks.clear()
  }

  private parse(): void {
    for (;;) {
      const colon = this.buffer.indexOf(0x3a) // ':'
      if (colon < 0) return
      const length = Number(this.buffer.subarray(0, colon).toString())
      if (!Number.isInteger(length)) {
        this.buffer = Buffer.alloc(0)
        return
      }
      const end = colon + 1 + length
      if (this.buffer.length < end + 1) return
      const payload = this.buffer.subarray(colon + 1, end).toString('utf8')
      this.buffer = this.buffer.subarray(end + 1)
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(payload)
      } catch {
        continue
      }
      if (msg.event) {
        this.emit('event', msg as BaresipEvent)
      } else if (msg.response) {
        const token = String(msg.token ?? '')
        const cb = this.callbacks.get(token)
        this.callbacks.delete(token)
        cb?.(Boolean(msg.ok), String(msg.data ?? ''))
      }
    }
  }

  send(command: string, params = '', callback?: Callback): void {
    if (!this.sock) {
      callback?.(false, 'SIP-Engine läuft nicht')
      return
    }
    const token = String(++this.token)
    if (callback) this.callbacks.set(token, callback)
    const payload = Buffer.from(JSON.stringify({ command, params, token }))
    this.sock.write(Buffer.concat([Buffer.from(`${payload.length}:`), payload, Buffer.from(',')]))
  }

  /** Mikrofon ("source") oder Lautsprecher ("sink") sofort umschalten, auch im Gespräch. */
  setDevice(kind: 'source' | 'sink', device: string): void {
    if (this.driver === 'alsa' || !this.driver) return
    this.send(kind === 'source' ? 'ausrc' : 'auplay', `${this.driver},${device}`)
  }

  /** Führt einen Befehl für einen bestimmten Anruf aus. */
  callCommand(callId: string | null, command: string, params = '', callback?: Callback): void {
    if (callId) this.send('callfind', callId)
    this.send(command, params, callback)
  }
}
