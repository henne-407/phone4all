/**
 * Automatische Einrichtung der Phone4All-App: Die App holt über einen
 * Einrichtungslink (oder Nebenstelle + PIN) ihr Konto und das Telefonbuch.
 * Im LAN findet sie die Anlage per UDP-Broadcast (Port 15060).
 */

import { createHash } from 'node:crypto'
import dgram from 'node:dgram'
import { directory } from './directory'
import { messengerUsers } from './messenger'
import type { AppHomeCard, AppPage, AppPermission, CentralCalendar, Extension, PbxConfig } from './model'
import { SETTINGS } from './paths'
import { type IceServer, appEndpoint, publicBase, videoEnabled, videoEndpoint, websocketUrl } from './remote'
import { appPermissions } from './routing'
import { parkingNumbers } from './store'

export const DISCOVERY_PORT = 15060
export const PROVISIONING_FORMAT = 'phone4all-provisioning'

export interface ProvisioningProfile {
  format: typeof PROVISIONING_FORMAT
  version: 1
  pbx: { name: string; version: string }
  extension: string
  /** Felder wie AccountSettings der App */
  account: {
    display_name: string
    user: string
    domain: string
    auth_user: string
    port: number
    local_port: number
    transport: 'udp' | 'tcp' | 'tls'
    outbound: string
    stun: string
    mediaenc: string
    regint: number
  }
  password: string
  /** Adresse, unter der die App das Profil später erneut abruft */
  url: string
  /** id nur bei Einträgen, die diese Nebenstelle bearbeiten darf (Recht phonebook_edit) */
  phonebook: { name: string; company: string; phone: string; mobile: string; id?: string }[]
  features: Record<string, string>
  /** Vorgaben für die Ansichten der App (null = keine) */
  app: AppPolicy | null
  /** Zentrale Kalender, Termine unter <url>/events */
  calendars: { id: string; name: string; color: string; writable: boolean }[]
  /** Was die App einstellen darf; Umleitungen unter <url>/forward */
  permissions: AppPermission[]
  /** Messenger freigegeben; die App verbindet sich mit <url>/chat (WebSocket) */
  messenger: boolean
  /** Zugang von unterwegs für die Mobil-App (SIP über WebSocket, WebRTC), null = aus */
  remote: RemoteAccount | null
  /** Videoanrufe im Messenger (Benutzer <nummer>-video, ruft sip:<raum>@<domain>), null = aus */
  video: RemoteAccount | null
  /** Gespräche parken: Weiterleiten auf number parkt, slots holen zurück (null = aus) */
  parking: { number: string; slots: string[] } | null
  /** Anrufer im CRM öffnen: Adresse mit {nummer}, {e164}, {name} (null = aus) */
  crm: { url: string; auto: boolean } | null
  /** Voicemail in der App unter <url>/voicemail; Besetztanzeige unter <url>/presence */
  voicemail: boolean
  /** Türsprechstellen: im Gespräch mit number öffnet dtmf die Tür */
  doors: { number: string; name: string; dtmf: string }[]
  /** Ändert sich mit jeder Änderung am Profil; die App fragt <url>/revision ab */
  revision: string
}

export interface RemoteAccount {
  /** wss://telefon.example.de/ws */
  websocket: string
  /** SIP-Benutzer und Anmeldename der App (<nummer>-app), Passwort wie password */
  user: string
  /** Domain für SIP-Adressen (sip:<nummer>@<domain>) */
  domain: string
  /** STUN/TURN-Server für die Sprache (RTCIceServer) */
  ice_servers: IceServer[]
}

export interface AppPolicy {
  pages: AppPage[]
  start_tab: AppPage
  home_cards: AppHomeCard[]
  lock_layout: boolean
  lock_account: boolean
}

/** Kalender, die eine Nebenstelle sieht (über ihr App-Profil eingeschränkt) */
export function visibleCalendars(cfg: PbxConfig, ext: Extension): CentralCalendar[] {
  const p = cfg.appprofiles.find((x) => x.id === ext.app_profile)
  return cfg.calendars.filter((c) => !p?.calendars.length || p.calendars.includes(c.id))
}

function policy(cfg: PbxConfig, ext: Extension): AppPolicy | null {
  const p = cfg.appprofiles.find((x) => x.id === ext.app_profile)
  if (!p) return null
  return { pages: p.pages, start_tab: p.start_tab, home_cards: p.home_cards, lock_layout: p.lock_layout, lock_account: p.lock_account }
}

function crm(cfg: PbxConfig, ext: Extension): { url: string; auto: boolean } | null {
  const p = cfg.appprofiles.find((x) => x.id === ext.app_profile)
  return p?.crm_url.trim() ? { url: p.crm_url.trim(), auto: p.crm_auto } : null
}

/** Basis für Links an Telefone: die öffentliche Adresse, sonst die aufgerufene */
export function linkBase(cfg: PbxConfig, requestBase: string): string {
  return publicBase(cfg) || requestBase
}

/** Basis-URL der Weboberfläche aus Sicht des Aufrufers */
export function baseUrl(host: string | undefined, cfg: PbxConfig, proto = 'http'): string {
  const scheme = proto === 'https' ? 'https' : 'http'
  // Hinter einem Reverse-Proxy kommt der Host ohne Port (Standardport)
  if (host) return `${scheme}://${host.replace(/[^\w.:[\]-]/g, '')}`
  return `http://${cfg.system.sip_host || 'localhost'}:${SETTINGS.httpPort}`
}

/** Profiladresse zu einem Token (Einladungslink oder Gerät) */
export function provisioningUrl(base: string, token: string): string {
  return `${base}/provision/${token}`
}

/** Link, der die App öffnet (Protokoll sip-telefon://), mit dem Einladungstoken */
export function appLink(base: string, ext: Extension): string {
  return `sip-telefon://provision?url=${encodeURIComponent(provisioningUrl(base, ext.provision_token))}`
}

/**
 * @param base  Adresse, unter der die Anlage aufgerufen wurde
 * @param ice   STUN/TURN-Server für die Mobil-App
 * @param token Token des Geräts; die App ruft ihr Profil danach unter dieser Adresse ab
 */
export function profile(cfg: PbxConfig, ext: Extension, base: string, ice: IceServer[] = [], token = ''): ProvisioningProfile {
  const pub = linkBase(cfg, base)
  const domain = cfg.system.sip_host.trim() || new URL(base).hostname.replace(/^\[|\]$/g, '')
  const permissions = appPermissions(cfg, ext.number)
  const editable = permissions.includes('phonebook_edit')
  const phonebook = directory(cfg, ext.id).map(({ id, name, company, phone, mobile }) => ({
    name,
    company,
    phone,
    mobile,
    ...(editable && id.startsWith('pb-') ? { id: id.slice(3) } : {}),
  }))
  const result: Omit<ProvisioningProfile, 'revision'> = {
    format: PROVISIONING_FORMAT,
    version: 1,
    pbx: { name: cfg.system.name, version: SETTINGS.version },
    extension: ext.number,
    account: {
      display_name: ext.name,
      user: ext.number,
      domain,
      auth_user: ext.number,
      port: cfg.system.sip_port === 5060 ? 0 : cfg.system.sip_port,
      local_port: 0,
      transport: 'udp',
      outbound: '',
      stun: '',
      // baresip: srtp = wenn möglich, srtp-mand = Pflicht
      mediaenc: cfg.system.srtp === 'required' ? 'srtp-mand' : cfg.system.srtp === 'optional' ? 'srtp' : '',
      regint: 300,
    },
    password: ext.secret,
    url: token ? provisioningUrl(pub, token) : '',
    phonebook,
    features: {
      voicemail: '*97',
      dnd: '*76',
      forward: '*21',
      pickup: '*8',
      echo: '*43',
    },
    app: policy(cfg, ext),
    calendars: visibleCalendars(cfg, ext).map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      writable: c.writable && c.kind === 'events' && permissions.includes('calendar_edit'),
    })),
    permissions,
    messenger: messengerUsers(cfg).some((e) => e.id === ext.id),
    remote: cfg.remote.enabled
      ? { websocket: websocketUrl(pub), user: appEndpoint(ext.number), domain: new URL(pub).hostname, ice_servers: ice }
      : null,
    // Adresse, unter der die App die Anlage erreicht (im LAN direkt, sonst über den Proxy)
    video:
      videoEnabled(cfg) && messengerUsers(cfg).some((e) => e.id === ext.id)
        ? { websocket: websocketUrl(base.replace(/\/+$/, '')), user: videoEndpoint(ext.number), domain, ice_servers: cfg.remote.enabled ? ice : [] }
        : null,
    parking: cfg.parking.enabled ? { number: cfg.parking.number, slots: parkingNumbers(cfg).slice(1) } : null,
    crm: crm(cfg, ext),
    voicemail: ext.voicemail.enabled,
    doors: cfg.extensions.filter((e) => e.door.enabled && e.door.dtmf).map((e) => ({ number: e.number, name: e.name, dtmf: e.door.dtmf })),
  }
  const revision = createHash('sha256').update(JSON.stringify(result)).digest('hex').slice(0, 16)
  return { ...result, revision }
}

/** Antwortet auf Suchanfragen der App im LAN. */
export function startDiscovery(getCfg: () => PbxConfig): dgram.Socket | null {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  sock.on('message', (msg, rinfo) => {
    const cfg = getCfg()
    if (!cfg.provisioning.discovery) return
    try {
      const req = JSON.parse(msg.toString()) as { phone4all?: string }
      if (req.phone4all !== 'discover') return
    } catch {
      return
    }
    const reply = JSON.stringify({
      phone4all: 'pbx',
      name: cfg.system.name,
      version: SETTINGS.version,
      port: SETTINGS.httpPort,
    })
    sock.send(reply, rinfo.port, rinfo.address)
  })
  sock.on('error', (e) => console.error('Suche im LAN nicht verfügbar:', e.message))
  sock.bind(DISCOVERY_PORT)
  return sock
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** Kleine Seite für den Link aus der Einladungs-E-Mail */
export function landingPage(cfg: PbxConfig, ext: Extension, base: string, now = Date.now()): string {
  const link = appLink(base, ext)
  const pin = ext.provision_pin && ext.provision_pin_expires > now ? ext.provision_pin : ''
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(cfg.system.name)} – Telefon einrichten</title>
<style>
:root{color-scheme:light dark;--bg:#fef7ff;--fg:#1d1b20;--card:#f3edf7;--pri:#6750a4;--on:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#141218;--fg:#e6e0e9;--card:#211f26;--pri:#d0bcff;--on:#381e72}}
body{margin:0;font:16px/1.5 Roboto,system-ui,sans-serif;background:var(--bg);color:var(--fg);display:flex;justify-content:center;padding:24px 16px}
main{max-width:520px;width:100%}.card{background:var(--card);border-radius:16px;padding:24px;margin-top:16px}
a.btn{display:inline-block;background:var(--pri);color:var(--on);padding:10px 24px;border-radius:20px;text-decoration:none;font-weight:500}
dt{opacity:.7;font-size:14px}dd{margin:0 0 12px;font-size:18px;font-family:ui-monospace,monospace}
</style></head><body><main>
<h1>Hallo ${esc(ext.name)}</h1>
<p>Ihr Telefon an der Anlage <b>${esc(cfg.system.name)}</b> ist bereit.</p>
<div class="card"><h2>Mit Phone4All</h2>
<p>Phone4All installieren (Computer, Android oder iPhone) und dann auf diese Schaltfläche tippen – die App richtet sich selbst ein.</p>
<p><a class="btn" href="${esc(link)}">In Phone4All einrichten</a></p>
<p>Der Link gilt bis ${esc(new Date(ext.provision_expires).toLocaleString('de-DE'))}. Jedes Gerät erhält dabei einen eigenen Zugang.</p>
${pin ? `<p>Alternativ im Netz der Anlage in der App unter Einstellungen → Konto → „Von Telefonanlage einrichten“ diese Angaben eintragen:</p>
<dl><dt>Anlage</dt><dd>${esc(base)}</dd><dt>Nebenstelle</dt><dd>${esc(ext.number)}</dd><dt>Einrichtungs-PIN</dt><dd>${esc(pin)}</dd></dl>` : ''}
</div></main></body></html>`
}

/** Seite für einen abgelaufenen Einladungslink */
export function expiredPage(cfg: PbxConfig): string {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(cfg.system.name)} – Link abgelaufen</title>
<style>:root{color-scheme:light dark}body{font:16px/1.5 Roboto,system-ui,sans-serif;max-width:520px;margin:24px auto;padding:0 16px}</style>
</head><body><h1>Link abgelaufen</h1>
<p>Dieser Einrichtungslink gilt nicht mehr. Bitte bei der Verwaltung der Anlage <b>${esc(cfg.system.name)}</b> eine neue Einladung anfordern.</p>
</body></html>`
}
