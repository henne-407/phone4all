import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CallTracker, type GroupMissedCall } from '../server/events'
import { applyRules, forwardInfo } from '../server/forwarding'
import { extensionsConf } from '../server/generate/dialplan'
import { MissedList } from '../server/missed'
import { type CentralCalendar, type ForwardRule, blankItem } from '../server/model'
import { Presence } from '../server/presence'
import {
  EMPTY_STATE,
  type RuntimeState,
  calendarNote,
  calendarStatus,
  dndActive,
  extensionPlan,
  feature,
  groupPlan,
  isAvailable,
  keywordMatch,
  memberGroups,
  mobilePlan,
  pagePlan,
  ringPlan,
} from '../server/routing'
import { validate } from '../server/store'
import { gen, sampleConfig } from './helpers'

const state = (): RuntimeState => structuredClone(EMPTY_STATE)

function validConfig(): ReturnType<typeof sampleConfig> {
  const cfg = sampleConfig()
  for (const e of cfg.extensions) e.secret = 'geheim12345'
  return cfg
}

const rule = (patch: Partial<ForwardRule>): ForwardRule => ({
  id: 'r1',
  enabled: true,
  when: 'schedule',
  days: [1, 2, 3, 4, 5, 6, 7],
  from: '00:00',
  to: '23:59',
  timecondition: '',
  tc_state: 'closed',
  target: '11',
  ...patch,
})

afterEach(() => {
  calendarStatus.find = () => null
})

describe('An- und Abmelden aus Gruppen', () => {
  it('meldet mit *45 aus allen Gruppen ab und wieder an', () => {
    const cfg = sampleConfig()
    const s = state()
    expect(feature(cfg, s, '10', 'away', '').reply).toBe('off')
    expect(s.away['10']).toEqual(['g1'])
    expect(groupPlan(cfg, s, 'g1', 'Anrufer', '/s').split('|')[2]).toBe('11')
    expect(isAvailable(s, '10', cfg, 'g1')).toBe(false)
    expect(isAvailable(s, '10', cfg)).toBe(true)
    expect(feature(cfg, s, '10', 'away', '20').reply).toBe('on')
    expect(s.away['10']).toBeUndefined()
    expect(memberGroups(cfg, s, '10')).toEqual([{ id: 'g1', number: '20', name: 'Zentrale', active: true }])
  })

  it('kennt nur eigene Gruppen', () => {
    const cfg = sampleConfig()
    expect(feature(cfg, state(), '12', 'away', '').reply).toBe('error')
    expect(feature(cfg, state(), '10', 'away', '99').reply).toBe('error')
  })
})

describe('Status aus dem Kalender', () => {
  it('erkennt Stichwörter unabhängig von Groß- und Kleinschreibung', () => {
    expect(keywordMatch('Urlaub Anna Müller', 'urlaub anna')).toBe(true)
    expect(keywordMatch('Urlaub Bernd', 'urlaub anna')).toBe(false)
    expect(keywordMatch('Irgendwas', '')).toBe(true)
  })

  it('leitet bei Termin um oder schaltet Nicht stören ein', () => {
    const cfg = sampleConfig()
    cfg.extensions[0].forward.rules = [rule({ when: 'calendar', calendar: 'c1', keyword: 'Urlaub Person 10', target: '11' })]
    const s = state()
    expect(extensionPlan(cfg, s, '10')).toMatch(/^ring/)
    const end = new Date(2026, 9, 31).getTime()
    calendarStatus.find = (id, kw) => (id === 'c1' && kw === 'Urlaub Person 10' ? { summary: 'Urlaub Person 10', end, allDay: true } : null)
    expect(extensionPlan(cfg, s, '10')).toBe('goto|p4a-local^11')
    expect(calendarNote(cfg, s, '10', new Date(2026, 9, 29, 12))).toBe('Urlaub Person 10 bis 30.10.')

    cfg.extensions[0].forward.rules = [rule({ when: 'calendar', calendar: 'c1', keyword: 'Urlaub Person 10', action: 'dnd', target: '' })]
    expect(dndActive(cfg, s, '10')).toBe(true)
    expect(extensionPlan(cfg, s, '10')).toBe('goto|p4a-vmb^10')
    expect(isAvailable(s, '10', cfg)).toBe(false)
  })

  it('zeigt bei Terminen mit Uhrzeit das Ende am selben Tag', () => {
    const cfg = sampleConfig()
    cfg.extensions[0].forward.rules = [rule({ when: 'calendar', calendar: 'c1', keyword: '', action: 'dnd', target: '' })]
    const now = new Date(2026, 9, 29, 12)
    calendarStatus.find = () => ({ summary: 'Besprechung', end: new Date(2026, 9, 29, 14).getTime(), allDay: false })
    expect(calendarNote(cfg, state(), '10', now)).toBe('Besprechung bis 14:00')
    const p = new Presence()
    const view = p.view(cfg, state(), now)
    expect(view.extensions[0]).toMatchObject({ number: '10', dnd: true, note: 'Besprechung bis 14:00' })
  })

  it('prüft Regeln nach Kalender', () => {
    const cfg = validConfig()
    cfg.calendars = [{ ...(blankItem('calendars') as unknown as CentralCalendar), id: 'c1', name: 'Team' }]
    cfg.extensions[0].forward.rules = [rule({ when: 'calendar', calendar: 'c2', keyword: 'Urlaub' })]
    expect(() => validate(cfg)).toThrow(/Kalender wählen/)
    cfg.extensions[0].forward.rules = [rule({ when: 'dnd', action: 'dnd', target: '' })]
    expect(() => validate(cfg)).toThrow(/nicht selbst einschalten/)
    cfg.extensions[0].forward.rules = [rule({ when: 'calendar', calendar: 'c1', keyword: ' Urlaub ', action: 'dnd', target: '11' })]
    validate(cfg)
    expect(cfg.extensions[0].forward.rules[0]).toMatchObject({ keyword: 'Urlaub', target: '', action: 'dnd' })
  })

  it('übernimmt Kalender-Regeln aus der App', () => {
    const cfg = sampleConfig()
    cfg.provisioning.permissions = ['forward', 'forward_rules']
    const ext = cfg.extensions[0]
    applyRules(cfg, ext, { rules: [rule({ when: 'calendar', calendar: 'c1', keyword: 'Urlaub', action: 'dnd', target: '' })] })
    expect(ext.forward.rules[0]).toMatchObject({ when: 'calendar', calendar: 'c1', keyword: 'Urlaub', action: 'dnd' })
    expect(forwardInfo(cfg, state(), ext).mobile).toBeNull()
  })
})

describe('Handy klingelt mit', () => {
  it('meldet dem Wählplan Verzögerung, Nummer und Bestätigung', () => {
    const cfg = sampleConfig()
    expect(mobilePlan(cfg, '10')).toBe('')
    cfg.extensions[0].mobile = { enabled: true, number: '0171 2345678', delay: 5, confirm: true }
    expect(mobilePlan(cfg, '10')).toBe('5|01712345678|1')
    expect(extensionPlan(cfg, state(), '10')).toBe('ring|25|0|p4a-vmb^10|p4a-vmu^10|1')
  })

  it('erzeugt Wählplan mit Bestätigung am Handy', () => {
    const conf = extensionsConf(sampleConfig(), gen)
    expect(conf).toContain('[p4a-mobile]')
    expect(conf).toContain('Set(C=${C}&Local/${P4A_TARGET}@p4a-mobile)')
    expect(conf).toContain('U(p4a-confirm^s^1)')
    expect(conf).toContain('Read(KEY,beep&vm-press&digits/1,1,,1,4)')
  })

  it('prüft die Handynummer', () => {
    const cfg = validConfig()
    cfg.extensions[0].mobile = { enabled: true, number: '10', delay: 0, confirm: true }
    expect(() => validate(cfg)).toThrow(/Handynummer/)
  })
})

describe('Durchsage und Gegensprechen', () => {
  it('nur mit Recht, ohne Nicht stören und ohne sich selbst', () => {
    const cfg = sampleConfig()
    const s = state()
    expect(pagePlan(cfg, s, '10', '11', 'intercom')).toBe('')
    cfg.provisioning.permissions = ['intercom']
    expect(pagePlan(cfg, s, '10', '11', 'intercom')).toBe('11')
    expect(pagePlan(cfg, s, '10', '10', 'intercom')).toBe('')
    expect(pagePlan(cfg, s, '10', '', 'page')).toBe('11&12')
    s.dnd['12'] = true
    expect(pagePlan(cfg, s, '10', '', 'page')).toBe('11')
    expect(pagePlan(cfg, s, '12', '20', 'page')).toBe('10&11')
    s.away['11'] = ['g1']
    expect(pagePlan(cfg, s, '12', '20', 'page')).toBe('10')
    expect(pagePlan(cfg, s, '10', '99', 'page')).toBe('')
  })

  it('ruft Nebenstellen und Gruppen für Ansagen', () => {
    const cfg = sampleConfig()
    const s = state()
    expect(ringPlan(cfg, s, '11')).toBe('11')
    expect(ringPlan(cfg, s, '20')).toBe('10&11')
    s.dnd['10'] = true
    expect(ringPlan(cfg, s, '20')).toBe('11')
    expect(ringPlan(cfg, s, '99')).toBe('')
  })

  it('erzeugt Funktionscodes mit automatischem Annehmen', () => {
    const conf = extensionsConf(sampleConfig(), gen)
    expect(conf).toContain('exten => _*80X.,1,Set(PT=${EXTEN:3})')
    expect(conf).toContain('exten => *45,1,Gosub(p4a-feature,s,1(away,))')
    expect(conf).toContain('isb(p4a-autoanswer^s^1),20)')
    expect(conf).toContain('Set(PJSIP_HEADER(add,Call-Info)=<sip:phone4all>\\;answer-after=0)')
  })
})

describe('Verpasste Gruppenanrufe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-missed-'))

  it('sammelt verpasste Anrufe über Gruppen und hakt Rückrufe ab', () => {
    const cfg = sampleConfig()
    let now = 1_000_000
    const list = new MissedList(path.join(dir, 'a.json'), () => now)
    list.add(cfg, 'c1', ['g1'], '0309999999', 'Kunde')
    list.add(cfg, 'c1', ['g1'], '0309999999', 'Kunde')
    expect(list.visible(cfg, '10')).toHaveLength(1)
    expect(list.visible(cfg, '12')).toHaveLength(0)
    expect(list.open(cfg, '11')).toBe(1)
    expect(list.act(cfg, 'c1', 'g1', 'claim', '11', '11')).toBe(true)
    expect(list.entries[0].claimed_by).toBe('11')
    expect(list.act(cfg, 'c1', 'g1', 'claim', '12', '12')).toBe(false)
    now += 1000
    list.resolve(cfg, '+49309999999', '11', 'callback')
    expect(list.entries[0]).toMatchObject({ done_by: '11', done_how: 'callback' })
    expect(list.open(cfg, '10')).toBe(0)
    expect(new MissedList(path.join(dir, 'a.json')).entries).toHaveLength(1)
  })

  it('nur für Gruppen mit gemeinsamer Liste', () => {
    const cfg = sampleConfig()
    cfg.groups[0].missed_list = false
    const list = new MissedList(path.join(dir, 'b.json'))
    list.add(cfg, 'c1', ['g1'], '0309999999', '')
    expect(list.entries).toHaveLength(0)
  })

  it('erkennt Gruppen und Rückrufnummer aus den Ereignissen von Asterisk', () => {
    const t = new CallTracker(() => 0)
    const missed: GroupMissedCall[] = []
    const events: { event: string; data: Record<string, unknown> }[] = []
    t.on('group-missed', (m: GroupMissedCall) => missed.push(m))
    t.on('event', (e) => events.push(e))
    t.onAmi({ Event: 'Newchannel', Channel: 'PJSIP/trunk-t1-00000001', Uniqueid: 'L1', Linkedid: 'L1', CallerIDNum: '0309999999', CallerIDName: '' })
    t.onAmi({ Event: 'UserEvent', UserEvent: 'P4AGroup', Group: 'g1', Linkedid: 'L1' })
    t.onAmi({ Event: 'Hangup', Uniqueid: 'L1', Linkedid: 'L1', Channel: 'PJSIP/trunk-t1-00000001' })
    expect(missed).toEqual([{ call: 'L1', groups: ['g1'], from: '0309999999', from_name: '' }])

    t.onAmi({ Event: 'Newchannel', Channel: 'PJSIP/11-00000002', Uniqueid: 'L2', Linkedid: 'L2', CallerIDNum: '11', CallerIDName: 'Person 11' })
    t.onAmi({ Event: 'DialBegin', Linkedid: 'L2', DestChannel: 'PJSIP/trunk-t1-00000003', DialString: '+49309999999@trunk-t1' })
    t.onAmi({ Event: 'DialEnd', Linkedid: 'L2', DestChannel: 'PJSIP/trunk-t1-00000003', DialStatus: 'ANSWER' })
    expect(events.at(-1)).toMatchObject({ event: 'call.answered', data: { direction: 'out', from: '11', to: '+49309999999' } })
  })
})
