/**
 * Sicherung auf einem anderen Speicher: Die tägliche Sicherung (Konfiguration mit
 * Passwörtern, Ansagen, Wartemusik und Kalendern) geht zusätzlich per WebDAV (z. B.
 * Nextcloud, Synology) oder S3 (AWS, Hetzner, MinIO, Backblaze) aus dem Haus.
 * Gepackt mit gzip, auf Wunsch mit AES-256-GCM verschlüsselt (Schlüssel per scrypt
 * aus dem Kennwort). Ohne fremde Bibliotheken; S3-Anfragen signiert nach AWS SigV4.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { OffsiteSettings } from './model'

const MAGIC = Buffer.from('P4AENC1\n')
const PREFIX = 'phone4all-'

export class OffsiteError extends Error {}

// -- Packen und Verschlüsseln ---------------------------------------------------------

function key(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}

/** JSON → gzip, mit Kennwort zusätzlich verschlüsselt (MAGIC, Salt, IV, Daten, Tag) */
export function pack(json: string, passphrase: string): Buffer {
  const gz = gzipSync(Buffer.from(json))
  if (!passphrase) return gz
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(passphrase, salt), iv)
  const data = Buffer.concat([cipher.update(gz), cipher.final()])
  return Buffer.concat([MAGIC, salt, iv, data, cipher.getAuthTag()])
}

export function unpack(data: Buffer, passphrase: string): string {
  let gz = data
  if (data.subarray(0, MAGIC.length).equals(MAGIC)) {
    if (!passphrase) throw new OffsiteError('Die Sicherung ist verschlüsselt. Bitte das Kennwort eintragen.')
    const salt = data.subarray(MAGIC.length, MAGIC.length + 16)
    const iv = data.subarray(MAGIC.length + 16, MAGIC.length + 28)
    const tag = data.subarray(data.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', key(passphrase, salt), iv)
    decipher.setAuthTag(tag)
    try {
      gz = Buffer.concat([decipher.update(data.subarray(MAGIC.length + 28, data.length - 16)), decipher.final()])
    } catch {
      throw new OffsiteError('Das Kennwort passt nicht zu dieser Sicherung.')
    }
  }
  try {
    return gunzipSync(gz).toString('utf8')
  } catch {
    throw new OffsiteError('Die Datei ist keine Sicherung von Phone4all.')
  }
}

/** Dateiname mit Zeitstempel; sortiert alphabetisch = zeitlich */
export function fileName(date: Date, encrypted: boolean): string {
  const stamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${PREFIX}${stamp}.json.gz${encrypted ? '.enc' : ''}`
}

// -- Ziele ----------------------------------------------------------------------------

export interface RemoteFile {
  name: string
  size: number
}

export interface Target {
  put(name: string, data: Buffer): Promise<void>
  get(name: string): Promise<Buffer>
  list(): Promise<RemoteFile[]>
  remove(name: string): Promise<void>
}

type Fetch = typeof fetch

async function check(r: Response, what: string): Promise<Response> {
  if (r.ok) return r
  const hint =
    r.status === 401 || r.status === 403
      ? 'Anmeldung abgelehnt – Benutzer und Passwort bzw. Schlüssel prüfen.'
      : r.status === 404
        ? 'Ordner oder Bucket nicht gefunden.'
        : r.status === 507
          ? 'Kein Platz mehr am Ziel.'
          : ''
  throw new OffsiteError(`${what}: HTTP ${r.status}${hint ? ` – ${hint}` : ''}`)
}

function encodePath(p: string): string {
  return p
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/')
}

export class WebDavTarget implements Target {
  private base: string
  private auth: string
  private folderReady = false

  constructor(
    private s: OffsiteSettings,
    private send: Fetch = fetch,
  ) {
    const folder = encodePath(s.folder)
    this.base = `${s.url.replace(/\/+$/, '')}/${folder ? `${folder}/` : ''}`
    this.auth = s.user ? `Basic ${Buffer.from(`${s.user}:${s.password}`).toString('base64')}` : ''
  }

  private req(method: string, url: string, body?: Buffer, headers: Record<string, string> = {}): Promise<Response> {
    return this.send(url, {
      method,
      headers: { ...(this.auth ? { Authorization: this.auth } : {}), ...headers },
      body,
      signal: AbortSignal.timeout(120000),
    })
  }

  private async ensureFolder(): Promise<void> {
    if (this.folderReady) return
    // Ordner Schritt für Schritt anlegen; vorhandene antworten mit 405
    const root = this.s.url.replace(/\/+$/, '')
    let url = root
    for (const part of this.s.folder.split('/').filter(Boolean)) {
      url += `/${encodeURIComponent(part)}`
      const r = await this.req('MKCOL', `${url}/`)
      if (!r.ok && r.status !== 405 && r.status !== 301) await check(r, 'Ordner anlegen')
    }
    this.folderReady = true
  }

  async put(name: string, data: Buffer): Promise<void> {
    await this.ensureFolder()
    await check(await this.req('PUT', this.base + encodeURIComponent(name), data, { 'Content-Type': 'application/octet-stream' }), 'Hochladen')
  }

  async get(name: string): Promise<Buffer> {
    const r = await check(await this.req('GET', this.base + encodeURIComponent(name)), 'Herunterladen')
    return Buffer.from(await r.arrayBuffer())
  }

  async list(): Promise<RemoteFile[]> {
    const r = await this.req('PROPFIND', this.base, Buffer.from('<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/></d:prop></d:propfind>'), {
      Depth: '1',
      'Content-Type': 'application/xml',
    })
    if (r.status === 404) return []
    return parsePropfind(await (await check(r, 'Liste lesen')).text())
  }

  async remove(name: string): Promise<void> {
    const r = await this.req('DELETE', this.base + encodeURIComponent(name))
    if (r.status !== 404) await check(r, 'Löschen')
  }
}

/** Antwort von PROPFIND → Dateien von Phone4all (Namensraum-Präfix egal) */
export function parsePropfind(xml: string): RemoteFile[] {
  const files: RemoteFile[] = []
  for (const block of xml.split(/<(?:[\w-]+:)?response[\s>]/i).slice(1)) {
    const href = /<(?:[\w-]+:)?href>([^<]*)</i.exec(block)?.[1] ?? ''
    const name = decodeURIComponent(href.replace(/\/+$/, '').split('/').pop() ?? '')
    if (!name.startsWith(PREFIX)) continue
    const size = Number(/<(?:[\w-]+:)?getcontentlength>(\d+)</i.exec(block)?.[1] ?? 0)
    files.push({ name, size })
  }
  return files.sort((a, b) => b.name.localeCompare(a.name))
}

// -- S3 (SigV4) -------------------------------------------------------------------------

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
const hmac = (k: Buffer | string, data: string): Buffer => createHmac('sha256', k).update(data).digest()

/** RFC 3986 wie von AWS verlangt */
function awsEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export interface SignInput {
  method: string
  url: URL
  region: string
  accessKey: string
  secretKey: string
  body: Buffer | string
  date: Date
  headers?: Record<string, string>
}

/** Kopfzeilen mit AWS-Signatur Version 4 (Dienst s3) */
export function signS3(i: SignInput): Record<string, string> {
  const amzDate = i.date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const payload = sha256(i.body)
  const headers: Record<string, string> = { ...(i.headers ?? {}), host: i.url.host, 'x-amz-content-sha256': payload, 'x-amz-date': amzDate }
  const names = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort()
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]))
  const query = [...i.url.searchParams.entries()]
    .map(([k, v]) => [awsEncode(k), awsEncode(v)])
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const canonical = [i.method, i.url.pathname, query, names.map((n) => `${n}:${lower[n]}\n`).join(''), names.join(';'), payload].join('\n')
  const scope = `${day}/${i.region}/s3/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${i.secretKey}`, day), i.region), 's3'), 'aws4_request')
  const sig = createHmac('sha256', kSigning).update(toSign).digest('hex')
  const { host: _host, ...rest } = headers
  return { ...rest, Authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` }
}

export class S3Target implements Target {
  constructor(
    private s: OffsiteSettings,
    private send: Fetch = fetch,
  ) {}

  private key(name: string): string {
    return [this.s.folder, name].filter(Boolean).join('/')
  }

  private url(key: string, query: Record<string, string> = {}): URL {
    // Pfad-Adressierung funktioniert bei allen S3-kompatiblen Diensten
    const path = key ? `/${key.split('/').map(awsEncode).join('/')}` : ''
    const u = new URL(`${this.s.url.replace(/\/+$/, '')}/${this.s.bucket}${path}`)
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
    return u
  }

  private req(method: string, url: URL, body: Buffer = Buffer.alloc(0)): Promise<Response> {
    const headers = signS3({ method, url, region: this.s.region || 'us-east-1', accessKey: this.s.user, secretKey: this.s.password, body, date: new Date() })
    return this.send(url, { method, headers, body: method === 'PUT' ? body : undefined, signal: AbortSignal.timeout(120000) })
  }

  async put(name: string, data: Buffer): Promise<void> {
    await check(await this.req('PUT', this.url(this.key(name)), data), 'Hochladen')
  }

  async get(name: string): Promise<Buffer> {
    const r = await check(await this.req('GET', this.url(this.key(name))), 'Herunterladen')
    return Buffer.from(await r.arrayBuffer())
  }

  async list(): Promise<RemoteFile[]> {
    const prefix = this.key(PREFIX)
    const r = await check(await this.req('GET', this.url('', { 'list-type': '2', prefix })), 'Liste lesen')
    return parseS3List(await r.text())
  }

  async remove(name: string): Promise<void> {
    await check(await this.req('DELETE', this.url(this.key(name))), 'Löschen')
  }
}

export function parseS3List(xml: string): RemoteFile[] {
  const files: RemoteFile[] = []
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = /<Key>([^<]*)<\/Key>/.exec(m[1])?.[1] ?? ''
    const name = key.split('/').pop() ?? ''
    if (!name.startsWith(PREFIX)) continue
    files.push({ name, size: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0) })
  }
  return files.sort((a, b) => b.name.localeCompare(a.name))
}

export function target(s: OffsiteSettings, send: Fetch = fetch): Target {
  return s.type === 's3' ? new S3Target(s, send) : new WebDavTarget(s, send)
}

// -- Ablauf ---------------------------------------------------------------------------

export interface OffsiteStatus {
  /** Letzter Versuch (ms, 0 = noch nie) */
  time: number
  ok: boolean
  file: string
  error: string
}

/** Sicherung hochladen und alte am Ziel löschen; gibt den Dateinamen zurück */
export async function upload(s: OffsiteSettings, json: string, now = new Date(), send: Fetch = fetch): Promise<string> {
  const t = target(s, send)
  const name = fileName(now, Boolean(s.passphrase))
  await t.put(name, pack(json, s.passphrase))
  const files = await t.list()
  for (const old of files.slice(Math.max(1, s.keep))) await t.remove(old.name)
  return name
}

export async function download(s: OffsiteSettings, name: string, send: Fetch = fetch): Promise<string> {
  if (!name.startsWith(PREFIX) || /[/\\]/.test(name)) throw new OffsiteError('Ungültiger Dateiname.')
  return unpack(await target(s, send).get(name), s.passphrase)
}
