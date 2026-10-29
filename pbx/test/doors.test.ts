import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ext, sampleConfig } from './helpers'

process.env.PBX_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-door-'))

const { profile } = await import('../server/provisioning')

describe('Türsprechstelle in den Apps', () => {
  it('nennt Türen mit Öffnen-Tasten im Profil', () => {
    const cfg = sampleConfig()
    const anna = ext('a', '10')
    const tuer = ext('t', '19', { door: { enabled: true, dtmf: '*9' } })
    const ohne = ext('o', '18', { door: { enabled: true, dtmf: '' } })
    cfg.extensions = [anna, tuer, ohne]
    expect(profile(cfg, anna, 'https://pbx.example').doors).toEqual([{ number: '19', name: 'Person 19', dtmf: '*9' }])
  })
})
