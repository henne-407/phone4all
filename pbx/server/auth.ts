/** Anmeldung an der Weboberfläche: ein Administrator-Passwort, Sitzungen im Speicher. */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { loadJson, saveJson } from './files'
import { PATHS, SETTINGS } from './paths'
import { newSecret } from './store'

const SESSION_HOURS = 12
const MAX_FAILURES = 10
const FAILURE_WINDOW = 15 * 60000

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
  private failures = new Map<string, number[]>()

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

  /** true, wenn diese Adresse zu oft falsch angemeldet hat */
  blocked(ip: string): boolean {
    const now = Date.now()
    const list = (this.failures.get(ip) ?? []).filter((t) => t > now - FAILURE_WINDOW)
    this.failures.set(ip, list)
    return list.length >= MAX_FAILURES
  }

  failed(ip: string): void {
    this.failures.set(ip, [...(this.failures.get(ip) ?? []), Date.now()])
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
