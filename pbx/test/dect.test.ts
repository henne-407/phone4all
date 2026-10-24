import { describe, expect, it } from 'vitest'
import { describeAgent, gigasetFile, handsetId, requestMac } from '../server/dect'
import type { DectBase } from '../server/model'
import { ValidationError, normalizeMac, validate } from '../server/store'
import { sampleConfig } from './helpers'

const base = (extra: Partial<DectBase> = {}): DectBase => ({
  id: 'd1',
  name: 'Büro',
  mac: '7c2f80e0d605',
  handsets: ['10', '', '11'],
  pin: '4711',
  admin_password: '',
  token: 'tok',
  ...extra,
})

const opts = { server: 'http://192.168.1.5:8080/dect/tok/', sipHost: '192.168.1.5', now: 1792850000 }

describe('Gigaset-Provisioning', () => {
  it('legt je Mobilteil ein SIP-Konto an der Anlage an', () => {
    const cfg = sampleConfig()
    cfg.extensions[1].voicemail.enabled = false
    const xml = gigasetFile(cfg, base(), opts)
    expect(xml).toContain('<provisioning version="1.1" productID="e2">')
    expect(xml).toContain('<param name="SipProvider.0.RegServerAddress" value="192.168.1.5"/>')
    expect(xml).toContain('<param name="Provisioning.global.ProvisioningServer" value="http://192.168.1.5:8080/dect/tok/"/>')
    // Mobilteil 1 = Nebenstelle 10, Platz 2 frei, Mobilteil 3 = Nebenstelle 11
    expect(xml).toContain('<param name="SipAccount.00001.AuthName" value="10"/>')
    expect(xml).toContain('<param name="SipAccount.00001.AuthPassword" value="s"/>')
    expect(xml).toContain('<param name="SipAccount.00001.VoiceMailMailbox" value="*97"/>')
    expect(xml).not.toContain('SipAccount.00002')
    expect(xml).toContain('<param name="SipAccount.00003.UserName" value="11"/>')
    expect(xml).toContain('<param name="SipAccount.00003.VoiceMailActive" value="0"/>')
    expect(xml).toContain('<param name="hs.00003.DECT_AC" value="4711"/>')
    expect(xml).toContain('<param name="RegStart" value="1792850000"/>')
    expect(xml).toContain('<param name="DmGlobal.0.TimeZone" value="Europe/Berlin"/>')
    expect(xml).not.toContain('WebUIAccounts')
  })

  it('maskiert Sonderzeichen und setzt das Passwort der Basis', () => {
    const cfg = sampleConfig()
    cfg.extensions[0].name = 'Anna "A" <Chefin> & Co -- Test'
    const xml = gigasetFile(cfg, base({ admin_password: 'Basis123' }), opts)
    expect(xml).toContain('value="Anna &#34;A&#34; &#60;Chefin&#62; &#38; Co -- Test"')
    expect(xml).toContain('<!-- Mobilteil 1: 10 Anna &#34;A&#34; &#60;Chefin&#62; &#38; Co - Test -->')
    expect(xml).toContain('<param name="WebUIAccounts.1.Password" value="Basis123"/>')
  })

  it('erkennt die Basis an Dateiname oder User-Agent', () => {
    expect(requestMac('7C2F80E0D605.xml', '')).toBe('7c2f80e0d605')
    expect(requestMac('', 'Gigaset N610 IP PRO/83.V2.65.0+build.8504c90;7C2F80E0D605')).toBe('7c2f80e0d605')
    expect(requestMac('master.bin', 'curl/8')).toBe('')
    expect(describeAgent('Gigaset N610 IP PRO/83.V2.65.0+build.8504c90;7C2F80E0D605')).toBe('N610 IP PRO 83.V2.65.0')
    expect(handsetId(0)).toBe('00001')
    expect(normalizeMac('7C:2F:80-E0.D6 05')).toBe('7c2f80e0d605')
  })

  it('prüft Mobilteile und MAC-Adresse', () => {
    const cfg = sampleConfig()
    for (const e of cfg.extensions) e.secret = 'geheim123'
    cfg.dect = [base()]
    expect(() => validate(cfg)).not.toThrow()
    cfg.dect = [base({ handsets: ['99'] })]
    expect(() => validate(cfg)).toThrow(ValidationError)
    cfg.dect = [base(), base({ id: 'd2', handsets: ['10'] })]
    expect(() => validate(cfg)).toThrow(/schon einem Mobilteil/)
    cfg.dect = [base({ mac: '7c2f80' })]
    expect(() => validate(cfg)).toThrow(/MAC/)
    cfg.dect = [base({ handsets: Array.from({ length: 21 }, () => '') })]
    expect(() => validate(cfg)).toThrow(/höchstens 20/)
  })
})
