import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false, getAppPath: () => '/tmp' }, safeStorage: {} }))

import { isDialLink, numberFromLink, numberFromText } from '../src/main/links'
import { crmUrl, parsePermissions, parsePresence, parseProfile } from '../src/main/provisioning'

describe('Wähl-Links', () => {
  it('erkennt tel:, callto: und sip:, aber nicht den Einrichtungslink', () => {
    expect(isDialLink('tel:+4930123')).toBe(true)
    expect(isDialLink('callto://0301234')).toBe(true)
    expect(isDialLink('sip:10@pbx.local')).toBe(true)
    expect(isDialLink('sip-telefon://provision?url=x')).toBe(false)
  })

  it('liest die Nummer aus dem Link', () => {
    expect(numberFromLink('tel:+49-30-123%20456')).toBe('+4930123456')
    expect(numberFromLink('tel:030123456;phone-context=example.com')).toBe('030123456')
    expect(numberFromLink('callto://+4930123456')).toBe('+4930123456')
    expect(numberFromLink('sip:10@pbx.local;transport=tcp')).toBe('10')
    expect(numberFromLink('tel:abc')).toBe('')
  })

  it('findet die Nummer in markiertem Text', () => {
    expect(numberFromText(' 030 / 123 45-6 ')).toBe('030123456')
    expect(numberFromText('11')).toBe('11')
    expect(numberFromText('Ruf mich an: +49 171 2345678, danke')).toBe('+491712345678')
    expect(numberFromText('kein Text mit Nummer')).toBe('')
  })
})

describe('Telefonanlage: Welle 1', () => {
  it('füllt die CRM-Adresse', () => {
    expect(crmUrl('https://crm/s?t={e164}&n={nummer}&q={name}', '030 123456', 'Anna Müller')).toBe(
      'https://crm/s?t=%2B4930123456&n=030123456&q=Anna%20M%C3%BCller',
    )
    expect(crmUrl('https://crm/{e164}', '+41441234567', '')).toBe('https://crm/%2B41441234567')
  })

  it('übernimmt Parken, CRM und Voicemail aus dem Profil', () => {
    const base = { format: 'phone4all-provisioning', account: { user: '10', domain: 'pbx', transport: 'udp' }, password: 'geheim123' }
    const p = parseProfile({ ...base, parking: { number: '700', slots: ['701', '702'] }, crm: { url: 'https://crm/{e164}', auto: true }, voicemail: true })
    expect(p.parking).toEqual({ number: '700', slots: ['701', '702'] })
    expect(p.crm).toEqual({ url: 'https://crm/{e164}', auto: true })
    expect(p.voicemail).toBe(true)
    const old = parseProfile({ ...base, crm: { url: 'javascript:alert(1)' } })
    expect([old.parking, old.crm, old.voicemail]).toEqual([null, null, false])
    expect(parsePermissions(['forward', 'block_numbers', 'x'])).toEqual(['forward', 'block_numbers'])
  })

  it('prüft die Besetztanzeige', () => {
    const p = parsePresence({
      revision: '3-x',
      extensions: [{ number: '10', name: 'Anna', state: 'busy', dnd: false, forward: '' }, { number: '11', state: 'weird' }, null],
      parked: [{ slot: '701', number: '0301', name: 'Max', by: '10', since: 1, until: 2 }],
      voicemail: { unread: 2, revision: 'r' },
    })
    expect(p?.extensions).toEqual([
      { number: '10', name: 'Anna', state: 'busy', dnd: false, forward: '' },
      { number: '11', name: '', state: 'offline', dnd: false, forward: '' },
    ])
    expect(p?.parked[0].slot).toBe('701')
    expect(p?.voicemail).toEqual({ unread: 2, revision: 'r' })
    expect(parsePresence({ error: 'x' })).toBeNull()
  })
})
