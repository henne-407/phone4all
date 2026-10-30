/**
 * Tischtelefone von Yealink (T3x/T4x/T5x) und Snom (D1xx/D3xx/D7xx) richten sich selbst ein:
 * Am Telefon (oder per DHCP-Option 66) wird die Provisioning-Adresse der Anlage eingetragen,
 * das Telefon holt dort SIP-Konto, Sprache, Zeitzone, Telefonbuch (LDAP) und Funktionstasten.
 *
 *   Yealink: <Adresse>/y000000000000.cfg (allgemein) und <Adresse>/<mac>.cfg
 *   Snom:    <Adresse>/snom.xml (bzw. <mac>.xml)
 */

import { LDAP_BASE, LDAP_USER } from './ldap'
import type { DeskKey, DeskPhone, Extension, PbxConfig } from './model'

export interface DeskFileOptions {
  /** SIP-Server, den das Telefon anspricht */
  sipHost: string
  /** Adresse des LDAP-Telefonbuchs (wie die Anlage) */
  ldapHost: string
}

/** Zeitzonen: Anlage → Yealink (Versatz, Name) und Snom */
const ZONES: Record<string, { offset: string; yealink: string; snom: string }> = {
  'Europe/Berlin': { offset: '+1', yealink: 'Germany(Berlin)', snom: 'GER+1' },
  'Europe/Vienna': { offset: '+1', yealink: 'Austria(Vienna)', snom: 'AUT+1' },
  'Europe/Zurich': { offset: '+1', yealink: 'Switzerland(Bern)', snom: 'CHE+1' },
  'Europe/Amsterdam': { offset: '+1', yealink: 'Netherlands(Amsterdam)', snom: 'NLD+1' },
  'Europe/Luxembourg': { offset: '+1', yealink: 'Luxembourg(Luxembourg)', snom: 'LUX+1' },
}

const LDAP_NAME_FILTER = '(|(cn=%)(sn=%)(givenName=%)(o=%))'
const LDAP_NUMBER_FILTER = '(|(telephoneNumber=%)(mobile=%))'

/** MAC aus dem angefragten Dateinamen (Yealink „805ec0123456.cfg“, Snom „snomD385-000413A1B2C3.htm“) */
export function deskRequestMac(file: string): string {
  const m = /([0-9a-f]{12})(?:\.(?:cfg|xml|htm))?$/i.exec(file)
  return m ? m[1].toLowerCase() : ''
}

/** MAC im User-Agent („Yealink SIP-T54W 96.86.0.70 80:5e:c0:12:34:56“, Snom „…; 000413A1B2C3)“) */
export function agentMac(agent: string): string {
  const m = /(?:^|[\s;(])((?:[0-9a-f]{2}:){5}[0-9a-f]{2}|[0-9a-f]{12})(?=$|[\s;)])/i.exec(agent)
  return m ? m[1].replace(/:/g, '').toLowerCase() : ''
}

/** Allgemeine Datei, die Yealink vor der eigenen anfragt („y000000000123.cfg“) */
export function isYealinkCommon(file: string): boolean {
  return /^y0{9}\d{3}\.cfg$/i.test(file)
}

function deskExtension(cfg: PbxConfig, phone: DeskPhone): Extension | undefined {
  return cfg.extensions.find((e) => e.number === phone.extension)
}

/** Werte in Yealink-Dateien: eine Zeile je Schlüssel, ohne Zeilenumbrüche */
const yv = (s: string | number): string => String(s).replace(/[\r\n]/g, ' ')

const keyLabel = (cfg: PbxConfig, k: DeskKey): string =>
  k.label || (k.type === 'blf' ? (cfg.extensions.find((e) => e.number === k.value)?.name ?? k.value) : k.type === 'dnd' ? 'Nicht stören' : k.value)

/** Yealink-Datei für das Telefon (Format der Firmware 8x) */
export function yealinkFile(cfg: PbxConfig, phone: DeskPhone, opts: DeskFileOptions): string {
  const s = cfg.system
  const ext = deskExtension(cfg, phone)
  const zone = ZONES[s.timezone] ?? ZONES['Europe/Berlin']
  const lines = [
    '#!version:1.0.0.1',
    `# ${yv(s.name)}: ${yv(phone.name)} – erzeugt von Phone4all, Änderungen in der Weboberfläche der Anlage`,
    'lang.gui = German',
    'lang.wui = German',
    'voice.tone.country = Germany',
    `local_time.time_zone = ${zone.offset}`,
    `local_time.time_zone_name = ${zone.yealink}`,
    'local_time.ntp_server1 = pool.ntp.org',
    'local_time.date_format = 6',
    'local_time.time_format = 1',
    // Durchsage und Gegensprechen: Anrufe mit „answer-after=0“ nimmt das Telefon selbst an
    'features.intercom.allow = 1',
    'features.intercom.mute = 0',
    'features.intercom.tone = 1',
    'features.pickup.direct_pickup_enable = 1',
    'features.pickup.direct_pickup_code = **',
    'features.pickup.group_pickup_enable = 1',
    'features.pickup.group_pickup_code = *8',
    'features.dnd.feature_key_sync = 0',
    'static.auto_provision.repeat.enable = 1',
    'static.auto_provision.repeat.minutes = 1440',
  ]
  if (phone.admin_password) lines.push(`static.security.user_password = admin:${yv(phone.admin_password)}`)
  if (ext) {
    lines.push(
      'account.1.enable = 1',
      `account.1.label = ${yv(`${ext.number} ${ext.name}`)}`,
      `account.1.display_name = ${yv(ext.name)}`,
      `account.1.auth_name = ${ext.number}`,
      `account.1.user_name = ${ext.number}`,
      `account.1.password = ${yv(ext.secret)}`,
      `account.1.sip_server.1.address = ${opts.sipHost}`,
      `account.1.sip_server.1.port = ${s.sip_port}`,
      'account.1.sip_server.1.transport_type = 0',
      'account.1.sip_server.1.expires = 300',
      'account.1.dtmf.type = 1',
      'account.1.subscribe_mwi = 1',
      'account.1.subscribe_mwi_to_vm = 1',
      'account.1.blf.blf_list_uri =',
      `voice_mail.number.1 = ${ext.voicemail.enabled ? '*97' : ''}`,
    )
  }
  if (cfg.ldap.enabled) {
    lines.push(
      'ldap.enable = 1',
      'ldap.name = Telefonbuch',
      `ldap.host = ${opts.ldapHost}`,
      `ldap.port = ${cfg.ldap.port}`,
      `ldap.base = ${LDAP_BASE}`,
      `ldap.user = ${cfg.ldap.password ? LDAP_USER : ''}`,
      `ldap.password = ${yv(cfg.ldap.password)}`,
      `ldap.name_filter = ${LDAP_NAME_FILTER}`,
      `ldap.number_filter = ${LDAP_NUMBER_FILTER}`,
      'ldap.display_name = %cn',
      'ldap.name_attr = cn sn givenName o',
      'ldap.numb_attr = telephoneNumber mobile',
      'ldap.version = 3',
      'ldap.call_in_lookup = 1',
      'ldap.ldap_sort = 1',
      'ldap.max_hits = 50',
    )
  }
  // Funktionstasten ab der zweiten Leitungstaste (die erste zeigt das Konto)
  phone.keys.forEach((k, i) => {
    const n = i + 2
    const type = { blf: 16, speed: 13, park: 16, dnd: 5, none: 0 }[k.type]
    lines.push(
      `linekey.${n}.type = ${type}`,
      `linekey.${n}.line = 1`,
      `linekey.${n}.value = ${k.type === 'dnd' || k.type === 'none' ? '' : k.value}`,
      `linekey.${n}.label = ${yv(k.type === 'none' ? '' : keyLabel(cfg, k))}`,
      `linekey.${n}.extension = ${k.type === 'blf' ? '**' : ''}`,
    )
  })
  return lines.join('\n') + '\n'
}

function x(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

const setting = (name: string, value: string | number, idx?: number): string =>
  `    <${name}${idx === undefined ? '' : ` idx="${idx}"`} perm="">${x(value)}</${name}>`

/** Snom-Datei (XML, „phone-settings“ und „functionKeys“) */
export function snomFile(cfg: PbxConfig, phone: DeskPhone, opts: DeskFileOptions): string {
  const s = cfg.system
  const ext = deskExtension(cfg, phone)
  const zone = ZONES[s.timezone] ?? ZONES['Europe/Berlin']
  const host = `${opts.sipHost}:${s.sip_port}`
  const settings = [
    setting('language', 'Deutsch'),
    setting('web_language', 'Deutsch'),
    setting('tone_scheme', 'GER'),
    setting('timezone', zone.snom),
    setting('ntp_server', 'pool.ntp.org'),
    setting('date_us_format', 'off'),
    setting('time_24_format', 'on'),
    // Durchsage und Gegensprechen: selbst annehmen, wenn die Anlage es per Call-Info verlangt
    setting('answer_after_policy', 'idle'),
    setting('auto_answer_with_alert_info', 'on'),
    setting('call_pickup_code', '*8'),
    setting('update_policy', 'auto_update'),
    setting('settings_refresh_timer', 86400),
  ]
  if (phone.admin_password) {
    settings.push(setting('admin_mode_password', phone.admin_password), setting('http_user', 'admin'), setting('http_pass', phone.admin_password))
  }
  if (ext) {
    settings.push(
      setting('user_active', 'on', 1),
      setting('user_realname', ext.name, 1),
      setting('user_name', ext.number, 1),
      setting('user_pname', ext.number, 1),
      setting('user_pass', ext.secret, 1),
      setting('user_host', host, 1),
      setting('user_idle_text', `${ext.number} ${ext.name}`, 1),
      setting('user_mailbox', ext.voicemail.enabled ? '*97' : '', 1),
      setting('user_dtmf_info', 'off', 1),
    )
  }
  if (cfg.ldap.enabled) {
    settings.push(
      setting('ldap_server', opts.ldapHost),
      setting('ldap_port', cfg.ldap.port),
      setting('ldap_base', LDAP_BASE),
      setting('ldap_username', cfg.ldap.password ? LDAP_USER : ''),
      setting('ldap_password', cfg.ldap.password),
      setting('ldap_search_filter', LDAP_NAME_FILTER),
      setting('ldap_number_filter', LDAP_NUMBER_FILTER),
      setting('ldap_display_name', '%cn'),
      setting('ldap_name_attributes', 'cn sn givenName o'),
      setting('ldap_number_attributes', 'telephoneNumber mobile'),
      setting('ldap_max_hits', 50),
      setting('ldap_over_ssl', 'off'),
    )
  }
  const fkeys = phone.keys.map((k, i) => {
    const value =
      k.type === 'blf' || k.type === 'park'
        ? `blf <sip:${k.value}@${opts.sipHost}>|**`
        : k.type === 'speed'
          ? `speed ${k.value}`
          : k.type === 'dnd'
            ? 'keyevent F_DND'
            : 'none'
    return `    <fkey idx="${i}" context="active" label="${x(k.type === 'none' ? '' : keyLabel(cfg, k))}" perm="">${x(value)}</fkey>`
  })
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<!-- ${x(s.name)}: ${x(phone.name)} – erzeugt von Phone4all -->`,
    '<settings>',
    '  <phone-settings e="2">',
    ...settings,
    '  </phone-settings>',
    '  <functionKeys e="2">',
    ...fkeys,
    '  </functionKeys>',
    '</settings>',
    '',
  ].join('\n')
}

/** Hersteller und Modell aus dem User-Agent („Yealink SIP-T54W 96.86.0.70 80:5e:c0:12:34:56“) */
export function describeDesk(agent: string): string {
  const y = /Yealink (?:SIP-)?([\w-]+) ([\d.]+)/i.exec(agent)
  if (y) return `Yealink ${y[1]} ${y[2]}`
  const s = /snom(\w+)-SIP[ /]([\d.]+)/i.exec(agent)
  if (s) return `Snom ${s[1].toUpperCase()} ${s[2]}`
  return agent.slice(0, 80)
}
