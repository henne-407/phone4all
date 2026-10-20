/**
 * Vorlagen für SIP-Konten verbreiteter Anbieter (vor allem Deutschland).
 * Sie füllen Server, Transport und Nummernformat vor; Zugangsdaten stammen aus
 * dem Kundenportal bzw. dem Zugangsdaten-Schreiben des Anbieters.
 */

import type { Trunk } from './model'

export interface ProviderTemplate {
  key: string
  name: string
  /** Hinweise, die beim Anlegen angezeigt werden */
  help: string
  /** Beschriftungen/Hilfen für Felder, die je Anbieter anders heißen */
  labels?: Partial<Record<'username' | 'auth_username' | 'password' | 'registrar' | 'outbound_proxy', string>>
  values: Partial<Omit<Trunk, 'id' | 'name' | 'provider'>>
}

export const PROVIDERS: ProviderTemplate[] = [
  {
    key: 'telekom',
    name: 'Telekom (IP-Anschluss, MagentaZuhause/MagentaBusiness)',
    help:
      'Funktioniert nur über einen Telekom-Internetanschluss. Je Rufnummer ein SIP-Konto anlegen. ' +
      'Benutzername ist die Rufnummer im Format +49…, Anmeldename die E-Mail-Adresse des Telekom-Logins ' +
      '(oder die Zugangsnummer), Kennwort das zugehörige Passwort.',
    labels: { username: 'Rufnummer (+49…)', auth_username: 'E-Mail-Adresse / Zugangsnummer' },
    values: {
      registrar: 'tel.t-online.de',
      transport: 'udp',
      register: true,
      number_format: 'e164',
      did_source: 'to',
      codecs: ['g722', 'alaw', 'ulaw'],
    },
  },
  {
    key: 'telekom-companyflex',
    name: 'Telekom CompanyFlex / DeutschlandLAN SIP-Trunk',
    help:
      'Zugangsdaten aus dem Telekom Business-Kundencenter (Telefonie-Benutzername, Passwort und ' +
      'individueller Outbound-Proxy, z. B. <kennung>.primary.companyflex.de). Verschlüsselt über TLS mit SRTP.',
    labels: { username: 'Telefonie-Benutzername', outbound_proxy: 'Outbound-Proxy (…companyflex.de)' },
    values: {
      registrar: 'reg.sip-trunk.telekom.de',
      transport: 'tls',
      port: 5061,
      srtp: true,
      register: true,
      number_format: 'e164',
      did_source: 'to',
      forward_caller_id: true,
      codecs: ['g722', 'alaw', 'ulaw'],
    },
  },
  {
    key: 'vodafone-cable',
    name: 'Vodafone Kabel',
    help:
      'Eigene SIP-Zugangsdaten gibt es nur mit eigenem Router (MeinVodafone → Telefonie-Zugangsdaten). ' +
      'Bei einer gemieteten FRITZ!Box stattdessen die Vorlage „FRITZ!Box“ verwenden.',
    values: {
      registrar: 'sip.kabelfon.vodafone.de',
      outbound_proxy: 'sip.kabelfon.vodafone.de',
      transport: 'udp',
      register: true,
      number_format: 'national',
      codecs: ['alaw', 'g722', 'ulaw'],
    },
  },
  {
    key: 'vodafone-dsl',
    name: 'Vodafone DSL / Glasfaser',
    help:
      'Registrar, Benutzername und Passwort stehen in MeinVodafone unter den Telefonie-Zugangsdaten ' +
      '(nur mit eigenem Router). Bei einer gemieteten Box die Vorlage „FRITZ!Box“ verwenden.',
    labels: { registrar: 'Registrar laut Zugangsdaten' },
    values: { transport: 'udp', register: true, number_format: 'national', codecs: ['alaw', 'g722', 'ulaw'] },
  },
  {
    key: '1und1',
    name: '1&1',
    help:
      'Benutzername ist die Rufnummer im Format 49<Vorwahl ohne 0><Rufnummer>, das Passwort ist das ' +
      'VoIP-Passwort aus dem 1&1 Control-Center.',
    labels: { username: 'Rufnummer (49…)' },
    values: {
      registrar: 'sip.1und1.de',
      transport: 'udp',
      register: true,
      number_format: 'national',
      codecs: ['alaw', 'g722', 'ulaw'],
    },
  },
  {
    key: 'o2',
    name: 'o2 / Telefónica (DSL)',
    help: 'Benutzername ist die Rufnummer mit Vorwahl (030…), das Passwort steht im Kundenportal „Mein o2“.',
    labels: { username: 'Rufnummer mit Vorwahl' },
    values: {
      registrar: 'sip.alice-voip.de',
      transport: 'udp',
      register: true,
      number_format: 'national',
      codecs: ['alaw', 'g722', 'ulaw'],
    },
  },
  {
    key: 'sipgate',
    name: 'sipgate basic / team',
    help: 'SIP-ID (z. B. 1234567e0) und SIP-Passwort aus der sipgate-Weboberfläche (Telefonie → Geräte).',
    labels: { username: 'SIP-ID', password: 'SIP-Passwort' },
    values: {
      registrar: 'sipgate.de',
      outbound_proxy: 'sipgate.de',
      transport: 'udp',
      register: true,
      number_format: 'e164_no_plus',
      did_source: 'to',
      codecs: ['g722', 'alaw', 'ulaw'],
    },
  },
  {
    key: 'sipgate-trunking',
    name: 'sipgate trunking',
    help: 'Trunk-Benutzername und Passwort aus sipgate trunking (Trunk → Einstellungen).',
    values: {
      registrar: 'sipconnect.sipgate.de',
      transport: 'udp',
      register: true,
      number_format: 'e164_no_plus',
      did_source: 'to',
      forward_caller_id: true,
      codecs: ['g722', 'alaw', 'ulaw'],
    },
  },
  {
    key: 'easybell',
    name: 'easybell',
    help: 'SIP-Benutzername und Passwort aus dem easybell-Kundenportal (Telefonie → SIP-Zugangsdaten).',
    values: {
      registrar: 'voip.easybell.de',
      transport: 'udp',
      register: true,
      number_format: 'e164_no_plus',
      did_source: 'to',
      codecs: ['g722', 'alaw', 'ulaw'],
    },
  },
  {
    key: 'placetel',
    name: 'Placetel',
    help: 'SIP-Benutzer (z. B. 777…) und Passwort aus der Placetel-Weboberfläche (SIP-Trunk bzw. Endgerät).',
    values: {
      registrar: 'fpbx.de',
      transport: 'udp',
      register: true,
      number_format: 'e164_no_plus',
      did_source: 'to',
      codecs: ['g722', 'alaw', 'ulaw'],
    },
  },
  {
    key: 'fritzbox',
    name: 'FRITZ!Box (als vorgeschaltete Anlage)',
    help:
      'In der FRITZ!Box unter Telefonie → Telefoniegeräte → Neues Gerät → Telefon (LAN/WLAN) ein IP-Telefon ' +
      'anlegen. Benutzername und Kennwort von dort übernehmen; unter „Telefoniegeräte“ festlegen, auf welche ' +
      'Rufnummern es reagiert. So nutzt die Anlage auch Anschlüsse ohne eigene SIP-Zugangsdaten.',
    labels: { username: 'Benutzername des IP-Telefons' },
    values: {
      registrar: 'fritz.box',
      transport: 'udp',
      register: true,
      number_format: 'national',
      did_source: 'to',
      codecs: ['g722', 'alaw', 'ulaw'],
    },
  },
  {
    key: 'generic',
    name: 'Anderer Anbieter',
    help: 'Alle Werte laut Zugangsdaten des Anbieters eintragen.',
    values: { transport: 'udp', register: true, number_format: 'e164' },
  },
]

export function provider(key: string): ProviderTemplate {
  return PROVIDERS.find((p) => p.key === key) ?? PROVIDERS[PROVIDERS.length - 1]
}
