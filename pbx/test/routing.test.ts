import { describe, expect, it } from 'vitest'
import { generate } from '../server/generate'
import { EMPTY_STATE, extensionPlan, feature, groupPlan, routeInbound, routeOutbound, type RuntimeState } from '../server/routing'
import { gen, sampleConfig, to } from './helpers'

const state = (): RuntimeState => structuredClone(EMPTY_STATE)

describe('Eingehende Anrufe', () => {
  it('nimmt das Standardziel des Kontos und sucht den Namen im Telefonbuch', () => {
    const cfg = sampleConfig()
    const r = routeInbound(cfg, { trunk: 't1', did: '+49301234567', to: '', cid: '+49301111111', name: '' }).split('|')
    expect(r[0]).toBe('p4a-group^g1')
    expect(r[1]).toBe('Max Kunde (Kunde GmbH)')
    expect(r[2]).toBe('0301111111')
  })

  it('bevorzugt die passendste Regel', () => {
    const cfg = sampleConfig()
    cfg.inbound = [
      { id: 'a', name: 'alle', number: '', trunk: '', caller: '', name_prefix: '', destination: to('extension', 'e11') },
      { id: 'b', name: 'Durchwahl', number: '030 1234568', trunk: 't1', caller: '', name_prefix: 'Support: ', destination: to('extension', 'e12') },
    ]
    expect(routeInbound(cfg, { trunk: 't1', did: '0049301234568', to: '', cid: '0171555', name: '' }).split('|').slice(0, 2)).toEqual([
      'p4a-local^12',
      'Support: 0171555',
    ])
    expect(routeInbound(cfg, { trunk: 't1', did: '+49301234567', to: '', cid: '', name: '' }).split('|')[0]).toBe('p4a-local^11')
  })
})

describe('Nebenstellen und Gruppen', () => {
  it('klingelt, leitet bei Nicht stören und Weiterleitung um', () => {
    const cfg = sampleConfig()
    const s = state()
    expect(extensionPlan(cfg, s, '10')).toBe('ring|25|0|p4a-vmb^10|p4a-vmu^10')
    expect(feature(cfg, s, '10', 'dnd', '').reply).toBe('on')
    expect(extensionPlan(cfg, s, '10')).toBe('goto|p4a-vmb^10')
    feature(cfg, s, '10', 'dnd', '')
    feature(cfg, s, '10', 'cfu', '11')
    expect(extensionPlan(cfg, s, '10')).toBe('goto|p4a-local^11')
    expect(feature(cfg, s, '10', 'cfu', '10').reply).toBe('error')
    feature(cfg, s, '10', 'cfu', '')
    // Nach außen umleiten ist standardmäßig nicht freigegeben
    expect(feature(cfg, s, '10', 'cfu', '0171 555').reply).toBe('error')
    cfg.provisioning.permissions.push('forward_external')
    feature(cfg, s, '10', 'cfu', '0171 555')
    expect(extensionPlan(cfg, s, '10')).toBe('goto|p4a-fwd^0171555')
  })

  it('lässt Mitglieder mit Nicht stören aus', () => {
    const cfg = sampleConfig()
    const s = state()
    s.dnd['11'] = true
    expect(groupPlan(cfg, s, 'g1', 'Max', '/snd')).toBe('all|30|10|p4a-vmu^10|Zentrale: Max||15')
  })
})

describe('Ausgehende Anrufe', () => {
  it('wählt im Format des Anbieters mit eigener Nummer', () => {
    const cfg = sampleConfig()
    cfg.extensions[0].outbound_cid = '030 1234568'
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '0171 5551234', cid: '10' })).toBe('ok|trunk-t1|+491715551234|+49301234568')
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '5551234', cid: '10' })).toBe('ok|trunk-t1|+49305551234|+49301234568')
  })

  it('nimmt das SIP-Konto der eigenen Nummer zuerst', () => {
    const cfg = sampleConfig()
    cfg.trunks.push({ ...cfg.trunks[0], id: 't2', name: 'sipgate', number_format: 'e164', numbers: ['040 999888'], default_cid: '' })
    cfg.extensions[0].outbound_cid = '040 999888'
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '0171 5551234', cid: '10' })).toBe(
      'ok|trunk-t2|+491715551234|+4940999888|trunk-t1|+491715551234|+49301234567',
    )
  })

  it('stellt Anrufe auf eigene Nummern intern durch', () => {
    const cfg = sampleConfig()
    cfg.trunks.push({ ...cfg.trunks[0], id: 't2', name: 'sipgate', numbers: ['040 999888'], inbound_default: to('extension', 'e12') })
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '040999888', cid: '10' })).toBe('local|p4a-local^12|Person 10|10|040999888')
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '+49 30 1234567', cid: '10' }).startsWith('local|')).toBe(true)
    // Ohne Vorwahl, obwohl das Konto in einem anderen Ortsnetz liegt (Ortsvorwahl der Anlage: 30)
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '999888', cid: '10' })).toBe('local|p4a-local^12|Person 10|10|040999888')
    // … und im eigenen Ortsnetz
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '1234567', cid: '10' }).startsWith('local|')).toBe(true)
    // Fremde Ortsnummer geht weiter nach außen
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '5551234', cid: '10' }).startsWith('ok|')).toBe(true)
  })

  it('ergänzt die Ortsvorwahl auch bei kurzen Ortsnummern', () => {
    const cfg = sampleConfig()
    cfg.trunks.push({ ...cfg.trunks[0], id: 't2', name: 'sipgate', numbers: ['030 456'], inbound_default: to('extension', 'e12') })
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '456', cid: '10' })).toBe('local|p4a-local^12|Person 10|10|030456')
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '789', cid: '10' }).startsWith('ok|trunk-t1|+4930789|')).toBe(true)
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '112', cid: '10' }).startsWith('ok|trunk-t1|112|')).toBe(true)
  })

  it('stellt eigene Nummern ohne Vorwahl auch ohne eingestellte Ortsvorwahl intern durch', () => {
    const cfg = sampleConfig()
    cfg.system.area_code = ''
    cfg.trunks.push({ ...cfg.trunks[0], id: 't2', name: 'sipgate', numbers: ['040 999888'], inbound_default: to('extension', 'e12') })
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '999888', cid: '10' })).toBe('local|p4a-local^12|Person 10|10|040999888')
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '5551234', cid: '10' })).toBe('invalid')
  })

  it('beachtet Berechtigungen und Sonderrufnummern', () => {
    const cfg = sampleConfig()
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '0043 1234', cid: '' })).toBe('deny')
    expect(routeOutbound(cfg, { ext: '11', fwd: '', num: '0043 1234', cid: '' }).startsWith('ok|')).toBe(true)
    expect(routeOutbound(cfg, { ext: '12', fwd: '', num: '0301234', cid: '' })).toBe('deny')
    expect(routeOutbound(cfg, { ext: '12', fwd: '', num: '112', cid: '' })).toBe('ok|trunk-t1|112|+49301234567')
    expect(routeOutbound(cfg, { ext: '11', fwd: '', num: '0900 123456', cid: '' })).toBe('deny')
    expect(routeOutbound(cfg, { ext: '11', fwd: '', num: '11833', cid: '' })).toBe('deny')
    expect(routeOutbound(cfg, { ext: '99', fwd: '', num: '0301234', cid: '' })).toBe('deny')
  })

  it('bremst Gebührenbetrug: Sonderrufnummern, Länder, Uhrzeit, Umleitungen, Notbremse', () => {
    const cfg = sampleConfig()
    const out = (num: string, ext = '11', fwd = '', now = new Date('2026-10-28T12:00:00Z')) =>
      routeOutbound(cfg, { ext, fwd, num, cid: '' }, now).split('|')[0]
    for (const n of ['0180 5123456', '012 3456789', '0700 1234567', '0137 1234567', '0019 1', '00881 612345678']) expect(out(n)).toBe('deny')
    cfg.extensions[1].allow_premium = true
    expect(out('0180 5123456')).toBe('ok')
    cfg.extensions[1].allow_premium = false
    // Länderliste: Österreich ja, Jamaika (+1 876) nicht; '*' = alle
    expect(out('0043 1234')).toBe('ok')
    expect(out('001 876 5551234')).toBe('deny')
    cfg.security.countries = ['*']
    expect(out('001 876 5551234')).toBe('ok')
    // Ausland nur tagsüber (Berlin: 23:30 Uhr)
    cfg.security.international_daytime = true
    expect(out('0043 1234', '11', '', new Date('2026-10-28T22:30:00Z'))).toBe('deny')
    expect(out('0043 1234')).toBe('ok')
    // Umleitungen ins Ausland nur mit Freigabe
    expect(out('0043 1234', '', '11')).toBe('deny')
    cfg.security.forward_international = true
    expect(out('0043 1234', '', '11')).toBe('ok')
    // Notbremse: nichts mehr nach außen, Notruf geht
    cfg.security.outbound_stop = true
    expect(out('030 7654321', '10')).toBe('deny')
    expect(out('11833')).toBe('deny')
    expect(out('112', '12')).toBe('ok')
  })

  it('begrenzt gleichzeitige Gespräche nach außen im Wählplan', () => {
    const cfg = sampleConfig()
    let conf = generate(cfg, gen)['extensions.conf']
    expect(conf).toContain('GotoIf($[${GROUP_COUNT(all@p4a-out)} > 6]?limit)')
    expect(conf).toContain('GotoIf($[${GROUP_COUNT(${P4A_ACTOR}@p4a-actor)} > 2]?limit)')
    expect(conf).toContain('n(limit),Set(R=${CURL(${P4A_API}/alert?kind=limit&ext=${URIENCODE(${P4A_ACTOR:1})})})')
    expect(generate(cfg, gen)['modules.conf']).toContain('func_groupcount.so')
    cfg.security.max_calls_ext = 0
    cfg.security.max_calls_total = 0
    conf = generate(cfg, gen)['extensions.conf']
    expect(conf).not.toContain('GROUP_COUNT')
    expect(conf).not.toContain('n(limit)')
  })

  it('folgt Wahlregeln mit Ausweichkonto', () => {
    const cfg = sampleConfig()
    cfg.trunks.push({ ...cfg.trunks[0], id: 't2', name: 'sipgate', number_format: 'e164_no_plus', numbers: [], default_cid: '' })
    cfg.outbound = [{ id: 'o1', name: 'Mobil', prefixes: ['015', '016', '017'], trunks: ['t2', 't1'], extensions: [] }]
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '01715551234', cid: '' })).toBe(
      'ok|trunk-t2|491715551234||trunk-t1|+491715551234|+49301234567',
    )
    expect(routeOutbound(cfg, { ext: '10', fwd: '', num: '030555', cid: '' })).toBe('deny')
  })
})

describe('Fremde Voicemail (*98)', () => {
  it('nur mit Recht, und nie mit der Nebenstellennummer als PIN', () => {
    const cfg = sampleConfig()
    const s: RuntimeState = structuredClone(EMPTY_STATE)
    expect(feature(cfg, s, '10', 'vmother', '').reply).toBe('error')
    cfg.groups[0].permissions = ['voicemail_other']
    const member = cfg.groups[0].members[0]
    expect(feature(cfg, s, member, 'vmother', '').reply).toBe('on')
    cfg.extensions[0].voicemail.pin = 'abc'
    expect(generate(cfg, gen)['voicemail.conf']).not.toMatch(/^10 => 10,/m)
    expect(generate(cfg, gen)['extensions.conf']).toMatch(/code=vmother/)
  })
})
