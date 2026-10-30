/**
 * Fehlersuche: ausführliches Asterisk-Log mit SIP-Mitschnitt (debug.log), Netzwerk-Mitschnitt
 * als pcap (tcpdump) und ein Diagnose-Paket zum Herunterladen.
 *
 * PBX_DEBUG=1 schaltet das ausführliche Log dauerhaft ein (Testumgebung), sonst gilt es für
 * eine begrenzte Zeit und endet von selbst.
 */

import { type ChildProcess, execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Ami } from './ami'

export const DEBUG_MAX_MINUTES = 240
export const CAPTURE_MAX_SECONDS = 600

export interface DebugStatus {
  /** Ausführliches Log aktiv */
  verbose: boolean
  /** Dauerhaft per PBX_DEBUG=1 */
  forced: boolean
  /** Endet um (ms seit 1970), 0 = dauerhaft oder aus */
  until: number
  log_bytes: number
  capture: { running: boolean; until: number; bytes: number; available: boolean; error: string }
}

export interface CaptureOptions {
  sipPorts: number[]
  rtpStart: number
  rtpEnd: number
}

/** Filter für tcpdump: SIP, TURN und der RTP-Bereich der Anlage */
export function captureFilter(o: CaptureOptions): string {
  const ports = [...new Set([...o.sipPorts, 3478])].filter((p) => p > 0).map((p) => `port ${p}`)
  if (o.rtpStart > 0 && o.rtpEnd >= o.rtpStart) ports.push(`portrange ${o.rtpStart}-${o.rtpEnd}`)
  return ports.join(' or ')
}

/** Asterisk-Befehle für das ausführliche Log an oder aus (debug.log ist ein Kanal zur Laufzeit) */
export function verboseCommands(on: boolean): string[] {
  return on
    ? ['logger add channel debug.log notice,warning,error,verbose,debug,dtmf', 'core set verbose 5', 'core set debug 2', 'pjsip set logger on']
    : ['pjsip set logger off', 'core set debug 0', 'core set verbose 0', 'logger remove channel debug.log']
}

export class Debug {
  private until = 0
  private timer: NodeJS.Timeout | null = null
  private proc: ChildProcess | null = null
  private captureUntil = 0
  private captureError = ''

  constructor(
    private ami: Ami,
    private logDir: string,
    readonly forced = process.env.PBX_DEBUG === '1',
    private tcpdump = process.env.PBX_TCPDUMP || '/usr/bin/tcpdump',
  ) {}

  get verbose(): boolean {
    return this.forced || this.until > Date.now()
  }

  get logFile(): string {
    return path.join(this.logDir, 'debug.log')
  }

  get captureFile(): string {
    return path.join(this.logDir, 'capture.pcap')
  }

  status(): DebugStatus {
    const size = (f: string): number => (fs.existsSync(f) ? fs.statSync(f).size : 0)
    return {
      verbose: this.verbose,
      forced: this.forced,
      until: this.forced ? 0 : this.until,
      log_bytes: size(this.logFile),
      capture: {
        running: this.proc !== null,
        until: this.proc ? this.captureUntil : 0,
        bytes: size(this.captureFile),
        available: fs.existsSync(this.tcpdump),
        error: this.captureError,
      },
    }
  }

  /** Nach jedem (Neu-)Start von Asterisk den gewünschten Stand setzen */
  async apply(): Promise<void> {
    if (!this.ami.connected) return
    for (const cmd of verboseCommands(this.verbose)) await this.ami.command(cmd).catch(() => undefined)
  }

  async enable(minutes: number): Promise<void> {
    const m = Math.min(Math.max(1, Math.round(minutes) || 30), DEBUG_MAX_MINUTES)
    // Neu beginnen, damit das Log nur den gesuchten Fehler enthält
    if (!this.verbose) fs.rmSync(this.logFile, { force: true })
    this.until = Date.now() + m * 60_000
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.disable(), m * 60_000)
    this.timer.unref()
    await this.apply()
  }

  async disable(): Promise<void> {
    this.until = 0
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.apply()
  }

  /** Mitschnitt starten; endet nach seconds von selbst */
  startCapture(seconds: number, o: CaptureOptions): void {
    if (this.proc) throw new Error('Es läuft schon ein Mitschnitt.')
    if (!fs.existsSync(this.tcpdump)) throw new Error('tcpdump ist nicht installiert.')
    const s = Math.min(Math.max(5, Math.round(seconds) || 60), CAPTURE_MAX_SECONDS)
    fs.mkdirSync(this.logDir, { recursive: true })
    fs.rmSync(this.captureFile, { force: true })
    this.captureError = ''
    // -U: sofort schreiben, damit auch ein abgebrochener Mitschnitt lesbar bleibt
    const proc = spawn(this.tcpdump, ['-i', 'any', '-s', '0', '-U', '-w', this.captureFile, captureFilter(o)], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    proc.stderr?.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-500)))
    proc.on('error', (e) => (this.captureError = e.message))
    proc.on('exit', (code) => {
      if (code && code !== 0 && !this.captureError) this.captureError = err.trim().split('\n').pop() ?? `tcpdump endete mit ${code}`
      if (this.proc === proc) this.proc = null
    })
    this.proc = proc
    this.captureUntil = Date.now() + s * 1000
    setTimeout(() => proc.kill('SIGINT'), s * 1000).unref()
  }

  stopCapture(): void {
    this.proc?.kill('SIGINT')
  }

  /**
   * Diagnose-Paket (tar.gz): Logs, Zustand und Konfiguration ohne Passwörter.
   * files: zusätzliche Dateien als Name → Inhalt.
   */
  async bundle(files: Record<string, string>): Promise<string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone4all-diagnose-'))
    try {
      for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text)
      for (const name of ['messages.log', 'debug.log', 'queue_log']) {
        const src = path.join(this.logDir, name)
        if (fs.existsSync(src)) fs.writeFileSync(path.join(dir, name), tail(src, 8 * 1024 * 1024))
      }
      if (fs.existsSync(this.captureFile) && !this.proc) fs.copyFileSync(this.captureFile, path.join(dir, 'capture.pcap'))
      const out = path.join(this.logDir, 'diagnose.tar.gz')
      await new Promise<void>((resolve, reject) =>
        execFile('tar', ['-czf', out, '-C', dir, '.'], (e) => (e ? reject(new Error('Diagnose-Paket: ' + e.message)) : resolve())),
      )
      return out
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

/** Ende einer großen Datei */
function tail(file: string, bytes: number): Buffer {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const len = Math.min(size, bytes)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    return buf
  } finally {
    fs.closeSync(fd)
  }
}
