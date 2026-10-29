import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

process.env.PBX_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-test-'))

const { ConfigStore, ValidationError } = await import('../server/store')

describe('Konfiguration', () => {
  let store: InstanceType<typeof ConfigStore>
  beforeAll(() => {
    store = new ConfigStore()
  })

  it('legt Nebenstellen mit Passwort und Einrichtungs-PIN an', () => {
    const e = store.upsert('extensions', { number: '10', name: 'Anna' })
    expect(e.id).toMatch(/^x/)
    expect(String(e.secret).length).toBeGreaterThanOrEqual(16)
    expect(String(e.provision_pin)).toMatch(/^\d{6}$/)
  })

  it('lehnt doppelte Nummern ab', () => {
    expect(() => store.upsert('extensions', { number: '10', name: 'Bert' })).toThrow(ValidationError)
    expect(store.config.extensions).toHaveLength(1)
  })

  it('exportiert ohne Passwörter und übernimmt sie beim Import', () => {
    const secret = store.config.extensions[0].secret
    const data = store.exportData(false, false, 'test')
    expect(JSON.stringify(data)).not.toContain(secret)
    data.config.extensions[0].name = 'Anna Neu'
    store.importData(data)
    expect(store.config.extensions[0].name).toBe('Anna Neu')
    expect(store.config.extensions[0].secret).toBe(secret)
    expect(store.backups().some((b) => b.name.includes('vor-import'))).toBe(true)
  })

  it('lässt beim Import keine Zeilen in die Asterisk-Konfiguration schmuggeln', () => {
    const data = store.exportData(true, false, 'test')
    data.config.trunks = [{ ...(data.config.trunks[0] ?? {}), id: 'x]\n[evil', name: 'Böse', registrar: 'sip.example.de', enabled: false } as never]
    expect(() => store.importData(data)).toThrow(/Ungültige ID/)
  })

  it('prüft Adressen und Netze in den Sicherheitseinstellungen', () => {
    expect(() => store.update((d) => void (d.security.trusted_proxies = ['192.168.1.0/33']))).toThrow(/Vertrauenswürdige Proxys/)
    expect(() => store.update((d) => void (d.security.whitelist = ['irgendwas']))).toThrow(/Nie sperren/)
    store.update((d) => void (d.security.trusted_proxies = ['192.168.1.20', '10.0.0.0/8', '::1']))
    expect(store.config.security.trusted_proxies).toContain('10.0.0.0/8')
  })

  it('weist fremde Dateien zurück', () => {
    expect(() => store.importData({ format: 'other' } as never)).toThrow(ValidationError)
  })

  it('entfernt gelöschte Nebenstellen aus Gruppen', () => {
    const b = store.upsert('extensions', { number: '11', name: 'Bert' })
    store.upsert('groups', { number: '20', name: 'Alle', members: ['10', '11'] })
    store.remove('extensions', String(b.id))
    expect(store.config.groups[0].members).toEqual(['10'])
  })
})

describe('Sicherungen', () => {
  it('nimmt Nicht stören und Umleitungen mit und spielt sie zurück', () => {
    const store = new ConfigStore()
    if (!store.config.extensions.some((e) => e.number === '10')) store.upsert('extensions', { number: '10', name: 'Anna' })
    store.state.dnd = { '10': true }
    store.state.cfu = { '10': '0171555' }
    const data = store.exportData(false, false, 'test')
    store.state.dnd = {}
    store.state.cfu = {}
    data.state = { dnd: { '10': true, '99': true }, cfu: { '10': '0171555', x: 5 as never } }
    store.importData(data)
    expect(store.state).toEqual({ dnd: { '10': true }, cfu: { '10': '0171555' } })
  })

  it('hebt je Anlass getrennt auf, damit tägliche Sicherungen die übrigen nicht verdrängen', async () => {
    const store = new ConfigStore()
    const { PATHS } = await import('../server/paths')
    for (const f of fs.readdirSync(PATHS.backups)) fs.rmSync(path.join(PATHS.backups, f))
    const old = new Date(Date.now() - 86400000)
    fs.writeFileSync(path.join(PATHS.backups, '2020-01-01T00-00-00-vor-import.json'), '{}')
    fs.utimesSync(path.join(PATHS.backups, '2020-01-01T00-00-00-vor-import.json'), old, old)
    for (let i = 0; i < 20; i++) {
      const name = `2020-01-02T00-00-${String(i).padStart(2, '0')}-taeglich.json`
      fs.writeFileSync(path.join(PATHS.backups, name), '{}')
      const t = new Date(old.getTime() + i * 1000)
      fs.utimesSync(path.join(PATHS.backups, name), t, t)
    }
    store.backup('taeglich')
    const names = store.backups().map((b) => b.name)
    expect(names.filter((n) => n.endsWith('-taeglich.json'))).toHaveLength(14)
    expect(names).toContain('2020-01-01T00-00-00-vor-import.json')
  })
})

describe('Beschädigte Konfiguration', () => {
  it('lädt die neueste Sicherung statt einer leeren Anlage', async () => {
    const store = new ConfigStore()
    store.upsert('extensions', { number: '77', name: 'Gesichert' })
    const name = store.backup('test')
    const { PATHS } = await import('../server/paths')
    // Eindeutig die neueste Sicherung, auch wenn mehrere in derselben Millisekunde entstanden
    const later = new Date(Date.now() + 10000)
    fs.utimesSync(path.join(PATHS.backups, name), later, later)
    fs.writeFileSync(PATHS.config, '{"extensions": [ abgeschnitten')
    const again = new ConfigStore()
    expect(again.recovered).toContain('wiederhergestellt')
    expect(again.config.extensions.some((e) => e.number === '77')).toBe(true)
    expect(fs.readdirSync(PATHS.data).some((f) => f.startsWith('config.json.defekt-'))).toBe(true)
    // Wiederhergestellt und gleich wieder gespeichert
    expect(JSON.parse(fs.readFileSync(PATHS.config, 'utf8')).extensions.length).toBeGreaterThan(0)
  })
})
