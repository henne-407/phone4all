/**
 * Überwachung von außen: Messwerte im Prometheus-Format unter /metrics (mit Zugriffsschlüssel)
 * und Meldungen (Watchdog, Änderungsprotokoll, Fehler) an einen Syslog-Server.
 */

import dgram from 'node:dgram'
import net from 'node:net'
import os from 'node:os'
import type { MonitoringSettings, PbxConfig } from './model'

export interface MetricsInput {
  cfg: PbxConfig
  version: string
  asterisk: string
  amiConnected: boolean
  /** Nebenstellen mit mindestens einem angemeldeten Gerät */
  registered: string[]
  trunks: { trunk: string; status: string }[]
  activeCalls: number
  /** Heute: Anrufe nach Art */
  today: { inbound: number; answered: number; missed: number; voicemail: number; outbound: number; internal: number }
  /** Wartende Anrufer je Warteschlange */
  waiting: Record<string, number>
  callbacks: number
  banned: number
  freeBytes: number
  uptime: number
}

const esc = (v: string): string => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')

/** Messwerte als Text (Prometheus Exposition Format 0.0.4) */
export function metricsText(m: MetricsInput): string {
  const out: string[] = []
  const metric = (name: string, help: string, type: 'gauge' | 'counter', values: [Record<string, string>, number][]): void => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`)
    for (const [labels, v] of values) {
      const l = Object.entries(labels).map(([k, x]) => `${k}="${esc(x)}"`)
      out.push(`${name}${l.length ? `{${l.join(',')}}` : ''} ${Number.isFinite(v) ? v : 0}`)
    }
  }
  metric('phone4all_info', 'Version der Anlage', 'gauge', [[{ version: m.version, name: m.cfg.system.name }, 1]])
  metric('phone4all_uptime_seconds', 'Laufzeit des Verwaltungsdienstes', 'gauge', [[{}, Math.round(m.uptime)]])
  metric('phone4all_asterisk_up', 'Asterisk läuft und ist per AMI verbunden', 'gauge', [[{}, m.asterisk === 'running' && m.amiConnected ? 1 : 0]])
  metric('phone4all_extensions', 'Nebenstellen insgesamt', 'gauge', [[{}, m.cfg.extensions.length]])
  metric('phone4all_extensions_registered', 'Nebenstellen mit angemeldetem Gerät', 'gauge', [[{}, m.registered.length]])
  metric(
    'phone4all_extension_registered',
    'Gerät der Nebenstelle angemeldet',
    'gauge',
    m.cfg.extensions.map((e) => [{ extension: e.number, name: e.name }, m.registered.includes(e.number) ? 1 : 0]),
  )
  metric(
    'phone4all_trunk_registered',
    'SIP-Konto beim Anbieter angemeldet',
    'gauge',
    m.cfg.trunks
      .filter((t) => t.enabled)
      .map((t) => {
        const st = m.trunks.find((x) => x.trunk === t.id)?.status ?? ''
        return [{ trunk: t.name }, /^registered$/i.test(st) ? 1 : 0]
      }),
  )
  metric('phone4all_active_calls', 'Laufende Gespräche', 'gauge', [[{}, m.activeCalls]])
  metric(
    'phone4all_calls_today',
    'Anrufe seit Mitternacht',
    'gauge',
    (Object.entries(m.today) as [string, number][]).map(([kind, v]) => [{ kind }, v]),
  )
  metric(
    'phone4all_queue_waiting',
    'Wartende Anrufer je Warteschlange',
    'gauge',
    m.cfg.groups.filter((g) => g.mode === 'queue').map((g) => [{ group: g.name }, m.waiting[g.id] ?? 0]),
  )
  metric('phone4all_callbacks_pending', 'Offene Rückrufe (besetzt und Warteschlange)', 'gauge', [[{}, m.callbacks]])
  metric('phone4all_banned_addresses', 'Gesperrte Adressen (Schutz vor Angriffen)', 'gauge', [[{}, m.banned]])
  metric('phone4all_disk_free_bytes', 'Freier Speicher im Datenordner', 'gauge', [[{}, m.freeBytes]])
  return out.join('\n') + '\n'
}

export type SyslogSeverity = 'error' | 'warning' | 'notice' | 'info'
const SEVERITY: Record<SyslogSeverity, number> = { error: 3, warning: 4, notice: 5, info: 6 }
/** local0 */
const FACILITY = 16

/** Eine Zeile nach RFC 5424 */
export function syslogLine(severity: SyslogSeverity, app: string, text: string, now = new Date(), host = os.hostname()): string {
  const pri = FACILITY * 8 + SEVERITY[severity]
  const clean = text.replace(/[\r\n]+/g, ' ').slice(0, 1800)
  return `<${pri}>1 ${now.toISOString()} ${host.replace(/\s/g, '') || '-'} phone4all - ${app.replace(/\s/g, '') || '-'} - ${clean}`
}

/** Versand an den Syslog-Server; Fehler werden geschluckt (Protokollierung darf nichts aufhalten) */
export class Syslog {
  private udp: dgram.Socket | null = null
  private tcp: net.Socket | null = null
  private tcpKey = ''
  private queue: string[] = []
  error = ''

  constructor(private settings: () => MonitoringSettings) {}

  send(severity: SyslogSeverity, app: string, text: string): void {
    const s = this.settings()
    if (!s.syslog || !s.syslog_host) return
    const line = syslogLine(severity, app, text)
    if (s.syslog_proto === 'tcp') return this.sendTcp(s, line)
    this.udp ??= dgram.createSocket(net.isIPv6(s.syslog_host) ? 'udp6' : 'udp4').on('error', (e) => (this.error = e.message))
    this.udp.unref()
    this.udp.send(Buffer.from(line), s.syslog_port || 514, s.syslog_host, (e) => (this.error = e ? e.message : ''))
  }

  private sendTcp(s: MonitoringSettings, line: string): void {
    const key = `${s.syslog_host}:${s.syslog_port}`
    if (this.tcp && this.tcpKey !== key) {
      this.tcp.destroy()
      this.tcp = null
    }
    // Octet Counting (RFC 6587)
    const frame = `${Buffer.byteLength(line)} ${line}`
    if (this.tcp && !this.tcp.connecting) {
      this.tcp.write(frame)
      return
    }
    if (this.queue.length < 200) this.queue.push(frame)
    if (this.tcp) return
    this.tcpKey = key
    const sock = net.connect({ host: s.syslog_host, port: s.syslog_port || 514 })
    sock.setKeepAlive(true)
    sock.unref()
    sock.on('connect', () => {
      this.error = ''
      for (const f of this.queue.splice(0)) sock.write(f)
    })
    sock.on('error', (e) => (this.error = e.message))
    sock.on('close', () => {
      if (this.tcp === sock) this.tcp = null
    })
    this.tcp = sock
  }

  close(): void {
    this.udp?.close()
    this.udp = null
    this.tcp?.destroy()
    this.tcp = null
  }
}
