/** Kleiner HTTP-Router auf Basis von node:http (keine Abhängigkeiten). */

import fs from 'node:fs'
import type http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { inList } from './security'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface Request {
  raw: http.IncomingMessage
  res: http.ServerResponse
  method: string
  path: string
  query: URLSearchParams
  params: Record<string, string>
  ip: string
  cookies: Record<string, string>
  body(): Promise<Buffer>
  json<T>(): Promise<T>
}

/** Rückgabe eines Handlers: JSON, Text oder bereits beantwortet (undefined) */
export type Handler = (req: Request) => Promise<unknown> | unknown

interface Route {
  method: string
  pattern: RegExp
  keys: string[]
  handler: Handler
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.wav': 'audio/wav',
}

export function mimeOf(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

export class Router {
  private routes: Route[] = []

  on(method: string, route: string, handler: Handler): void {
    const keys: string[] = []
    const pattern = new RegExp(
      '^' + route.replace(/:(\w+)/g, (_m, k: string) => {
        keys.push(k)
        return '([^/]+)'
      }) + '$',
    )
    this.routes.push({ method, pattern, keys, handler })
  }

  get = (r: string, h: Handler): void => this.on('GET', r, h)
  post = (r: string, h: Handler): void => this.on('POST', r, h)
  put = (r: string, h: Handler): void => this.on('PUT', r, h)
  delete = (r: string, h: Handler): void => this.on('DELETE', r, h)

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    for (const r of this.routes) {
      if (r.method !== method) continue
      const m = r.pattern.exec(pathname)
      if (m) {
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decode(m[i + 1])]))
        return { handler: r.handler, params }
      }
    }
    return null
  }
}

/** Proxys, deren X-Forwarded-For gilt (Adressen oder IPv4-Netze); Standard: lokal und Docker-Netze */
export const DEFAULT_TRUSTED_PROXIES = ['127.0.0.1', '::1', '172.16.0.0/12']
let trustedProxies: () => string[] = () => DEFAULT_TRUSTED_PROXIES

export function setTrustedProxies(get: () => string[]): void {
  trustedProxies = get
}

/** Pfadteil entschlüsseln; kaputte %-Folgen sind ein Fehler der Anfrage, kein Absturz */
function decode(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    throw new HttpError(400, 'Ungültige Adresse.')
  }
}

/**
 * Absender mit X-Forwarded-For, denen nicht vertraut wird (Adresse → Zeitpunkt). Die
 * Weboberfläche schlägt sie als Proxy vor, falls Pangolin o. Ä. dort verbindet.
 */
export const proxyHints = new Map<string, number>()

function noteHint(ip: string): void {
  proxyHints.delete(ip)
  proxyHints.set(ip, Date.now())
  if (proxyHints.size > 10) proxyHints.delete(proxyHints.keys().next().value!)
}

/** Direkte Adresse der Verbindung (ohne Kopfzeilen) */
export function socketIp(raw: http.IncomingMessage): string {
  return (raw.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
}

/**
 * Adresse des Aufrufers. Kommt die Verbindung von einem eingetragenen Proxy, zählt der
 * letzte Eintrag in X-Forwarded-For – den hat der Proxy selbst angehängt, frühere
 * Einträge kann der Aufrufer fälschen. Allen anderen wird die Kopfzeile nicht geglaubt.
 */
export function clientIp(raw: http.IncomingMessage): string {
  const direct = socketIp(raw)
  const fwd = raw.headers['x-forwarded-for']
  if (!fwd) return direct
  if (!inList(direct, trustedProxies())) {
    noteHint(direct)
    return direct
  }
  const list = (Array.isArray(fwd) ? fwd.join(',') : fwd).split(',').map((s) => s.trim()).filter(Boolean)
  const last = (list.at(-1) ?? '').replace(/^::ffff:/, '')
  return net.isIP(last) ? last : direct
}

export function makeRequest(raw: http.IncomingMessage, res: http.ServerResponse, limit: number): Request {
  const url = new URL(raw.url ?? '/', 'http://localhost')
  const cookies = Object.fromEntries(
    (raw.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter((p) => p.length === 2),
  )
  let cached: Promise<Buffer> | null = null
  const body = (): Promise<Buffer> =>
    (cached ??= new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      raw.on('data', (c: Buffer) => {
        size += c.length
        if (size > limit) {
          reject(new HttpError(413, 'Die Datei ist zu groß.'))
          raw.destroy()
        } else chunks.push(c)
      })
      raw.on('end', () => resolve(Buffer.concat(chunks)))
      raw.on('error', reject)
    }))
  return {
    raw,
    res,
    method: raw.method ?? 'GET',
    path: url.pathname,
    query: url.searchParams,
    params: {},
    ip: clientIp(raw),
    cookies,
    body,
    json: async <T>() => {
      const b = await body()
      try {
        return JSON.parse(b.toString('utf8') || 'null') as T
      } catch {
        throw new HttpError(400, 'Ungültige Daten.')
      }
    },
  }
}

export function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

export function sendText(res: http.ServerResponse, status: number, text: string, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(text)
}

export function sendFile(res: http.ServerResponse, file: string, download?: string): void {
  if (!fs.existsSync(file)) throw new HttpError(404, 'Datei nicht gefunden.')
  const st = fs.statSync(file)
  if (!st.isFile()) throw new HttpError(404, 'Datei nicht gefunden.')
  res.writeHead(200, {
    'Content-Type': mimeOf(file),
    'Content-Length': st.size,
    'X-Content-Type-Options': 'nosniff',
    ...(download ? { 'Content-Disposition': `attachment; filename="${download}"` } : {}),
  })
  fs.createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res)
}

/** Nur eigene Skripte; Stile inline wegen MUI (emotion) */
export const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/** Dateien der Weboberfläche; unbekannte Pfade liefern index.html (Single-Page-App). */
export function serveStatic(root: string, pathname: string, res: http.ServerResponse): void {
  const rel = path.normalize(decode(pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = path.join(root, rel)
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html')
  if (!fs.existsSync(file)) {
    sendText(res, 404, 'Weboberfläche nicht gebaut (npm run build:web).')
    return
  }
  const immutable = file.includes(`${path.sep}assets${path.sep}`)
  res.writeHead(200, {
    'Content-Type': mimeOf(file),
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': WEB_CSP,
  })
  fs.createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res)
}
