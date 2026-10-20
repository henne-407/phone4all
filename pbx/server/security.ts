/** Sperrt IP-Adressen nach wiederholten Fehlanmeldungen (wie fail2ban, aber in Asterisk selbst). */

import { EventEmitter } from 'node:events'
import net from 'node:net'
import type { AmiMessage } from './ami'
import { loadJson, saveJson } from './files'
import type { SecuritySettings } from './model'
import { PATHS } from './paths'
import path from 'node:path'

const FAILURE_EVENTS = new Set(['InvalidAccountID', 'ChallengeResponseFailed', 'InvalidPassword', 'FailedACL'])
const BANS_FILE = path.join(PATHS.data, 'bans.json')

export interface Ban {
  ip: string
  until: number // ms
  reason: string
}

/** „IPV4/UDP/203.0.113.5/5060“ → „203.0.113.5“ */
export function remoteIp(address: string | undefined): string {
  const parts = (address ?? '').split('/')
  const ip = parts.length >= 3 ? parts[2] : ''
  return net.isIP(ip) ? ip : ''
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0
}

/** Prüft IPv4-Adresse gegen Liste aus Adressen und Netzen (CIDR). */
export function inList(ip: string, list: string[]): boolean {
  return list.some((entry) => {
    const [net4, bits] = entry.trim().split('/')
    if (!bits) return net4 === ip
    if (!net.isIPv4(ip) || !net.isIPv4(net4)) return false
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0
    return (ipToInt(ip) & mask) === (ipToInt(net4) & mask)
  })
}

/** Ereignis 'changed', wenn sich die Sperrliste ändert. */
export class Guard extends EventEmitter {
  private failures = new Map<string, number[]>()
  bans: Ban[] = loadJson<Ban[]>(BANS_FILE, [])

  constructor(private settings: () => SecuritySettings) {
    super()
    setInterval(() => this.expire(), 60000).unref()
  }

  banned(): string[] {
    return this.bans.map((b) => b.ip)
  }

  onAmiEvent(e: AmiMessage): void {
    if (!FAILURE_EVENTS.has(e.Event)) return
    const s = this.settings()
    const ip = remoteIp(e.RemoteAddress)
    if (!s.ban_enabled || !ip || inList(ip, ['127.0.0.1', ...s.whitelist]) || this.bans.some((b) => b.ip === ip)) return
    const now = Date.now()
    const list = (this.failures.get(ip) ?? []).filter((t) => t > now - s.ban_window * 60000)
    list.push(now)
    this.failures.set(ip, list)
    if (list.length >= s.ban_after) {
      this.failures.delete(ip)
      this.ban(ip, `${list.length} Fehlanmeldungen (${e.AccountID ?? e.Event})`, s.ban_minutes)
    }
  }

  ban(ip: string, reason: string, minutes: number): void {
    this.bans = [...this.bans.filter((b) => b.ip !== ip), { ip, reason, until: Date.now() + minutes * 60000 }]
    console.log(`Gesperrt: ${ip} – ${reason}`)
    this.persist()
  }

  unban(ip: string): void {
    this.bans = this.bans.filter((b) => b.ip !== ip)
    this.persist()
  }

  private expire(): void {
    const now = Date.now()
    if (this.bans.some((b) => b.until <= now)) {
      this.bans = this.bans.filter((b) => b.until > now)
      this.persist()
    }
  }

  private persist(): void {
    saveJson(BANS_FILE, this.bans)
    this.emit('changed')
  }
}
