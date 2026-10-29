import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PortalSessions } from '../server/portal'
import { UserStore, forbidden } from '../server/users'

describe('Zugänge und Rollen', () => {
  it('Rollen dürfen nur, was zu ihnen passt', () => {
    expect(forbidden('admin', 'PUT', '/api/config/system')).toBe('')
    expect(forbidden('operator', 'POST', '/api/extensions')).toBe('')
    expect(forbidden('operator', 'DELETE', '/api/groups/x1')).toBe('')
    expect(forbidden('operator', 'PUT', '/api/groups/x1/members/10')).toBe('')
    expect(forbidden('operator', 'POST', '/api/trunks')).toMatch(/Berechtigung/)
    expect(forbidden('operator', 'PUT', '/api/config/security')).toMatch(/Berechtigung/)
    expect(forbidden('operator', 'GET', '/api/config')).toBe('')
    expect(forbidden('operator', 'GET', '/api/export')).toMatch(/Verwaltung/)
    expect(forbidden('operator', 'GET', '/api/users')).toMatch(/Verwaltung/)
    expect(forbidden('operator', 'GET', '/api/extensions/x1/provisioning')).toBe('')
    expect(forbidden('viewer', 'GET', '/api/extensions/x1/provisioning')).toMatch(/Zugangsdaten/)
    expect(forbidden('viewer', 'GET', '/api/dect/x1/file')).toMatch(/Zugangsdaten/)
    expect(forbidden('viewer', 'POST', '/api/extensions')).toMatch(/nur ansehen/)
    expect(forbidden('viewer', 'POST', '/api/password')).toBe('')
    expect(forbidden('viewer', 'GET', '/api/calls')).toBe('')
  })

  it('legt Zugänge an, prüft Passwörter und Namen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-users-'))
    try {
      const file = path.join(dir, 'users.json')
      const store = new UserStore(file)
      const u = store.add('Sekretariat', 'Petra', 'operator', 'sehr-geheim-1')
      expect(u).toMatchObject({ login: 'sekretariat', role: 'operator' })
      expect(u).not.toHaveProperty('hash')
      expect(() => store.add('sekretariat', '', 'viewer', 'sehr-geheim-1')).toThrow(/gibt es schon/)
      expect(() => store.add('admin', '', 'viewer', 'sehr-geheim-1')).toThrow(/reserviert/)
      expect(() => store.add('x y', '', 'viewer', 'sehr-geheim-1')).toThrow(/Anmeldename/)
      expect(() => store.add('kurz', '', 'viewer', 'kurz')).toThrow(/mindestens 10/)
      expect(store.check('sekretariat', 'falsch-falsch')).toBeNull()
      expect(store.check('niemand', 'sehr-geheim-1')).toBeNull()
      expect(store.check('SEKRETARIAT', 'sehr-geheim-1')?.last).toBeGreaterThan(0)
      store.update(u.id, { role: 'viewer', password: 'anderes-geheim' })
      const again = new UserStore(file)
      expect(again.check('sekretariat', 'anderes-geheim')?.role).toBe('viewer')
      again.remove(u.id)
      expect(again.list()).toEqual([])
      expect(fs.statSync(file).mode & 0o077).toBe(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Selbstbedienung', () => {
  it('Sitzungen und Sperre nach fünf falschen PINs', () => {
    const p = new PortalSessions()
    const t = p.login('10')
    expect(p.ext(t)).toBe('10')
    expect(p.ext('falsch')).toBe('')
    const now = Date.now()
    for (let i = 0; i < 4; i++) p.failed('11', now)
    expect(p.locked('11', now)).toBe(false)
    p.failed('11', now)
    expect(p.locked('11', now)).toBe(true)
    expect(p.locked('11', now + 16 * 60000)).toBe(false)
    p.succeeded('11')
    expect(p.locked('11', now)).toBe(false)
    const t2 = p.login('10')
    p.logoutExt('10', t2)
    expect(p.ext(t)).toBe('')
    expect(p.ext(t2)).toBe('10')
  })
})
