/** Anmeldung an der Weboberfläche: ein Administrator-Passwort, Sitzungen im Speicher. */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import net from 'node:net'
import { loadJson, saveJson } from './files'
import { PATHS, SETTINGS } from './paths'
import { newSecret } from './store'

const SESSION_HOURS = 12
const MAX_FAILURES = 10
const FAILURE_WINDOW = 15 * 60000
/** Höchstens so viele Adressen merken (Schutz vor Speicherüberlauf) */
const MAX_TRACKED = 10000

/** IPv6-Adressen zählen je /64-Netz – darin kann jeder Anschluss beliebig wechseln */
export function limitKey(ip: string): string {
  if (!net.isIPv6(ip)) return ip
  const [head, tail = ''] = ip.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const full = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left
  return full.slice(0, 4).map((h) => h.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64'
}

interface AdminFile {
  salt: string
  hash: string
}

function hash(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex')
}

export class Auth {
  private admin: AdminFile | null = loadJson<AdminFile | null>(PATHS.admin, null)
  private sessions = new Map<string, number>()
  private failures = new Map<string, { time: number; key: string }[]>()
  private counter = 0
  /** Wird aufgerufen, wenn eine Adresse die Grenze erreicht (für die gemeinsame Sperrliste) */
  onBlock: (ip: string, reason: string) => void = () => undefined

  /** Beim ersten Start ein Passwort festlegen und im Log ausgeben. */
  init(): void {
    if (SETTINGS.adminPassword) {
      this.setPassword(SETTINGS.adminPassword)
      return
    }
    if (this.admin) return
    const password = newSecret(12)
    this.setPassword(password)
    console.log('='.repeat(60))
    console.log(`  Erstes Passwort für die Weboberfläche (Benutzer admin): ${password}`)
    console.log('  Bitte nach der Anmeldung unter System → Zugang ändern.')
    console.log('='.repeat(60))
  }

  setPassword(password: string): void {
    const salt = randomBytes(16).toString('hex')
    this.admin = { salt, hash: hash(password, salt) }
    saveJson(PATHS.admin, this.admin)
    this.sessions.clear()
  }

  check(password: string): boolean {
    if (!this.admin) return false
    const a = Buffer.from(hash(password, this.admin.salt), 'hex')
    const b = Buffer.from(this.admin.hash, 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private recent(ip: string): { time: number; key: string }[] {
    const k = limitKey(ip)
    const list = (this.failures.get(k) ?? []).filter((f) => f.time > Date.now() - FAILURE_WINDOW)
    if (list.length) this.failures.set(k, list)
    else this.failures.delete(k)
    return list
  }

  /** true, wenn diese Adresse (bei IPv6 ihr /64-Netz) zu oft Falsches geschickt hat */
  blocked(ip: string): boolean {
    return new Set(this.recent(ip).map((f) => f.key)).size >= MAX_FAILURES
  }

  /**
   * Fehlversuch zählen. Mit `key` zählen gleiche Fehler nur einmal (ein altes Gerät, das
   * immer wieder mit demselben ungültigen Link fragt, ist kein Angriff).
   */
  failed(ip: string, reason = 'Fehlanmeldungen', key?: string): void {
    const was = this.blocked(ip)
    const list = this.recent(ip)
    list.push({ time: Date.now(), key: key ?? String(++this.counter) })
    this.failures.set(limitKey(ip), list)
    if (this.failures.size > MAX_TRACKED) this.failures.delete(this.failures.keys().next().value!)
    if (!was && this.blocked(ip)) this.onBlock(ip, reason)
  }

  login(): string {
    const token = randomBytes(32).toString('hex')
    this.sessions.set(token, Date.now() + SESSION_HOURS * 3600000)
    return token
  }

  logout(token: string): void {
    this.sessions.delete(token)
  }

  valid(token: string | undefined): boolean {
    if (!token) return false
    const until = this.sessions.get(token)
    if (!until || until < Date.now()) {
      this.sessions.delete(token)
      return false
    }
    this.sessions.set(token, Date.now() + SESSION_HOURS * 3600000)
    return true
  }
}

export const SESSION_COOKIE = 'p4a_session'
export const SESSION_MAX_AGE = SESSION_HOURS * 3600
