/**
 * Asterisk als Kindprozess: Konfiguration schreiben, starten, überwachen,
 * neu laden, Status abfragen. Der Verwaltungsdienst ist der Hauptprozess des
 * Containers; stirbt Asterisk, wird es neu gestartet.
 */

import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { Ami, type AmiMessage } from './ami'
import { type CallParties, callParties, clean } from './calls'
import { writeAtomic } from './files'
import { type GenContext, generate } from './generate'
import type { PbxConfig } from './model'
import { PATHS, SETTINGS } from './paths'
import { webrtcEnabled } from './remote'

const SECRET_FILES = new Set(['pjsip.conf', 'voicemail.conf', 'manager.conf', 'msmtprc'])

export interface EndpointStatus {
  number: string
  contacts: { uri: string; agent: string; status: string; rtt: number }[]
}

export interface ActiveCall extends CallParties {
  id: string
  channels: { channel: string; from: string; fromName: string; to: string; toName: string; state: string; duration: number }[]
}

export interface PbxStatus {
  asterisk: 'stopped' | 'starting' | 'running' | 'error'
  message: string
  uptime: string
  endpoints: EndpointStatus[]
  registrations: { trunk: string; status: string }[]
  calls: ActiveCall[]
}

function ids(user: string): { uid: number; gid: number } | null {
  if (!user || process.getuid?.() !== 0) return null
  try {
    return {
      uid: Number(execFileSync('id', ['-u', user], { encoding: 'utf8' }).trim()),
      gid: Number(execFileSync('id', ['-g', user], { encoding: 'utf8' }).trim()),
    }
  } catch {
    return null
  }
}

/** Selbst signiertes Zertifikat für TLS (SIP-Konten mit TLS, z. B. CompanyFlex). */
function ensureTls(): { cert: string; key: string } | null {
  const cert = path.join(PATHS.keys, 'pbx.crt')
  const key = path.join(PATHS.keys, 'pbx.key')
  if (!fs.existsSync(cert) || !fs.existsSync(key)) {
    try {
      fs.mkdirSync(PATHS.keys, { recursive: true })
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
        '-subj', '/CN=phone4all', '-keyout', key, '-out', cert,
      ], { stdio: 'ignore' })
    } catch {
      return null
    }
  }
  return { cert, key }
}

export class Asterisk extends EventEmitter {
  readonly ami = new Ami()
  private proc: ChildProcess | null = null
  private amiSecret = randomBytes(16).toString('hex')
  private owner = ids(SETTINGS.runUser)
  /** Zertifikat für SIP-TLS und HTTPS (selbst signiert, in data/keys austauschbar) */
  readonly tls = ensureTls()
  private restartDelay = 1000
  private stopping = false
  private lastTransport = ''
  state: PbxStatus['asterisk'] = 'stopped'
  message = ''

  constructor() {
    super()
    this.ami.on('event', (e: AmiMessage) => this.emit('ami', e))
    // Verbindung weg, Asterisk läuft aber noch (z. B. nach „core restart“): neu verbinden
    this.ami.on('disconnected', () => {
      const proc = this.proc
      if (!proc || this.stopping) return
      this.state = 'starting'
      this.message = 'Verbindung zu Asterisk wird wiederhergestellt'
      void this.connectAmi(proc)
    })
  }

  /** Der Asterisk-Prozess läuft (unabhängig von der AMI-Verbindung). */
  get processRunning(): boolean {
    return this.proc !== null
  }

  /** Lebenszeichen über das AMI */
  async ping(): Promise<boolean> {
    try {
      const [res] = await this.ami.action({ Action: 'Ping' }, 5000)
      return res?.Response === 'Success'
    } catch {
      return false
    }
  }

  /** Einmaliger Versuch, die AMI-Verbindung wieder aufzubauen. */
  async reconnectAmi(): Promise<boolean> {
    if (!this.proc) return false
    try {
      await this.ami.connect(SETTINGS.amiPort, 'phone4all', this.amiSecret)
      this.state = 'running'
      this.message = ''
      return true
    } catch {
      return false
    }
  }

  /** Hängendes Asterisk beenden; der Neustart folgt wie nach einem Absturz. */
  async kill(reason: string): Promise<void> {
    const proc = this.proc
    if (!proc) return
    this.message = reason
    proc.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 5000)
      proc.once('exit', () => {
        clearTimeout(t)
        resolve()
      })
    })
  }

  /** SIP-Konto sofort neu anmelden (id ohne „trunk-“). */
  async register(trunk: string): Promise<void> {
    await this.ami.command(`pjsip send register trunk-${trunk}`)
  }

  async reloadPjsip(): Promise<void> {
    await this.ami.command('module reload res_pjsip.so')
  }

  async registrations(): Promise<{ trunk: string; status: string }[]> {
    const regs = await this.ami.list({ Action: 'PJSIPShowRegistrationsOutbound' })
    return regs
      .filter((r) => r.Event === 'OutboundRegistrationDetail')
      .map((r) => ({ trunk: (r.ObjectName ?? '').replace(/^trunk-/, ''), status: r.Status ?? '' }))
  }

  context(banned: string[]): GenContext {
    return {
      apiUrl: `http://127.0.0.1:${SETTINGS.httpPort}/internal`,
      dirs: {
        etc: PATHS.etc,
        data: PATHS.data,
        spool: PATHS.spool,
        log: PATHS.log,
        lib: PATHS.lib,
        run: PATHS.run,
        sounds: PATHS.sounds,
        moh: PATHS.moh,
        recordings: PATHS.recordings,
        db: PATHS.db,
        modules: PATHS.modules,
        asteriskData: PATHS.asteriskData,
      },
      ami: { port: SETTINGS.amiPort, secret: this.amiSecret },
      httpPort: SETTINGS.asteriskHttpPort,
      tls: this.tls,
      banned,
      runUser: SETTINGS.runUser,
      mailer: fs.existsSync(SETTINGS.mailer) ? SETTINGS.mailer : '',
    }
  }

  /** Verzeichnisse anlegen und Asterisk gehören lassen. */
  prepareDirs(): void {
    const dirs = [PATHS.spool, path.join(PATHS.spool, 'fax'), PATHS.log, PATHS.db, PATHS.recordings, PATHS.sounds, PATHS.moh, PATHS.run, PATHS.lib, path.join(PATHS.lib, 'keys'), path.join(PATHS.log, 'cdr-custom'), PATHS.etc]
    for (const d of dirs) {
      fs.mkdirSync(d, { recursive: true })
      if (this.owner && d !== PATHS.etc) fs.chownSync(d, this.owner.uid, this.owner.gid)
    }
    // Asterisk läuft nicht als root und muss den TLS-Schlüssel lesen können
    if (this.owner && this.tls) for (const f of [this.tls.key, this.tls.cert]) fs.chownSync(f, this.owner.uid, this.owner.gid)
    // Wartemusik beim ersten Start aus dem System übernehmen
    if (!fs.readdirSync(PATHS.moh).length && fs.existsSync(PATHS.systemMoh)) {
      for (const f of fs.readdirSync(PATHS.systemMoh).filter((f) => /\.(wav|gsm|ulaw|alaw|sln)$/.test(f))) {
        fs.copyFileSync(path.join(PATHS.systemMoh, f), path.join(PATHS.moh, f))
      }
    }
  }

  /** Konfiguration schreiben und – falls Asterisk läuft – übernehmen. */
  async apply(cfg: PbxConfig, banned: string[]): Promise<void> {
    const files = generate(cfg, this.context(banned))
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(PATHS.etc, name)
      const secret = SECRET_FILES.has(name)
      writeAtomic(file, content, secret ? 0o640 : 0o644)
      if (this.owner) fs.chownSync(file, 0, this.owner.gid)
      if (name === 'msmtprc' && this.owner) {
        // msmtp prüft, dass nur der Eigentümer die Datei lesen kann
        fs.chownSync(file, this.owner.uid, this.owner.gid)
        fs.chmodSync(file, 0o600)
      }
    }
    const s = cfg.system
    const transport = JSON.stringify([s.sip_port, s.tls_port, s.external_address, s.local_nets, s.rtp_start, s.rtp_end, webrtcEnabled(cfg)])
    const restart = this.lastTransport !== '' && transport !== this.lastTransport
    this.lastTransport = transport
    if (!this.ami.connected) return
    if (restart) {
      // Transporte lassen sich in PJSIP nicht neu laden
      await this.ami.command('core restart when convenient').catch(() => undefined)
    } else {
      await this.ami.command('core reload').catch(() => undefined)
    }
  }

  start(): void {
    if (SETTINGS.noAsterisk || this.proc) return
    this.stopping = false
    this.state = 'starting'
    this.message = ''
    const conf = path.join(PATHS.etc, 'asterisk.conf')
    const proc = spawn(SETTINGS.asterisk, ['-f', '-n', '-C', conf], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = proc
    const started = Date.now()
    const log = (data: Buffer): void => {
      const text = data.toString().trim()
      if (text) console.log('[asterisk]', text)
    }
    proc.stdout?.on('data', log)
    proc.stderr?.on('data', log)
    proc.on('error', (e) => {
      this.state = 'error'
      this.message = `Asterisk konnte nicht gestartet werden: ${e.message}`
      console.error(this.message)
    })
    proc.on('exit', (code, signal) => {
      this.proc = null
      this.ami.close()
      if (this.stopping) {
        this.state = 'stopped'
        return
      }
      this.state = 'error'
      this.message = `Asterisk wurde beendet (${signal ?? code}) und wird neu gestartet`
      console.error(this.message)
      // Schnell hintereinander abstürzend: Wartezeit verlängern
      this.restartDelay = Date.now() - started > 60000 ? 1000 : Math.min(this.restartDelay * 2, 60000)
      setTimeout(() => this.start(), this.restartDelay).unref()
    })
    void this.connectAmi(proc)
  }

  private async connectAmi(proc: ChildProcess): Promise<void> {
    for (let i = 0; i < 120 && this.proc === proc; i++) {
      await new Promise((r) => setTimeout(r, 500))
      try {
        await this.ami.connect(SETTINGS.amiPort, 'phone4all', this.amiSecret)
        this.state = 'running'
        this.message = ''
        this.emit('running')
        return
      } catch {
        // Asterisk startet noch
      }
    }
  }

  async stop(): Promise<void> {
    const proc = this.proc
    if (!proc) return
    this.stopping = true
    await this.ami.command('core stop gracefully').catch(() => proc.kill('SIGTERM'))
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 10000)
      proc.once('exit', () => {
        clearTimeout(t)
        resolve()
      })
    })
  }

  async restart(): Promise<void> {
    await this.stop()
    this.start()
  }

  async status(): Promise<PbxStatus> {
    const result: PbxStatus = {
      asterisk: this.state,
      message: this.message,
      uptime: '',
      endpoints: [],
      registrations: [],
      calls: [],
    }
    if (!this.ami.connected) return result
    try {
      const [contacts, registrations, channels, uptime] = await Promise.all([
        this.ami.list({ Action: 'PJSIPShowContacts' }),
        this.registrations(),
        this.ami.list({ Action: 'CoreShowChannels' }),
        this.ami.command('core show uptime seconds'),
      ])
      const byAor = new Map<string, EndpointStatus>()
      for (const c of contacts.filter((e) => e.Event === 'ContactList')) {
        // Statische Kontakte der SIP-Konten (trunk-…) gehören nicht zu den Nebenstellen
        // Die Mobil-App (<nummer>-app) zählt als weiteres Gerät der Nebenstelle
        const aor = (c.Endpoint ?? (c.ObjectName ?? '').split(';')[0]).replace(/-app$/, '')
        if (!aor || aor.startsWith('trunk-')) continue
        if (!byAor.has(aor)) byAor.set(aor, { number: aor, contacts: [] })
        byAor.get(aor)!.contacts.push({
          uri: c.Uri ?? '',
          agent: c.UserAgent ?? '',
          status: c.Status ?? '',
          rtt: Math.round(Number(c.RoundtripUsec ?? 0) / 1000),
        })
      }
      result.endpoints = [...byAor.values()]
      result.registrations = registrations
      const byCall = new Map<string, AmiMessage[]>()
      for (const ch of channels.filter((c) => c.Event === 'CoreShowChannel')) {
        const id = ch.Linkedid || ch.Uniqueid
        if (!byCall.has(id)) byCall.set(id, [])
        byCall.get(id)!.push(ch)
      }
      const calls: ActiveCall[] = [...byCall].map(([id, chs]) => ({
        id,
        ...callParties(chs),
        channels: chs.map((ch) => ({
          channel: ch.Channel,
          from: clean(ch.CallerIDNum),
          fromName: clean(ch.CallerIDName),
          to: clean(ch.ConnectedLineNum),
          toName: clean(ch.ConnectedLineName),
          state: ch.ChannelStateDesc,
          duration: durationSeconds(ch.Duration),
        })),
      }))
      result.calls = calls
      const m = /System uptime:\s*(\d+)/.exec(uptime)
      result.uptime = m ? m[1] : ''
    } catch (e) {
      result.message = (e as Error).message
    }
    return result
  }

  async activeCalls(): Promise<number> {
    if (!this.ami.connected) return 0
    try {
      return (await this.ami.list({ Action: 'CoreShowChannels' })).filter((c) => c.Event === 'CoreShowChannel').length
    } catch {
      return 0
    }
  }
}

function durationSeconds(d: string | undefined): number {
  if (!d) return 0
  const parts = d.split(':').map(Number)
  return parts.reduce((acc, v) => acc * 60 + (v || 0), 0)
}
