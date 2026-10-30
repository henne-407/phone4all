/**
 * Zugänge zur Weboberfläche. „admin“ (Passwort aus admin.json) gibt es immer; dazu
 * beliebig viele weitere mit eigener Rolle:
 *
 *   admin     alles
 *   operator  Personen und Anrufe: Nebenstellen, Gruppen, Telefone, Kontakte, Sperren,
 *             Konferenzen, Fax, Anrufliste – nicht Rufabfolgen, SIP-Konten, System
 *   viewer    nur ansehen (ohne Passwörter)
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { loadJson, saveJson } from './files'
import { newId } from './store'

export type Role = 'admin' | 'operator' | 'viewer'

export const ROLES: [Role, string, string][] = [
  ['admin', 'Verwaltung', 'Alles, auch SIP-Konten, System und Zugänge'],
  ['operator', 'Personen und Anrufe', 'Nebenstellen, Gruppen, Telefone, Kontakte, Sperren, Konferenzen, Fax und Anruflisten'],
  ['viewer', 'Nur ansehen', 'Alles ansehen, nichts ändern; Passwörter bleiben verborgen'],
]

export interface User {
  id: string
  /** Anmeldename (klein, ohne Leerzeichen) */
  login: string
  name: string
  role: Role
  salt: string
  hash: string
  created: number
  /** Letzte Anmeldung (ms) */
  last: number
}

export type PublicUser = Omit<User, 'salt' | 'hash'>

export class UserError extends Error {}

function hash(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex')
}

function same(password: string, salt: string, expected: string): boolean {
  const a = Buffer.from(hash(password, salt), 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export const PASSWORD_MIN = 10

/** Pfade, die „Personen und Anrufe“ ändern darf */
const OPERATOR_WRITE = [
  /^\/api\/(extensions|groups|dect|deskphones|phonebook|blocklist|conferences|faxes|missed|bosses|reminders)(\/|$)/,
  /^\/api\/(logout|password)$/,
]

/** Nur für Verwaltung, auch lesend (Passwörter, Protokolle, Sicherungen, Zugänge) */
const ADMIN_READ = [/^\/api\/(export|backups|log|debug|audit|users|offsite|integration\/token|(monitoring|wallboard|sms)\/token)(\/|$)/]

/** Darf diese Rolle die Anfrage stellen? Sonst Fehlertext. */
/** Enthält SIP-Passwörter oder Einrichtungslinks: nicht für „Nur ansehen“ */
const SECRET_READ = [/^\/api\/extensions\/[^/]+\/provisioning$/, /^\/api\/(dect|deskphones)\/[^/]+\/file$/]

export function forbidden(role: Role, method: string, path: string): string {
  if (role === 'admin') return ''
  if (ADMIN_READ.some((re) => re.test(path))) return 'Das darf nur die Verwaltung.'
  if (role === 'viewer' && SECRET_READ.some((re) => re.test(path))) return 'Dieser Zugang darf keine Zugangsdaten sehen.'
  if (method === 'GET' || method === 'HEAD') return ''
  if (role === 'viewer') return /^\/api\/(logout|password)$/.test(path) ? '' : 'Dieser Zugang darf nur ansehen.'
  return OPERATOR_WRITE.some((re) => re.test(path)) ? '' : 'Dafür fehlt die Berechtigung (nur Personen und Anrufe).'
}

export class UserStore {
  private users: User[]

  constructor(private file: string) {
    this.users = loadJson<User[]>(file, [])
  }

  private save(): void {
    saveJson(this.file, this.users)
  }

  list(): PublicUser[] {
    return this.users.map(({ salt: _s, hash: _h, ...u }) => u)
  }

  find(login: string): User | undefined {
    return this.users.find((u) => u.login === login.trim().toLowerCase())
  }

  get(id: string): User | undefined {
    return this.users.find((u) => u.id === id)
  }

  /** Prüft das Passwort; null bei Fehler (immer gleich lange Rechenzeit) */
  check(login: string, password: string): User | null {
    const u = this.find(login)
    if (!u) {
      same(password, 'x'.repeat(32), '0'.repeat(64))
      return null
    }
    if (!same(password, u.salt, u.hash)) return null
    u.last = Date.now()
    this.save()
    return u
  }

  private validate(login: string, name: string, role: Role, exceptId = ''): string {
    const l = login.trim().toLowerCase()
    if (!/^[a-z0-9._-]{2,32}$/.test(l)) throw new UserError('Anmeldename: 2–32 Zeichen, nur Buchstaben a–z, Ziffern, Punkt, Strich.')
    if (l === 'admin') throw new UserError('„admin“ ist für den eingebauten Zugang reserviert.')
    if (this.users.some((u) => u.login === l && u.id !== exceptId)) throw new UserError(`Den Anmeldenamen „${l}“ gibt es schon.`)
    if (!ROLES.some(([r]) => r === role)) throw new UserError('Unbekannte Rolle.')
    if (name.length > 60) throw new UserError('Der Name ist zu lang.')
    return l
  }

  add(login: string, name: string, role: Role, password: string): PublicUser {
    const l = this.validate(login, name, role)
    if (password.length < PASSWORD_MIN) throw new UserError(`Das Passwort braucht mindestens ${PASSWORD_MIN} Zeichen.`)
    const salt = randomBytes(16).toString('hex')
    const user: User = { id: newId(), login: l, name: name.trim(), role, salt, hash: hash(password, salt), created: Date.now(), last: 0 }
    this.users.push(user)
    this.save()
    return this.list().find((u) => u.id === user.id)!
  }

  update(id: string, patch: { login?: string; name?: string; role?: Role; password?: string }): PublicUser {
    const u = this.get(id)
    if (!u) throw new UserError('Zugang nicht gefunden.')
    const login = this.validate(patch.login ?? u.login, patch.name ?? u.name, patch.role ?? u.role, id)
    if (patch.password) {
      if (patch.password.length < PASSWORD_MIN) throw new UserError(`Das Passwort braucht mindestens ${PASSWORD_MIN} Zeichen.`)
      u.salt = randomBytes(16).toString('hex')
      u.hash = hash(patch.password, u.salt)
    }
    Object.assign(u, { login, name: (patch.name ?? u.name).trim(), role: patch.role ?? u.role })
    this.save()
    return this.list().find((x) => x.id === id)!
  }

  remove(id: string): void {
    this.users = this.users.filter((u) => u.id !== id)
    this.save()
  }
}
