/**
 * Auto-Provisioning für Gigaset-DECT-Basen der Reihe N610/N670/N870 IP PRO.
 * Die Basis holt sich unter <Provisioning-Server><mac>.xml eine Datei mit dem
 * SIP-Zugang der Anlage und einem SIP-Konto je Mobilteil. Neue Mobilteile meldet
 * man danach am Mobilteil mit der PIN der Basis an.
 */

import type { DectBase, Extension, PbxConfig } from './model'

/** Zeitzonen, die die Basis kennt (Auszug für Europa) */
const GIGASET_TIMEZONES = new Set([
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/Brussels',
  'Europe/Copenhagen',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Luxembourg',
  'Europe/Madrid',
  'Europe/Oslo',
  'Europe/Paris',
  'Europe/Prague',
  'Europe/Rome',
  'Europe/Stockholm',
  'Europe/Vienna',
  'Europe/Warsaw',
  'Europe/Zurich',
])

/** Ländervorwahl → Tonfolgen der Basis (Wählton, Besetztton) */
const TONE_SCHEMES: Record<string, string> = { '49': 'Germany', '33': 'France', '34': 'Spain' }

export interface DectFileOptions {
  /** Adresse der Provisioning-Dateien dieser Basis, endet mit „/“ */
  server: string
  /** SIP-Server, den die Basis anspricht (IP oder Name der Anlage) */
  sipHost: string
  /** Sekunden seit 1970: ab dann dürfen sich Mobilteile 15 Minuten lang anmelden */
  now: number
}

/** Fünfstellige Nummer des Mobilteils in der Basis, „00001“ … „00020“ */
export function handsetId(slot: number): string {
  return String(slot + 1).padStart(5, '0')
}

function attr(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** Text für XML-Kommentare (ohne „--“) */
const note = (s: string): string => attr(s).replace(/-{2,}/g, '-')

const param = (name: string, value: string | number): string => `    <param name="${attr(name)}" value="${attr(value)}"/>`

/** Mobilteile der Basis: Position (ab 0) und Nebenstelle */
export function handsets(cfg: PbxConfig, base: DectBase): { slot: number; ext: Extension }[] {
  return base.handsets.flatMap((n, slot) => {
    const ext = n ? cfg.extensions.find((e) => e.number === n) : undefined
    return ext ? [{ slot, ext }] : []
  })
}

/** Provisioning-Datei im Format der Gigaset Nx70-Firmware (auch N610) */
export function gigasetFile(cfg: PbxConfig, base: DectBase, opts: DectFileOptions): string {
  const s = cfg.system
  const p = 'SipProvider.0.'
  const lines: string[] = []
  if (base.admin_password) lines.push(param('WebUIAccounts.1.Password', base.admin_password))
  lines.push(
    param('Telephony.0.ToneScheme', TONE_SCHEMES[s.country_code] ?? 'Retail'),
    param('Provisioning.global.ProvisioningServer', opts.server),
    // Übergeben mit der R-Taste und durch Auflegen
    param('Telephony.0.CT_ViaRKey', 1),
    param('Telephony.0.CT_ByOnHook', 1),
    param('DmGlobal.0.SuotaEnable', 1),
    param('DmGlobal.0.HSIdleDisplay', 1),
    param('DmGlobal.0.SystemRegDomain', 'EUR'),
  )
  if (GIGASET_TIMEZONES.has(s.timezone)) lines.push(param('DmGlobal.0.TimeZone', s.timezone))

  lines.push(
    '',
    '    <!-- Telefonanlage -->',
    param(`${p}Name`, s.name),
    param(`${p}Domain`, opts.sipHost),
    param(`${p}ProxyServerAddress`, opts.sipHost),
    param(`${p}ProxyServerPort`, s.sip_port),
    param(`${p}RegServerAddress`, opts.sipHost),
    param(`${p}RegServerPort`, s.sip_port),
    param(`${p}RegServerRefreshTimer`, 180),
    param(`${p}TransportProtocol`, 1), // UDP
    param(`${p}UseSIPS`, 0),
    param(`${p}SRTP_Enabled`, 0),
    param(`${p}DTMFTransmission`, 2), // RFC 4733
    param(`${p}MWISubscription`, 1),
    param(`${p}OutboundProxyMode`, 2), // nie
    param(`${p}DnsQuery`, 0),
    param(`${p}FailoverServerEnabled`, 0),
    param(`${p}WithDeregOnHsNotReachable`, 1),
    param(`${p}RenewConnectionAfterTimeout`, 1),
    param(`${p}ConnectionTimeoutAction`, 1),
  )

  for (const { slot, ext } of handsets(cfg, base)) {
    const id = handsetId(slot)
    const a = `SipAccount.${id}.`
    lines.push(
      '',
      `    <!-- Mobilteil ${slot + 1}: ${note(ext.number)} ${note(ext.name)} -->`,
      `    <oper name="add_hs" value="${id}">`,
      '      <param name="hs.RegStatus" value="ToReg"/>',
      '    </oper>',
      param(`hs.${id}.DECT_AC`, base.pin),
      param(`${a}ProviderId`, 0),
      param(`${a}UserName`, ext.number),
      param(`${a}AuthName`, ext.number),
      param(`${a}AuthPassword`, ext.secret),
      param(`${a}DisplayName`, ext.name),
      ...(ext.voicemail.enabled ? [param(`${a}VoiceMailMailbox`, '*97'), param(`${a}VoiceMailActive`, 1)] : [param(`${a}VoiceMailActive`, 0)]),
    )
  }

  lines.push(
    '',
    '    <!-- Mobilteile anmelden: 15 Minuten ab Abruf -->',
    '    <oper name="update_dm" value="local">',
    `      <param name="RegStart" value="${opts.now}"/>`,
    '      <param name="RegDuration" value="900"/>',
    '      <param name="DMPpasswd" value="Gigaset"/>',
    '    </oper>',
  )

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- ${note(s.name)}: DECT-Basis ${note(base.name)} -->`,
    '<provisioning version="1.1" productID="e2">',
    '  <nvm>',
    ...lines,
    '  </nvm>',
    '</provisioning>',
    '',
  ].join('\n')
}

/** MAC aus dem Dateinamen („7c2f80e0d605.xml“) oder dem User-Agent der Basis */
export function requestMac(file: string, agent: string): string {
  const fromFile = /^([0-9a-f]{12})(\.xml)?$/i.exec(file)
  if (fromFile) return fromFile[1].toLowerCase()
  // „Gigaset N870 IP PRO/83.V2.11.0+build.a546b91;7C2F80E0D605“
  const fromAgent = /;([0-9A-F]{12})(;|"|$)/i.exec(agent)
  return fromAgent ? fromAgent[1].toLowerCase() : ''
}

/** Modell und Firmware aus dem User-Agent, z. B. „N610 IP PRO 83.V2.65.0“ */
export function describeAgent(agent: string): string {
  const m = /^"?(?:Gigaset )?([\w ]+?)\/([\w.]+)/.exec(agent)
  return m ? `${m[1]} ${m[2]}` : agent.slice(0, 80)
}
