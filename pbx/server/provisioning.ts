/**
 * Automatische Einrichtung der SIP-Telefon-App: Die App holt über einen
 * Einrichtungslink (oder Nebenstelle + PIN) ihr Konto und das Telefonbuch.
 * Im LAN findet sie die Anlage per UDP-Broadcast (Port 15060).
 */

import dgram from 'node:dgram'
import type { Extension, PbxConfig } from './model'
import { SETTINGS } from './paths'

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
  phonebook: { name: string; company: string; phone: string; mobile: string }[]
  features: Record<string, string>
}

/** Basis-URL der Weboberfläche aus Sicht des Aufrufers */
export function baseUrl(host: string | undefined, cfg: PbxConfig, proto = 'http'): string {
  const scheme = proto === 'https' ? 'https' : 'http'
  // Hinter einem Reverse-Proxy kommt der Host ohne Port (Standardport)
  if (host) return `${scheme}://${host.replace(/[^\w.:[\]-]/g, '')}`
  return `http://${cfg.system.sip_host || 'localhost'}:${SETTINGS.httpPort}`
}

export function provisioningUrl(base: string, ext: Extension): string {
  return `${base}/provision/${ext.provision_token}`
}

/** Link, der die App öffnet (Protokoll sip-telefon://) */
export function appLink(base: string, ext: Extension): string {
  return `sip-telefon://provision?url=${encodeURIComponent(provisioningUrl(base, ext))}`
}

export function profile(cfg: PbxConfig, ext: Extension, base: string): ProvisioningProfile {
  const domain = cfg.system.sip_host.trim() || new URL(base).hostname.replace(/^\[|\]$/g, '')
  const phonebook = [
    ...cfg.extensions
      .filter((e) => e.id !== ext.id)
      .map((e) => ({ name: e.name, company: cfg.system.name, phone: e.number, mobile: '' })),
    ...cfg.groups
      .filter((g) => g.number)
      .map((g) => ({ name: g.name, company: `${cfg.system.name} · Gruppe`, phone: g.number, mobile: '' })),
    ...cfg.conferences.map((c) => ({ name: c.name || `Konferenz ${c.number}`, company: `${cfg.system.name} · Konferenz`, phone: c.number, mobile: '' })),
    ...cfg.phonebook.map((p) => ({ name: p.name, company: p.company, phone: p.phone, mobile: p.mobile })),
  ]
  return {
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
      mediaenc: '',
      regint: 300,
    },
    password: ext.secret,
    url: provisioningUrl(base, ext),
    phonebook,
    features: {
      voicemail: '*97',
      dnd: '*76',
      forward: '*21',
      pickup: '*8',
      echo: '*43',
    },
  }
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
export function landingPage(cfg: PbxConfig, ext: Extension, base: string): string {
  const link = appLink(base, ext)
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
<div class="card"><h2>Mit SIP-Telefon</h2>
<p>SIP-Telefon installieren und dann auf diese Schaltfläche klicken – die App richtet sich selbst ein.</p>
<p><a class="btn" href="${esc(link)}">In SIP-Telefon einrichten</a></p>
<p>Alternativ in der App unter Einstellungen → Konto → „Von Telefonanlage einrichten“ diese Angaben eintragen:</p>
<dl><dt>Anlage</dt><dd>${esc(base)}</dd><dt>Nebenstelle</dt><dd>${esc(ext.number)}</dd><dt>Einrichtungs-PIN</dt><dd>${esc(ext.provision_pin)}</dd></dl>
</div></main></body></html>`
}
