/**
 * Zugriff von unterwegs: Die Mobil-App erreicht die Anlage nur über HTTPS (z. B. über
 * einen Reverse-Proxy wie Pangolin). SIP läuft als WebSocket unter /ws und wird hier an
 * den HTTP-Server von Asterisk durchgereicht; die Sprache läuft per WebRTC (DTLS-SRTP)
 * über den eingebauten TURN-Server (coturn).
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { Duplex } from 'node:stream'
import { clientIp } from './http'
import type { PbxConfig } from './model'
import { PATHS, SETTINGS } from './paths'

/** Endpunkt der App einer Nebenstelle (eigenes Gerät mit WebRTC) */
export function appEndpoint(number: string): string {
  return `${number}-app`
}

/** Endpunkt für Videoanrufe aus dem Messenger (WebRTC, kann nur Chat-Räume anrufen) */
export function videoEndpoint(number: string): string {
  return `${number}-video`
}

/** Videoanrufe im Messenger eingeschaltet */
export function videoEnabled(cfg: PbxConfig): boolean {
  return cfg.messenger.enabled && cfg.messenger.video
}

/** SIP über WebSocket wird gebraucht: Mobil-App oder Videoanrufe */
export function webrtcEnabled(cfg: PbxConfig): boolean {
  return cfg.remote.enabled || videoEnabled(cfg)
}

/** Öffentliche Basisadresse (aus den Einstellungen, ohne Schrägstrich am Ende) */
export function publicBase(cfg: PbxConfig): string {
  return cfg.remote.public_url.trim().replace(/\/+$/, '')
}

/** wss://…/ws zur Basisadresse */
export function websocketUrl(base: string): string {
  return base.replace(/^http/, 'ws') + '/ws'
}

// -- WebSocket-Weiterleitung zu Asterisk --------------------------------------------

export class WsProxy {
  /** lokaler Port der Verbindung zu Asterisk → Adresse des Telefons */
  private clients = new Map<number, { ip: string; socket: Duplex }>()

  constructor(
    private enabled: () => boolean,
    private banned: (ip: string) => boolean,
  ) {}

  /** Adresse des Telefons hinter einer Verbindung von 127.0.0.1:<port> zu Asterisk */
  clientOf(port: number): string {
    return this.clients.get(port)?.ip ?? ''
  }

  /** Alle Verbindungen einer gesperrten Adresse trennen */
  kick(ip: string): void {
    for (const c of this.clients.values()) if (c.ip === ip) c.socket.destroy()
  }

  get count(): number {
    return this.clients.size
  }

  upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const ip = clientIp(req)
    const refuse = (status: string): void => {
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
    }
    if (url.pathname !== '/ws' || !this.enabled()) return refuse('404 Not Found')
    if (this.banned(ip)) return refuse('403 Forbidden')
    const upstream = net.connect(SETTINGS.asteriskHttpPort, '127.0.0.1')
    let port = 0
    const close = (): void => {
      if (port) this.clients.delete(port)
      socket.destroy()
      upstream.destroy()
    }
    upstream.on('connect', () => {
      port = upstream.localPort ?? 0
      this.clients.set(port, { ip, socket })
      const lines = [`GET /ws HTTP/1.1`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
      upstream.write(lines.join('\r\n') + '\r\n\r\n')
      if (head.length) upstream.write(head)
      socket.pipe(upstream)
      upstream.pipe(socket)
    })
    upstream.on('error', close)
    upstream.on('close', close)
    socket.on('error', close)
    socket.on('close', close)
  }
}

// -- TURN-Server (coturn) --------------------------------------------------------------

const TURN_RELAY = [49160, 49359]

function turnSecret(): string {
  const file = path.join(PATHS.keys, 'turn.secret')
  try {
    const s = fs.readFileSync(file, 'utf8').trim()
    if (s) return s
  } catch {
    // neu erzeugen
  }
  const s = randomBytes(24).toString('hex')
  fs.mkdirSync(PATHS.keys, { recursive: true })
  fs.writeFileSync(file, s, { mode: 0o600 })
  return s
}

/** IPv4-Adressen dieses Rechners – nur dorthin darf der TURN-Server weiterleiten */
export function localAddresses(): string[] {
  const list = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4')
    .map((a) => a!.address)
  return [...new Set(list.filter((ip) => ip !== '127.0.0.1'))]
}

export function turnConf(cfg: PbxConfig, secret: string, peers: string[], runUser: string): string {
  return [
    '# Erzeugt von Phone4all – Änderungen in der Weboberfläche vornehmen',
    `listening-port=${cfg.remote.turn_port}`,
    'fingerprint',
    'use-auth-secret',
    `static-auth-secret=${secret}`,
    'realm=phone4all',
    `min-port=${TURN_RELAY[0]}`,
    `max-port=${TURN_RELAY[1]}`,
    'no-tls',
    'no-dtls',
    'no-cli',
    'no-multicast-peers',
    'stale-nonce=600',
    'user-quota=12',
    'total-quota=240',
    // Kein offenes Relais ins Internet: nur zur Anlage selbst
    // (Relais nur über IPv4, siehe relay-ip; ein IPv6-Bereich hier sperrt in coturn 4.6 auch IPv4)
    'denied-peer-ip=0.0.0.0-255.255.255.255',
    ...peers.map((ip) => `allowed-peer-ip=${ip}`),
    // Relais nie auf 127.0.0.1, auch wenn der Proxy (z. B. Newt) lokal verbindet
    ...peers.map((ip) => `relay-ip=${ip}`),
    'log-file=stdout',
    'simple-log',
    `pidfile=${path.join(PATHS.run, 'turnserver.pid')}`,
    runUser && `proc-user=${runUser}`,
    runUser && `proc-group=${runUser}`,
  ]
    .filter(Boolean)
    .join('\n')
    .concat('\n')
}

/** Zeitlich begrenzte Zugangsdaten nach dem TURN-REST-Verfahren (coturn use-auth-secret) */
export function turnCredentials(secret: string, user: string, expires: number): { username: string; credential: string } {
  const username = `${Math.floor(expires / 1000)}:${user}`
  return { username, credential: createHmac('sha1', secret).update(username).digest('base64') }
}

export interface IceServer {
  urls: string[]
  username?: string
  credential?: string
}

export class Turn {
  private proc: ChildProcess | null = null
  private conf = ''
  readonly secret = turnSecret()
  state: 'off' | 'running' | 'missing' | 'error' = 'off'

  get available(): boolean {
    return fs.existsSync(SETTINGS.turnserver)
  }

  /** Server für die App; Zugangsdaten gelten bis 8 Tage nach Tagesbeginn (stabil über den Tag) */
  iceServers(cfg: PbxConfig, base: string, user: string, now = Date.now()): IceServer[] {
    const r = cfg.remote
    if (!r.turn) return []
    const host = r.turn_host.trim() || `${new URL(base).hostname}:${r.turn_port}`
    const day = 86400000
    const expires = (Math.floor(now / day) + 8) * day
    const cred = turnCredentials(this.secret, user, expires)
    return [
      { urls: [`stun:${host}`] },
      { urls: [`turn:${host}?transport=udp`, `turn:${host}?transport=tcp`], ...cred },
    ]
  }

  apply(cfg: PbxConfig): void {
    const want = cfg.remote.enabled && cfg.remote.turn
    if (!want) return void this.stop()
    if (!this.available) {
      this.state = 'missing'
      return
    }
    const conf = turnConf(cfg, this.secret, localAddresses(), SETTINGS.runUser)
    if (conf === this.conf && this.proc) return
    this.stop()
    this.conf = conf
    const file = path.join(PATHS.etc, 'turnserver.conf')
    fs.writeFileSync(file, conf, { mode: 0o600 })
    this.start(file)
  }

  private start(file: string): void {
    const proc = spawn(SETTINGS.turnserver, ['-c', file], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = proc
    this.state = 'running'
    const log = (data: Buffer): void => {
      for (const line of data.toString().split('\n')) {
        if (/error|cannot|fail/i.test(line)) console.log('[turn]', line.trim())
      }
    }
    proc.stdout?.on('data', log)
    proc.stderr?.on('data', log)
    proc.on('error', (e) => {
      this.state = 'error'
      console.error('TURN-Server:', e.message)
    })
    proc.on('exit', () => {
      // Beendet oder ersetzt: nichts zu tun
      if (this.proc !== proc) return
      this.proc = null
      this.state = 'error'
      // Nach Absturz neu starten
      setTimeout(() => {
        if (!this.proc && this.conf) this.start(file)
      }, 5000).unref()
    })
  }

  stop(): void {
    const proc = this.proc
    this.proc = null
    proc?.kill('SIGTERM')
    this.conf = ''
    this.state = 'off'
  }
}
