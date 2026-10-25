/** WebDAV-Grundlagen für CalDAV und CardDAV: Anfragen mit Basic-/Digest-Anmeldung, PROPFIND. */

import { XMLParser } from 'fast-xml-parser'
import { createHash, randomBytes } from 'node:crypto'

export class DavError extends Error {}

/** Fehlermeldung für die Oberfläche */
export function errorText(e: unknown): string {
  if (e instanceof DavError) return e.message
  if (e instanceof Error) return `${e.name}: ${e.message}`
  return String(e)
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['response', 'propstat', 'privilege', 'comp', 'href'].includes(name),
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type XmlNode = any

export function parseXml(text: string): XmlNode {
  try {
    return parser.parse(text)
  } catch {
    throw new DavError('Ungültige Antwort vom Server – ist die URL richtig?')
  }
}

export function textOf(node: XmlNode): string {
  if (node === undefined || node === null) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return textOf(node[0])
  if (typeof node === 'object' && '#text' in node) return String(node['#text'])
  return ''
}

/** <d:prop><x:href>…</x:href></d:prop> -> href */
export function hrefOf(prop: XmlNode): string | null {
  if (!prop || typeof prop !== 'object') return null
  const h = textOf(prop.href)
  return h ? h.trim() : null
}

export function hasChild(node: XmlNode, name: string): boolean {
  return Boolean(node && typeof node === 'object' && name in node)
}

export interface DavConf {
  id: string
  name: string
  url: string
  user: string
}

export interface PropResult {
  href: string
  props: Record<string, XmlNode>
}

function md5(s: string): string {
  return createHash('md5').update(s).digest('hex')
}

export function normalizeUrl(raw: string): string {
  const url = raw.trim()
  return /^https?:\/\//i.test(url) ? url : 'https://' + url
}

export class DavClient {
  private digest: Record<string, string> | null = null
  private nc = 0

  constructor(
    readonly conf: DavConf,
    private password: string,
  ) {}

  private digestHeader(method: string, url: string): string {
    const d = this.digest!
    const uri = new URL(url).pathname + new URL(url).search
    const realm = d.realm ?? ''
    const ha1 = md5(`${this.conf.user}:${realm}:${this.password}`)
    const ha2 = md5(`${method}:${uri}`)
    const nc = (++this.nc).toString(16).padStart(8, '0')
    const cnonce = randomBytes(8).toString('hex')
    const qop = d.qop?.split(',').map((q) => q.trim()).includes('auth') ? 'auth' : ''
    const response = qop ? md5(`${ha1}:${d.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${d.nonce}:${ha2}`)
    const parts = [
      `username="${this.conf.user}"`,
      `realm="${realm}"`,
      `nonce="${d.nonce}"`,
      `uri="${uri}"`,
      `response="${response}"`,
    ]
    if (d.opaque) parts.push(`opaque="${d.opaque}"`)
    if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`)
    return 'Digest ' + parts.join(', ')
  }

  private authHeader(method: string, url: string): string {
    if (this.digest) return this.digestHeader(method, url)
    return 'Basic ' + Buffer.from(`${this.conf.user}:${this.password}`).toString('base64')
  }

  async request(
    method: string,
    url: string,
    body?: string,
    depth?: number,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const send = (): Promise<Response> =>
      fetch(url, {
        method,
        body,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'User-Agent': 'Phone4All',
          Authorization: this.authHeader(method, url),
          ...(depth !== undefined ? { Depth: String(depth) } : {}),
          ...headers,
        },
        signal: AbortSignal.timeout(20000),
      })
    let r: Response
    try {
      r = await send()
      const challenge = r.headers.get('www-authenticate') ?? ''
      if (r.status === 401 && !this.digest && /digest/i.test(challenge)) {
        this.digest = Object.fromEntries(
          [...challenge.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)].map((m) => [m[1].toLowerCase(), m[2] ?? m[3]]),
        )
        r = await send()
      }
    } catch (e) {
      throw new DavError(`Server nicht erreichbar: ${(e as Error).cause ? String((e as Error).cause) : (e as Error).name}`)
    }
    if (r.status === 401) throw new DavError('Anmeldung fehlgeschlagen – Benutzername oder Passwort falsch')
    if (r.status === 412) throw new DavError('Der Termin wurde inzwischen anderswo geändert – bitte neu laden')
    if (r.status >= 400) throw new DavError(`Serverfehler ${r.status} bei ${method}`)
    return r
  }

  async propfind(url: string, body: string, depth: number): Promise<PropResult[]> {
    const r = await this.request('PROPFIND', url, body, depth)
    const root = parseXml(await r.text())
    const responses: XmlNode[] = root?.multistatus?.response ?? []
    return responses.map((resp) => {
      const href = new URL(textOf(resp.href).trim(), r.url).toString()
      const props: Record<string, XmlNode> = {}
      for (const ps of resp.propstat ?? []) {
        const status = textOf(ps.status) || ' 200'
        if (status.includes(' 200') && ps.prop && typeof ps.prop === 'object') Object.assign(props, ps.prop)
      }
      return { href, props }
    })
  }

  /** Findet die Home-Collection (calendar-home-set / addressbook-home-set) oder direkt eine Collection. */
  async discover(
    wellKnown: string,
    propfindBody: string,
    homeProp: string,
    collectionType: string,
  ): Promise<{ home: string | null; collection: string | null }> {
    const url = normalizeUrl(this.conf.url)
    const parsed = new URL(url)
    let lastError: DavError | null = null
    for (const candidate of [url, `${parsed.protocol}//${parsed.host}/.well-known/${wellKnown}`]) {
      let items: PropResult[]
      try {
        items = await this.propfind(candidate, propfindBody, 0)
      } catch (e) {
        if (!(e instanceof DavError)) throw e
        lastError = e
        continue
      }
      if (!items.length) continue
      const { href: base, props } = items[0]
      if (hasChild(props.resourcetype, collectionType)) return { home: null, collection: base }
      let home = hrefOf(props[homeProp])
      const principal = hrefOf(props['current-user-principal'])
      if (!home && principal) {
        const pItems = await this.propfind(new URL(principal, base).toString(), propfindBody, 0)
        if (pItems.length) home = hrefOf(pItems[0].props[homeProp])
      }
      if (home) return { home: new URL(home, base).toString(), collection: null }
    }
    if (lastError) throw lastError
    return { home: null, collection: null }
  }
}
