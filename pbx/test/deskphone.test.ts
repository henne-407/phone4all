import { describe, expect, it } from 'vitest'
import { agentMac, describeDesk, deskRequestMac, isYealinkCommon, snomFile, yealinkFile } from '../server/deskphone'
import { type DeskPhone, blankItem } from '../server/model'
import { validate } from '../server/store'
import { sampleConfig } from './helpers'

function setup(vendor: 'yealink' | 'snom') {
  const cfg = sampleConfig()
  cfg.ldap = { enabled: true, port: 389, password: 'buch' }
  cfg.parking = { ...cfg.parking, enabled: true, number: '700', slots: 3 }
  const phone: DeskPhone = {
    ...(blankItem('deskphones') as unknown as DeskPhone),
    id: 'xd1',
    name: 'Empfang',
    vendor,
    mac: '805ec0123456',
    extension: '10',
    admin_password: 'Geheim1',
    token: 't'.repeat(32),
    keys: [
      { type: 'blf', value: '11', label: '' },
      { type: 'speed', value: '0301111111', label: 'Kunde' },
      { type: 'park', value: '701', label: 'Park 1' },
      { type: 'dnd', value: '', label: '' },
    ],
  }
  for (const e of cfg.extensions) e.secret = 'geheim-12345'
  cfg.deskphones = [phone]
  return { cfg, phone, opts: { sipHost: '192.168.1.5', ldapHost: '192.168.1.5' } }
}

describe('Tischtelefone', () => {
  it('Yealink: Konto, Sprache, Telefonbuch und Tasten', () => {
    const { cfg, phone, opts } = setup('yealink')
    const ext = cfg.extensions.find((e) => e.number === '10')!
    const f = yealinkFile(cfg, phone, opts)
    expect(f.startsWith('#!version:1.0.0.1\n')).toBe(true)
    expect(f).toContain('account.1.user_name = 10')
    expect(f).toContain(`account.1.password = ${ext.secret}`)
    expect(f).toContain('account.1.sip_server.1.address = 192.168.1.5')
    expect(f).toContain('lang.gui = German')
    expect(f).toContain('local_time.time_zone_name = Germany(Berlin)')
    expect(f).toContain('static.security.user_password = admin:Geheim1')
    expect(f).toContain('ldap.base = dc=phone4all')
    expect(f).toContain('ldap.password = buch')
    expect(f).toContain('features.intercom.allow = 1')
    // erste Funktionstaste ist Leitungstaste 2: Besetztlampe mit Heranholen
    expect(f).toContain('linekey.2.type = 16')
    expect(f).toContain('linekey.2.value = 11')
    expect(f).toContain('linekey.2.label = Person 11')
    expect(f).toContain('linekey.2.extension = **')
    expect(f).toContain('linekey.3.type = 13')
    expect(f).toContain('linekey.3.label = Kunde')
    expect(f).toContain('linekey.5.type = 5')
  })

  it('Snom: XML mit Konto und Funktionstasten', () => {
    const { cfg, phone, opts } = setup('snom')
    const f = snomFile(cfg, phone, opts)
    expect(f).toContain('<user_name idx="1" perm="">10</user_name>')
    expect(f).toContain('<user_host idx="1" perm="">192.168.1.5:5060</user_host>')
    expect(f).toContain('<language perm="">Deutsch</language>')
    expect(f).toContain('<fkey idx="0" context="active" label="Person 11" perm="">blf &#60;sip:11@192.168.1.5&#62;|**</fkey>')
    expect(f).toContain('<fkey idx="3" context="active" label="Nicht stören" perm="">keyevent F_DND</fkey>')
    expect(f).toContain('<ldap_base perm="">dc=phone4all</ldap_base>')
  })

  it('erkennt Dateinamen und Geräte', () => {
    expect(isYealinkCommon('y000000000123.cfg')).toBe(true)
    expect(isYealinkCommon('805ec0123456.cfg')).toBe(false)
    expect(deskRequestMac('805EC0123456.cfg')).toBe('805ec0123456')
    expect(deskRequestMac('snom.xml')).toBe('')
    expect(agentMac('Yealink SIP-T54W 96.86.0.70 80:5e:c0:12:34:56')).toBe('805ec0123456')
    expect(agentMac('Mozilla/4.0 (compatible; snomD385-SIP 10.1.33.33; snom D385 jffs2 v3.36; 000413A1B2C3)')).toBe('000413a1b2c3')
    expect(describeDesk('Yealink SIP-T54W 96.86.0.70 80:5e:c0:12:34:56')).toBe('Yealink T54W 96.86.0.70')
    expect(describeDesk('Mozilla/4.0 (compatible; snomD385-SIP 10.1.33.33; 000413A1B2C3)')).toBe('Snom D385 10.1.33.33')
  })

  it('prüft MAC, Nebenstelle und Tasten', () => {
    const { cfg, phone } = setup('yealink')
    expect(() => validate(cfg)).not.toThrow()
    phone.mac = '80:5e:c0'
    expect(() => validate(cfg)).toThrow(/MAC-Adresse/)
    phone.mac = '805ec0123456'
    phone.keys.push({ type: 'speed', value: '', label: '' })
    expect(() => validate(cfg)).toThrow(/fehlt die Nummer/)
  })
})
