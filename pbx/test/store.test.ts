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
