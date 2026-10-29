import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

process.env.PBX_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-sec-'))

const { Auth, limitKey } = await import('../server/auth')
const { Guard } = await import('../server/security')
const { consumePin, pinValid, renewPin, PIN_HOURS } = await import('../server/store')
const { MessengerHub, MessengerStore } = await import('../server/messenger')
const { ext, sampleConfig } = await import('./helpers')

describe('Fehlversuche und Sperren', () => {
  it('fasst IPv6-Adressen je /64 zusammen', () => {
    expect(limitKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64')
    expect(limitKey('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64')
    expect(limitKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(limitKey('203.0.113.5')).toBe('203.0.113.5')
  })

  it('bremst nach zehn Fehlversuchen, auch bei wechselnden IPv6-Adressen', () => {
    const auth = new Auth()
    const blocked: string[] = []
    auth.onBlock = (ip) => blocked.push(ip)
    for (let i = 1; i <= 9; i++) auth.failed(`2001:db8:1:2::${i}`)
    expect(auth.blocked('2001:db8:1:2::99')).toBe(false)
    auth.failed('2001:db8:1:2::10')
    expect(auth.blocked('2001:db8:1:2::99')).toBe(true)
    expect(auth.blocked('2001:db8:1:3::1')).toBe(false)
    expect(blocked).toEqual(['2001:db8:1:2::10'])
  })

  it('zählt denselben ungültigen Link nur einmal', () => {
    const auth = new Auth()
    for (let i = 0; i < 50; i++) auth.failed('198.51.100.1', 'Link', 'alter-token')
    expect(auth.blocked('198.51.100.1')).toBe(false)
    for (let i = 0; i < 10; i++) auth.failed('198.51.100.1', 'Link', `token-${i}`)
    expect(auth.blocked('198.51.100.1')).toBe(true)
  })

  it('übernimmt Sperren aus der Weboberfläche, aber nie für „Nie sperren“', () => {
    const cfg = sampleConfig()
    cfg.security.whitelist = ['192.168.0.0/16']
    const guard = new Guard(() => cfg.security)
    const bans: string[] = []
    guard.on('ban', (ip: string) => bans.push(ip))
    guard.report('203.0.113.7', 'Test')
    guard.report('192.168.1.5', 'Test')
    expect(guard.isBanned('203.0.113.7')).toBe(true)
    expect(guard.isBanned('192.168.1.5')).toBe(false)
    expect(bans).toEqual(['203.0.113.7'])
    guard.unban('203.0.113.7')
  })
})

describe('Einrichtungs-PIN', () => {
  it('gilt befristet und nur einmal', () => {
    const e = ext('e1', '10')
    const now = Date.now()
    renewPin(e, now)
    expect(e.provision_pin).toMatch(/^\d{6}$/)
    expect(pinValid(e, now + 1000)).toBe(true)
    expect(pinValid(e, now + PIN_HOURS * 3600000 + 1)).toBe(false)
    const old = e.provision_pin
    consumePin(e)
    expect(pinValid(e)).toBe(false)
    expect(e.provision_pin).not.toBe(old)
  })
})

describe('Kontingent im Messenger', () => {
  it('begrenzt Speicher und Anzahl der Dateien je Nebenstelle', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-quota-'))
    const cfg = sampleConfig()
    cfg.messenger.quota_mb = 1
    const hub = new MessengerHub(new MessengerStore(dir), () => cfg)
    const room = hub.store.direct('10', '11')
    const mb = Buffer.alloc(600 * 1024)
    hub.postFile('10', room.id, 'a.bin', 'application/octet-stream', mb)
    expect(() => hub.postFile('10', room.id, 'b.bin', 'application/octet-stream', mb)).toThrow(/Speicher im Messenger ist voll/)
    // Andere Nebenstelle hat ihr eigenes Kontingent
    hub.postFile('11', room.id, 'c.bin', 'application/octet-stream', mb)
    cfg.messenger.quota_mb = 0
    const tiny = Buffer.from('x')
    for (let i = 0; i < 29; i++) hub.postFile('10', room.id, `${i}.txt`, 'text/plain', tiny)
    expect(() => hub.postFile('10', room.id, 'zu-viel.txt', 'text/plain', tiny)).toThrow(/Zu viele Dateien/)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
