/**
 * Zentrales Telefonbuch per LDAP (nur lesen) für DECT-Basen und Tischtelefone.
 * Ein kleiner LDAPv3-Server ohne Abhängigkeiten: Anmelden (anonym oder mit Kennwort),
 * Suchen mit den üblichen Filtern, sonst nichts. Alle Einträge liegen flach unter
 * dc=phone4all und haben die Attribute von inetOrgPerson.
 */

import { timingSafeEqual } from 'node:crypto'
import net from 'node:net'
import { directory } from './directory'
import type { PbxConfig } from './model'
import { cleanNumber, toE164 } from './numbers'
import { inList } from './security'

export const LDAP_BASE = 'dc=phone4all'
export const LDAP_USER = `cn=telefonbuch,${LDAP_BASE}`

const MAX_RESULTS = 500

// LDAP-Ergebniscodes (RFC 4511)
const SUCCESS = 0
const PROTOCOL_ERROR = 2
const SIZE_LIMIT = 4
const AUTH_UNKNOWN = 7
const NO_SUCH_OBJECT = 32
const INVALID_CREDENTIALS = 49
const INSUFFICIENT_ACCESS = 50
const UNWILLING = 53

// -- BER (nur was LDAP braucht) ---------------------------------------------------

export interface Ber {
  tag: number
  /** Inhalt (primitiv) */
  value: Buffer
  /** Bestandteile (zusammengesetzt) */
  children: Ber[]
}

function encodeLength(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n])
  const bytes: number[] = []
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

export function tlv(tag: number, content: Buffer | Buffer[]): Buffer {
  const body = Array.isArray(content) ? Buffer.concat(content) : content
  return Buffer.concat([Buffer.from([tag]), encodeLength(body.length), body])
}

export function int(n: number, tag = 0x02): Buffer {
  const bytes: number[] = []
  let v = n
  do {
    bytes.unshift(v & 0xff)
    v = Math.floor(v / 256)
  } while (v > 0)
  if (bytes[0] & 0x80) bytes.unshift(0)
  return tlv(tag, Buffer.from(bytes))
}

export const str = (s: string, tag = 0x04): Buffer => tlv(tag, Buffer.from(s, 'utf8'))
export const seq = (...parts: Buffer[]): Buffer => tlv(0x30, parts)

/**
 * Liest ein Element ab offset. Liefert null, wenn die Daten noch unvollständig sind
 * (TCP liefert Nachrichten in Stücken).
 */
export function readBer(buf: Buffer, offset = 0): { ber: Ber; end: number } | null {
  if (buf.length < offset + 2) return null
  const tag = buf[offset]
  let len = buf[offset + 1]
  let pos = offset + 2
  if (len & 0x80) {
    const n = len & 0x7f
    if (n === 0 || n > 4) throw new Error('Ungültige BER-Länge')
    if (buf.length < pos + n) return null
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + buf[pos + i]
    pos += n
  }
  const end = pos + len
  if (buf.length < end) return null
  const value = buf.subarray(pos, end)
  const children: Ber[] = []
  if (tag & 0x20) {
    let p = 0
    while (p < value.length) {
      const child = readBer(value, p)
      if (!child) throw new Error('Unvollständiges BER-Element')
      children.push(child.ber)
      p = child.end
    }
  }
  return { ber: { tag, value, children }, end }
}

const text = (b: Ber | undefined): string => (b ? b.value.toString('utf8') : '')
const num = (b: Ber | undefined): number => (b ? b.value.reduce((acc, x) => acc * 256 + x, 0) : 0)

// -- Einträge ---------------------------------------------------------------------

export type Attributes = Record<string, string[]>

export interface LdapEntry {
  dn: string
  attrs: Attributes
}

/** Nummer zum Wählen: ohne Leerzeichen und Striche */
const dialable = (n: string): string => cleanNumber(n)

export function entries(cfg: PbxConfig): LdapEntry[] {
  return directory(cfg).map((e) => {
    const name = e.name || e.company
    const words = name.trim().split(/\s+/)
    const sn = words.length > 1 ? words[words.length - 1] : name
    const attrs: Attributes = {
      objectClass: ['top', 'person', 'organizationalPerson', 'inetOrgPerson'],
      uid: [e.id],
      cn: [name],
      displayName: [name],
      sn: [sn],
    }
    if (words.length > 1) attrs.givenName = [words.slice(0, -1).join(' ')]
    if (e.company) attrs.o = [e.company]
    if (e.phone) attrs.telephoneNumber = [dialable(e.phone)]
    if (e.mobile) attrs.mobile = [dialable(e.mobile)]
    return { dn: `uid=${e.id},${LDAP_BASE}`, attrs }
  })
}

const ROOT: LdapEntry = { dn: LDAP_BASE, attrs: { objectClass: ['top', 'dcObject', 'organization'], dc: ['phone4all'], o: ['Phone4all'] } }

/** Root DSE: Clients fragen hier nach dem Suchbereich */
const ROOT_DSE: LdapEntry = { dn: '', attrs: { objectClass: ['top'], namingContexts: [LDAP_BASE], supportedLDAPVersion: ['3'] } }

const PHONE_ATTRS = new Set(['telephonenumber', 'mobile', 'homephone'])

function getAttr(entry: LdapEntry, name: string): string[] {
  const key = Object.keys(entry.attrs).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? entry.attrs[key] : []
}

/** Rufnummern vergleichen: „030 1234567“, „+49301234567“ und „0301234567“ sind gleich */
function phoneKey(n: string, cfg: PbxConfig): string {
  return toE164(n, cfg.system.country_code, cfg.system.area_code).replace(/[^\d+*#]/g, '')
}

function normalize(attr: string, v: string, cfg: PbxConfig): string {
  return PHONE_ATTRS.has(attr.toLowerCase()) ? phoneKey(v, cfg) : v.toLowerCase().trim()
}

/** Filter (RFC 4511, Abschnitt 4.5.1) auf einen Eintrag anwenden */
export function matches(filter: Ber, entry: LdapEntry, cfg: PbxConfig): boolean {
  const c = filter.children
  switch (filter.tag) {
    case 0xa0: // and
      return c.every((f) => matches(f, entry, cfg))
    case 0xa1: // or
      return c.some((f) => matches(f, entry, cfg))
    case 0xa2: // not
      return !matches(c[0], entry, cfg)
    case 0xa3: // equalityMatch
    case 0xa8: {
      // approxMatch
      const attr = text(c[0])
      const want = normalize(attr, text(c[1]), cfg)
      return getAttr(entry, attr).some((v) => normalize(attr, v, cfg) === want)
    }
    case 0xa4: {
      // substrings
      const attr = text(c[0])
      const phone = PHONE_ATTRS.has(attr.toLowerCase())
      const parts = c[1]?.children ?? []
      // Rufnummern mit Teilen vergleichen wir ohne Leerzeichen, nicht nach E.164
      const norm = (s: string): string => (phone ? s.replace(/[^\d+*#]/g, '') : s.toLowerCase())
      return getAttr(entry, attr).some((raw) => {
        const v = norm(raw)
        let pos = 0
        for (const part of parts) {
          const p = norm(text(part))
          if (part.tag === 0x80) {
            if (!v.startsWith(p)) return false
            pos = p.length
          } else if (part.tag === 0x81) {
            const i = v.indexOf(p, pos)
            if (i < 0) return false
            pos = i + p.length
          } else if (part.tag === 0x82) {
            if (v.length - p.length < pos || !v.endsWith(p)) return false
          }
        }
        return true
      })
    }
    case 0x87: // present
      return getAttr(entry, filter.value.toString('utf8')).length > 0
    case 0xa5: // greaterOrEqual
    case 0xa6: {
      // lessOrEqual
      const attr = text(c[0])
      const want = normalize(attr, text(c[1]), cfg)
      return getAttr(entry, attr).some((v) => {
        const cmp = normalize(attr, v, cfg).localeCompare(want)
        return filter.tag === 0xa5 ? cmp >= 0 : cmp <= 0
      })
    }
    default:
      return false
  }
}

const sameDn = (a: string, b: string): boolean => a.replace(/\s/g, '').toLowerCase() === b.replace(/\s/g, '').toLowerCase()

export interface SearchRequest {
  base: string
  /** 0 = nur base, 1 = eine Ebene, 2 = alles darunter */
  scope: number
  sizeLimit: number
  typesOnly: boolean
  filter: Ber
  attributes: string[]
}

export function parseSearch(op: Ber): SearchRequest {
  const c = op.children
  return {
    base: text(c[0]),
    scope: num(c[1]),
    sizeLimit: num(c[3]),
    typesOnly: num(c[5]) !== 0,
    filter: c[6],
    attributes: (c[7]?.children ?? []).map(text),
  }
}

/** Antwort auf eine Suche: Einträge und Ergebniscode */
export function search(cfg: PbxConfig, req: SearchRequest): { found: LdapEntry[]; code: number } {
  let candidates: LdapEntry[]
  if (req.base === '' && req.scope === 0) candidates = [ROOT_DSE]
  else if (sameDn(req.base, LDAP_BASE)) {
    const all = entries(cfg)
    candidates = req.scope === 0 ? [ROOT] : req.scope === 1 ? all : [ROOT, ...all]
  } else {
    const hit = entries(cfg).find((e) => sameDn(e.dn, req.base))
    if (!hit) return { found: [], code: NO_SUCH_OBJECT }
    candidates = [hit]
  }
  const found = candidates.filter((e) => matches(req.filter, e, cfg))
  const limit = Math.min(req.sizeLimit || MAX_RESULTS, MAX_RESULTS)
  if (found.length > limit) return { found: found.slice(0, limit), code: req.sizeLimit && req.sizeLimit <= MAX_RESULTS ? SIZE_LIMIT : SUCCESS }
  return { found, code: SUCCESS }
}

function selectAttrs(entry: LdapEntry, wanted: string[]): [string, string[]][] {
  const all = Object.entries(entry.attrs)
  const list = wanted.filter((w) => w && w !== '1.1')
  if (!list.length || list.includes('*')) return all
  const lower = new Set(list.map((w) => w.toLowerCase()))
  return all.filter(([k]) => lower.has(k.toLowerCase()))
}

export function encodeEntry(id: number, entry: LdapEntry, attributes: string[], typesOnly: boolean): Buffer {
  const attrs = selectAttrs(entry, attributes).map(([k, vals]) => seq(str(k), tlv(0x31, typesOnly ? [] : vals.map((v) => str(v)))))
  return seq(int(id), tlv(0x64, [str(entry.dn), seq(...attrs)]))
}

export function result(id: number, tag: number, code: number, message = ''): Buffer {
  return seq(int(id), tlv(tag, [int(code, 0x0a), str(''), str(message)]))
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Eine LDAP-Nachricht beantworten; liefert die Antworten (leer bei Unbind/Abandon) */
export function respond(cfg: PbxConfig, msg: Ber, session: { bound: boolean }): Buffer[] | 'close' {
  const id = num(msg.children[0])
  const op = msg.children[1]
  if (!op) return 'close'
  const needAuth = Boolean(cfg.ldap.password)
  switch (op.tag) {
    case 0x60: {
      // BindRequest: version, name, simple [0] Kennwort
      const name = text(op.children[1])
      const auth = op.children[2]
      if (auth?.tag !== 0x80) return [result(id, 0x61, AUTH_UNKNOWN, 'Nur einfache Anmeldung')]
      const password = auth.value.toString('utf8')
      if (!name && !password) {
        session.bound = !needAuth
        return [result(id, 0x61, SUCCESS)]
      }
      // Den Namen prüfen wir nicht streng: Telefone schicken „cn=…“, „telefonbuch“ o. Ä.
      // Gigaset-Mobilteile melden sich auf Wunsch mit ihrem SIP-Zugang an.
      const user = name.replace(/^\w+=/, '').split(',')[0]
      const ext = cfg.extensions.find((e) => e.number === user)
      if (!needAuth || sameSecret(password, cfg.ldap.password) || (ext && sameSecret(password, ext.secret))) {
        session.bound = true
        return [result(id, 0x61, SUCCESS)]
      }
      return [result(id, 0x61, INVALID_CREDENTIALS, 'Kennwort falsch')]
    }
    case 0x42: // UnbindRequest
      return 'close'
    case 0x50: // AbandonRequest
      return []
    case 0x63: {
      // SearchRequest
      if (needAuth && !session.bound) return [result(id, 0x65, INSUFFICIENT_ACCESS, 'Bitte anmelden')]
      const req = parseSearch(op)
      const { found, code } = search(cfg, req)
      return [...found.map((e) => encodeEntry(id, e, req.attributes, req.typesOnly)), result(id, 0x65, code)]
    }
    case 0x77: // ExtendedRequest (z. B. StartTLS)
      return [seq(int(id), tlv(0x78, [int(PROTOCOL_ERROR, 0x0a), str(''), str('Nicht unterstützt')]))]
    default: {
      // Ändern, Hinzufügen, Löschen …: Antwort-Tag ist Anfrage + 1
      const app = op.tag & 0x1f
      return [result(id, 0x60 | (app + 1), UNWILLING, 'Das Telefonbuch ist schreibgeschützt')]
    }
  }
}

/** Läuft im Dienst; apply() startet, beendet oder verlegt den Port nach Einstellung. */
export class LdapServer {
  private server: net.Server | null = null
  private port = 0
  /** Für die Weboberfläche: läuft / Fehler beim Start */
  status: { listening: boolean; port: number; error: string } = { listening: false, port: 0, error: '' }

  constructor(private getCfg: () => PbxConfig) {}

  apply(): void {
    const { enabled, port } = this.getCfg().ldap
    if (enabled && this.server && this.port === port) return
    this.stop()
    if (!enabled) return
    this.port = port
    const server = net.createServer((sock) => this.connection(sock))
    this.server = server
    server.on('error', (e: NodeJS.ErrnoException) => {
      this.status = { listening: false, port, error: e.code === 'EADDRINUSE' ? `Port ${port} ist schon belegt.` : e.message }
      console.error('LDAP-Telefonbuch:', e.message)
    })
    server.listen(port, () => {
      this.status = { listening: true, port, error: '' }
      console.log(`LDAP-Telefonbuch auf Port ${port}`)
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.status = { listening: false, port: 0, error: '' }
  }

  private allowed(ip: string): boolean {
    const cfg = this.getCfg()
    const v4 = ip.replace(/^::ffff:/, '')
    if (v4 === '127.0.0.1' || ip === '::1') return true
    const nets = cfg.security.extension_nets.filter(Boolean)
    return inList(v4, nets.length ? nets : cfg.system.local_nets)
  }

  private connection(sock: net.Socket): void {
    if (!this.allowed(sock.remoteAddress ?? '')) {
      sock.destroy()
      return
    }
    const session = { bound: false }
    let buf = Buffer.alloc(0)
    sock.setTimeout(60000, () => sock.destroy())
    sock.on('error', () => sock.destroy())
    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      if (buf.length > 64 * 1024) {
        sock.destroy()
        return
      }
      try {
        for (;;) {
          const r = readBer(buf)
          if (!r) break
          buf = buf.subarray(r.end)
          const out = respond(this.getCfg(), r.ber, session)
          if (out === 'close') {
            sock.end()
            return
          }
          for (const b of out) sock.write(b)
        }
      } catch {
        sock.destroy()
      }
    })
  }
}
