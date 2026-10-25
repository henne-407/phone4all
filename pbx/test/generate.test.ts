import { describe, expect, it } from 'vitest'
import { generate } from '../server/generate'
import { gen, sampleConfig } from './helpers'

describe('Asterisk-Konfiguration', () => {
  const files = generate(sampleConfig(), gen)

  it('erzeugt Nebenstellen und Konten für PJSIP', () => {
    const pjsip = files['pjsip.conf']
    expect(pjsip).toContain('[10](p4a-ext)')
    expect(pjsip).toMatch(/\[trunk-t1\]\(p4a-trunk\)/)
    expect(pjsip).toContain('server_uri=sip:tel.t-online.de')
    expect(pjsip).toContain('password=geheim')
    expect(pjsip).toContain('deny=203.0.113.7')
    expect(pjsip).not.toContain('protocol=tls')
  })

  it('erzeugt Wählplan, Hinweise und Gruppen', () => {
    const ext = files['extensions.conf']
    expect(ext).toContain('[p4a-local]')
    expect(ext).toMatch(/exten => 10,hint,PJSIP\/10/)
    expect(ext).toContain('http://127.0.0.1:8080/internal')
    expect(files['voicemail.conf']).toContain('10 =>')
  })

  it('lädt keine veralteten Module', () => {
    expect(files['modules.conf']).toContain('autoload=no')
    expect(files['modules.conf']).not.toContain('chan_sip.so')
    expect(files['manager.conf']).toMatch(/bindaddr ?= ?127.0.0.1/)
  })
})
