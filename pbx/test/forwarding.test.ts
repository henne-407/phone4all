import { describe, expect, it } from 'vitest'
import { ForwardError, applyCfu, applyRules, forwardInfo } from '../server/forwarding'
import type { ForwardRule } from '../server/model'
import { EMPTY_STATE, activeForward, appPermissions, extensionPlan, feature, type RuntimeState } from '../server/routing'
import { validate } from '../server/store'
import { sampleConfig } from './helpers'

const state = (): RuntimeState => structuredClone(EMPTY_STATE)

const rule = (extra: Partial<ForwardRule>): ForwardRule => ({
  id: 'r1',
  enabled: true,
  when: 'schedule',
  days: [1, 2, 3, 4, 5],
  from: '18:00',
  to: '08:00',
  timecondition: '',
  tc_state: 'closed',
  target: '11',
  ...extra,
})

// Montag, 26.10.2026 (Ortszeit Berlin, UTC+1)
const evening = new Date('2026-10-26T19:30:00+01:00')
const noon = new Date('2026-10-26T12:00:00+01:00')

describe('Umleitungsregeln', () => {
  it('schaltet nach Zeitplan, auch über Mitternacht', () => {
    const cfg = sampleConfig()
    cfg.extensions[0].forward.rules = [rule({})]
    expect(activeForward(cfg, state(), '10', evening)).toBe('11')
    expect(activeForward(cfg, state(), '10', noon)).toBe('')
    expect(activeForward(cfg, state(), '10', new Date('2026-10-27T07:00:00+01:00'))).toBe('11')
    expect(extensionPlan(cfg, state(), '10', evening)).toBe('goto|p4a-local^11')
  })

  it('folgt einer Zeitsteuerung und „Nicht stören“', () => {
    const cfg = sampleConfig()
    cfg.timeconditions = [
      { id: 'tc1', name: 'Büro', rules: [{ days: [1, 2, 3, 4, 5], from: '08:00', to: '17:00' }], holidays: false, closed_dates: [], override: 'auto' } as never,
    ]
    cfg.extensions[0].forward.rules = [rule({ when: 'timecondition', timecondition: 'tc1', target: '0171222333' })]
    expect(activeForward(cfg, state(), '10', evening)).toBe('0171222333')
    expect(activeForward(cfg, state(), '10', noon)).toBe('')

    cfg.extensions[0].forward.rules = [rule({ when: 'dnd' })]
    const s = state()
    expect(activeForward(cfg, s, '10', noon)).toBe('')
    feature(cfg, s, '10', 'dnd', '')
    expect(extensionPlan(cfg, s, '10', noon)).toBe('goto|p4a-local^11')
  })

  it('Sofort-Umleitung geht vor, abgeschaltete Regeln greifen nicht', () => {
    const cfg = sampleConfig()
    cfg.extensions[0].forward.rules = [rule({ enabled: false })]
    const s = state()
    expect(activeForward(cfg, s, '10', evening)).toBe('')
    s.cfu['10'] = '12'
    cfg.extensions[0].forward.rules[0].enabled = true
    expect(activeForward(cfg, s, '10', evening)).toBe('12')
  })

  it('prüft Regeln beim Speichern', () => {
    const cfg = sampleConfig()
    for (const e of cfg.extensions) e.secret = 'geheim1234'
    cfg.extensions[0].forward.rules = [rule({ from: '25:00' })]
    expect(() => validate(cfg)).toThrow(/Uhrzeit/)
    cfg.extensions[0].forward.rules = [rule({ id: '', target: '' })]
    expect(() => validate(cfg)).toThrow(/Ziel/)
    cfg.extensions[0].forward.rules = [rule({ id: '' })]
    validate(cfg)
    expect(cfg.extensions[0].forward.rules[0].id).not.toBe('')
  })
})

describe('Rechte in der App', () => {
  it('Grundrechte plus Rechte der Gruppen', () => {
    const cfg = sampleConfig()
    cfg.provisioning.permissions = ['forward']
    cfg.groups[0].permissions = ['phonebook_edit']
    expect(appPermissions(cfg, '10').sort()).toEqual(['forward', 'phonebook_edit'])
    expect(appPermissions(cfg, '12')).toEqual(['forward'])
  })

  it('beschränkt Umleitungen auf erlaubte Ziele', () => {
    const cfg = sampleConfig()
    cfg.provisioning.permissions = ['forward']
    const s = state()
    applyCfu(cfg, s, '12', '11')
    expect(s.cfu['12']).toBe('11')
    expect(() => applyCfu(cfg, s, '12', '0171222333')).toThrow(ForwardError)
    expect(() => applyCfu(cfg, s, '12', '12')).toThrow(ForwardError)
    expect(feature(cfg, s, '12', 'cfu', '0171222333').reply).toBe('error')
    applyCfu(cfg, s, '12', '')
    expect(s.cfu['12']).toBeUndefined()

    cfg.provisioning.permissions = []
    expect(() => applyCfu(cfg, s, '12', '11')).toThrow(/nicht freigegeben/)
    expect(() => applyRules(cfg, cfg.extensions[2], { busy: '11' })).toThrow(/Umleitungsregeln/)
    cfg.groups[0].permissions = ['forward_rules']
    applyRules(cfg, cfg.extensions[0], { busy: '11', rules: [rule({})] })
    expect(cfg.extensions[0].forward.busy).toBe('11')
  })

  it('liefert der App Zustand und Ziele', () => {
    const cfg = sampleConfig()
    const s = state()
    s.cfu['10'] = '20'
    const info = forwardInfo(cfg, s, cfg.extensions[0], noon)
    expect(info.cfu).toBe('20')
    expect(info.active).toBe('20')
    expect(info.targets.map((t) => t.number)).toEqual(['11', '12', '20'])
    expect(info.permissions).toContain('forward_external')
  })
})

describe('Telefonbuch aus der App', () => {
  it('gibt bearbeitbaren Einträgen eine ID', async () => {
    const { profile } = await import('../server/provisioning')
    const cfg = sampleConfig()
    cfg.provisioning.permissions = []
    const ids = (): (string | undefined)[] => profile(cfg, cfg.extensions[0], 'http://pbx').phonebook.map((e) => e.id)
    expect(ids().filter(Boolean)).toEqual([])
    cfg.groups[0].permissions = ['phonebook_edit']
    expect(ids().filter(Boolean)).toEqual(['p1'])
    expect(profile(cfg, cfg.extensions[2], 'http://pbx').permissions).toEqual([])
  })
})
