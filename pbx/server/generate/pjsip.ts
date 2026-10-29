/** pjsip.conf: Transporte, Nebenstellen, SIP-Konten und Sperrliste. */

import { messengerUsers } from '../messenger'
import type { Extension, PbxConfig, SystemSettings, Trunk } from '../model'
import { formatFor, toE164 } from '../numbers'
import { appEndpoint, videoEnabled, videoEndpoint, webrtcEnabled } from '../remote'
import type { GenContext } from './context'

/** Werte für Konfigurationsdateien: keine Zeilenumbrüche, kein Semikolon (Kommentarzeichen). */
export function val(v: string | number): string {
  return String(v).replace(/[\r\n]/g, ' ').replace(/;/g, '\\;').trim()
}

function section(name: string, lines: (string | false | null | undefined)[], template?: string): string {
  const header = template ? `[${name}](${template})` : `[${name}]`
  return [header, ...lines.filter(Boolean)].join('\n') + '\n'
}

export function hostOf(server: string): string {
  return server.replace(/^sips?:/, '').split(/[:;/]/)[0]
}

function transportName(t: Trunk['transport']): string {
  return `transport-${t}`
}

function uri(host: string, port: number): string {
  return `sip:${hostOf(host)}${port ? ':' + port : ''}`
}

function proxyUri(proxy: string): string {
  const p = proxy.trim().replace(/^sips?:/, '')
  return p ? `sip:${p}\\;lr` : ''
}

export function codecs(list: string[]): string {
  const allowed = list.filter((c) => /^[a-z0-9_]+$/.test(c))
  return (allowed.length ? allowed : ['alaw', 'ulaw']).join(',')
}

function extensionSections(cfg: PbxConfig, ext: Extension): string {
  const country = cfg.system.country_code
  const cid = ext.outbound_cid ? toE164(ext.outbound_cid, country, cfg.system.area_code) : ''
  const nets = cfg.security.extension_nets.filter(Boolean)
  const acl = nets.length
    ? ['deny=0.0.0.0/0.0.0.0', ...nets.map((n) => `permit=${val(n)}`), 'contact_deny=0.0.0.0/0.0.0.0', ...nets.map((n) => `contact_permit=${val(n)}`)]
    : []
  return [
    section(
      ext.number,
      [
        `callerid="${val(ext.name).replace(/"/g, '')}" <${ext.number}>`,
        `auth=${ext.number}`,
        `aors=${ext.number}`,
        ext.voicemail.enabled && `mailboxes=${ext.number}@default`,
        `set_var=P4A_EXT=${ext.number}`,
        cid && `set_var=P4A_CID=${cid}`,
        ...acl,
      ],
      'p4a-ext',
    ),
    section(ext.number, ['type=auth', 'auth_type=userpass', `username=${ext.number}`, `password=${val(ext.secret)}`]),
    section(ext.number, [
      'type=aor',
      `max_contacts=${Math.max(1, Math.min(10, ext.max_devices || 1))}`,
      'remove_existing=yes',
      'qualify_frequency=60',
      ext.voicemail.enabled && `mailboxes=${ext.number}@default`,
    ]),
  ].join('\n')
}

/** Codecs, die WebRTC-Telefone beherrschen */
export function webrtcCodecs(list: string[]): string {
  const ok = list.filter((c) => ['opus', 'g722', 'alaw', 'ulaw'].includes(c))
  return (ok.length ? ok : ['opus', 'alaw', 'ulaw']).join(',')
}

/**
 * App und Videoanrufe kommen immer über den WebSocket-Proxy der Anlage (127.0.0.1). Ohne
 * diese Sperre ginge die Anmeldung als <nummer>-app auch per UDP von überall und umginge
 * die Netzbeschränkung der Nebenstellen.
 */
const PROXY_ONLY = ['deny=0.0.0.0/0.0.0.0', 'permit=127.0.0.1/255.255.255.255']

/**
 * Zweites Gerät jeder Nebenstelle für die Mobil-App: SIP über WebSocket, Sprache per
 * WebRTC (ICE, DTLS-SRTP). Gleiches Passwort, Benutzer „<nummer>-app“. Nur über den
 * Proxy der Anlage erreichbar (PROXY_ONLY).
 */
function appSections(cfg: PbxConfig, ext: Extension): string {
  const id = appEndpoint(ext.number)
  const cid = ext.outbound_cid ? toE164(ext.outbound_cid, cfg.system.country_code, cfg.system.area_code) : ''
  return [
    section(
      id,
      [
        `callerid="${val(ext.name).replace(/"/g, '')}" <${ext.number}>`,
        `auth=${id}`,
        `aors=${id}`,
        ext.voicemail.enabled && `mailboxes=${ext.number}@default`,
        `set_var=P4A_EXT=${ext.number}`,
        cid && `set_var=P4A_CID=${cid}`,
        ...PROXY_ONLY,
      ],
      'p4a-app',
    ),
    section(id, ['type=auth', 'auth_type=userpass', `username=${id}`, `password=${val(ext.secret)}`]),
    section(id, [
      'type=aor',
      'max_contacts=3',
      'remove_existing=yes',
      'remove_unavailable=yes',
      'qualify_frequency=30',
      'default_expiration=300',
      'maximum_expiration=900',
      ext.voicemail.enabled && `mailboxes=${ext.number}@default`,
    ]),
  ].join('\n')
}

function trunkSections(cfg: PbxConfig, t: Trunk, ctx: GenContext): string {
  const id = `trunk-${t.id}`
  const transport = t.transport === 'tls' && !ctx.tls ? 'tcp' : t.transport
  const registrar = hostOf(t.registrar)
  const proxy = proxyUri(t.outbound_proxy)
  const user = t.username.trim()
  const fromUser = t.from_user.trim() || user
  const cid = t.default_cid
    ? formatFor(toE164(t.default_cid, cfg.system.country_code, cfg.system.area_code), t.number_format, cfg.system.country_code)
    : ''
  const out: string[] = []
  if (!t.ip_auth) {
    out.push(
      section(`${id}-auth`, [
        'type=auth',
        'auth_type=userpass',
        `username=${val(t.auth_username.trim() || user)}`,
        `password=${val(t.password)}`,
      ]),
    )
  }
  out.push(
    section(id, ['type=aor', `contact=${uri(registrar, t.port)}`, proxy && `outbound_proxy=${proxy}`, 'qualify_frequency=0']),
    section(
      id,
      [
        `transport=${transportName(transport)}`,
        `aors=${id}`,
        !t.ip_auth && `outbound_auth=${id}-auth`,
        `allow=${codecs(t.codecs)}`,
        fromUser && `from_user=${val(fromUser)}`,
        `from_domain=${val(t.from_domain.trim() || registrar)}`,
        proxy && `outbound_proxy=${proxy}`,
        t.srtp && 'media_encryption=sdes',
        `set_var=P4A_TRUNK=${t.id}`,
        cid && `set_var=P4A_TRUNK_CID=${cid}`,
        t.max_channels > 0 && `device_state_busy_at=${t.max_channels}`,
        // Fax über T.38 (UDPTL); ohne geht Fax als Ton über G.711
        ...(t.t38 ? ['t38_udptl=yes', 't38_udptl_ec=redundancy', 't38_udptl_maxdatagram=400', 't38_udptl_nat=yes'] : []),
        ...t.advanced
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => /^[a-z_]+\s*=/.test(l)),
      ],
      'p4a-trunk',
    ),
  )
  if (t.register && !t.ip_auth && user) {
    out.push(
      section(id, [
        'type=registration',
        `transport=${transportName(transport)}`,
        `outbound_auth=${id}-auth`,
        `server_uri=${uri(registrar, t.port)}`,
        `client_uri=sip:${val(user)}@${registrar}`,
        `contact_user=${val(user)}`,
        proxy && `outbound_proxy=${proxy}`,
        'retry_interval=60',
        'forbidden_retry_interval=300',
        'fatal_retry_interval=300',
        'max_retries=10000',
        'expiration=600',
        'line=yes',
        `endpoint=${id}`,
      ]),
    )
  }
  // Registrierte Konten erkennt Asterisk an der Registrierung (line=yes); die IP-Zuordnung
  // braucht nur ein Konto ohne Registrierung
  const hosts = [...new Set([registrar, hostOf(t.outbound_proxy)].filter(Boolean))]
  if (hosts.length && (t.ip_auth || !t.register)) out.push(section(id, ['type=identify', `endpoint=${id}`, ...hosts.map((h) => `match=${h}`)]))
  return out.join('\n')
}

function appTemplate(cfg: PbxConfig): string {
  const s = cfg.system
  return section('p4a-app', [
    'type=endpoint',
    'context=p4a-from-ext',
    'transport=transport-ws',
    'webrtc=yes',
    'disallow=all',
    `allow=${webrtcCodecs(s.codecs)}`,
    'direct_media=no',
    'rtp_symmetric=yes',
    'force_rport=yes',
    'rewrite_contact=yes',
    'dtmf_mode=rfc4733',
    `language=${val(s.language)}`,
    'tone_zone=de',
    'named_call_group=alle',
    'named_pickup_group=alle',
    'allow_subscribe=yes',
    'send_pai=yes',
    'moh_suggest=default',
  ], '!')
}

/**
 * Videoanrufe aus dem Messenger: WebRTC mit VP8, mehrere Videoströme (die Konferenz
 * leitet jedes Bild einzeln weiter, SFU). Kann nur Chat-Räume anrufen (p4a-video).
 */
function videoTemplate(cfg: PbxConfig): string {
  const s = cfg.system
  return section('p4a-video', [
    'type=endpoint',
    'context=p4a-video',
    'transport=transport-ws',
    'webrtc=yes',
    'disallow=all',
    `allow=${webrtcCodecs(s.codecs)},vp8`,
    'bundle=yes',
    'max_audio_streams=1',
    'max_video_streams=16',
    'direct_media=no',
    'rtp_symmetric=yes',
    'force_rport=yes',
    'rewrite_contact=yes',
    'dtmf_mode=rfc4733',
    `language=${val(s.language)}`,
    // Abgestürzte App (kein BYE): Sitzung läuft ohne Auffrischung nach 2 Minuten ab.
    // rtp_timeout geht nicht: Auf den Videoströmen der anderen kommt nie etwas zurück
    'timers=yes',
    'timers_sess_expires=120',
  ], '!')
}

/** Gerät „<nummer>-video“ einer Nebenstelle; meldet sich nicht an, ruft nur an */
function videoSections(ext: Extension): string {
  const id = videoEndpoint(ext.number)
  return [
    section(id, [`callerid="${val(ext.name).replace(/"/g, '')}" <${ext.number}>`, `auth=${id}`, `set_var=P4A_EXT=${ext.number}`, ...PROXY_ONLY], 'p4a-video'),
    section(id, ['type=auth', 'auth_type=userpass', `username=${id}`, `password=${val(ext.secret)}`]),
  ].join('\n')
}

export function pjsipConf(cfg: PbxConfig, ctx: GenContext): string {
  const s = cfg.system
  const nat = s.external_address.trim()
    ? [
        `external_media_address=${val(s.external_address)}`,
        `external_signaling_address=${val(s.external_address)}`,
        ...s.local_nets.filter(Boolean).map((n) => `local_net=${val(n)}`),
      ]
    : []
  const parts = [
    '; Erzeugt von Phone4all – Änderungen in der Weboberfläche vornehmen',
    section('global', [
      'type=global',
      'user_agent=Phone4all PBX',
      'endpoint_identifier_order=ip,username',
      'default_realm=phone4all',
    ]),
    section('transport-udp', ['type=transport', 'protocol=udp', `bind=0.0.0.0:${s.sip_port}`, ...nat]),
    section('transport-tcp', ['type=transport', 'protocol=tcp', `bind=0.0.0.0:${s.sip_port}`, ...nat]),
  ]
  if (ctx.tls) {
    parts.push(
      section('transport-tls', [
        'type=transport',
        'protocol=tls',
        `bind=0.0.0.0:${s.tls_port}`,
        `cert_file=${ctx.tls.cert}`,
        `priv_key_file=${ctx.tls.key}`,
        'method=tlsv1_2',
        ...nat,
      ]),
    )
  }
  if (webrtcEnabled(cfg)) {
    // Läuft über den HTTP-Server von Asterisk (http.conf), die Anlage reicht /ws weiter. Die
    // Adresse muss 0.0.0.0 sein: Asterisk bindet auch die Sprache (RTP) daran
    parts.push(section('transport-ws', ['type=transport', 'protocol=ws', 'bind=0.0.0.0']))
  }
  if (ctx.banned.length) {
    parts.push(section('p4a-bans', ['type=acl', ...ctx.banned.map((ip) => `deny=${val(ip)}`)]))
  }
  parts.push(
    section('p4a-ext', [
      'type=endpoint',
      'context=p4a-from-ext',
      'disallow=all',
      `allow=${codecs(s.codecs)}`,
      'direct_media=no',
      'rtp_symmetric=yes',
      'force_rport=yes',
      'rewrite_contact=yes',
      'dtmf_mode=rfc4733',
      `language=${val(s.language)}`,
      'tone_zone=de',
      'named_call_group=alle',
      'named_pickup_group=alle',
      'allow_subscribe=yes',
      'send_pai=yes',
      'moh_suggest=default',
      ...srtpLines(s.srtp),
    ], '!'),
    ...(cfg.remote.enabled ? [appTemplate(cfg)] : []),
    ...(videoEnabled(cfg) ? [videoTemplate(cfg)] : []),
    section('p4a-trunk', [
      'type=endpoint',
      'context=p4a-from-trunk',
      'disallow=all',
      'direct_media=no',
      'rtp_symmetric=yes',
      'force_rport=yes',
      'rewrite_contact=yes',
      'dtmf_mode=rfc4733',
      `language=${val(s.language)}`,
      'tone_zone=de',
      'send_pai=yes',
      'trust_id_outbound=yes',
      'inband_progress=yes',
      'timers=yes',
    ], '!'),
  )
  for (const ext of cfg.extensions) parts.push(extensionSections(cfg, ext))
  if (cfg.remote.enabled) for (const ext of cfg.extensions) parts.push(appSections(cfg, ext))
  if (videoEnabled(cfg)) for (const ext of messengerUsers(cfg)) parts.push(videoSections(ext))
  for (const t of cfg.trunks.filter((t) => t.enabled && t.registrar.trim())) parts.push(trunkSections(cfg, t, ctx))
  return parts.join('\n')
}

/** SRTP (SDES) für Telefone im LAN; die Schlüssel sind nur mit SIP über TLS geschützt */
export function srtpLines(mode: SystemSettings['srtp']): string[] {
  if (mode === 'optional') return ['media_encryption=sdes', 'media_encryption_optimistic=yes']
  if (mode === 'required') return ['media_encryption=sdes', 'media_encryption_optimistic=no']
  return []
}
