import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AppProfile, CentralCalendar } from '../server/model'
import { blankItem } from '../server/model'
import { ext, sampleConfig } from './helpers'

process.env.PBX_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-cal-'))

const { CalendarStore, cleanEvent } = await import('../server/calendars')
const { profile } = await import('../server/provisioning')
const { validate, ValidationError } = await import('../server/store')

const cal = (id: string, extra: Partial<CentralCalendar> = {}): CentralCalendar => ({ ...(blankItem('calendars') as unknown as CentralCalendar), id, name: id, ...extra })
const appProfile = (extra: Partial<AppProfile> = {}): AppProfile => ({ ...(blankItem('appprofiles') as unknown as AppProfile), id: 'p1', name: 'Empfang', ...extra })

describe('Zentrale Kalender', () => {
  it('prüft Termine', () => {
    expect(() => cleanEvent({ summary: '', start: '2026-01-01', end: '2026-01-02', allDay: true })).toThrow(ValidationError)
    expect(() => cleanEvent({ summary: 'x', start: '2026-01-02', end: '2026-01-02', allDay: true })).toThrow(/Ende/)
    expect(() => cleanEvent({ summary: 'x', start: '2026-01-02T10:00', end: 'morgen' })).toThrow(/ungültig/)
    const e = cleanEvent({ summary: ' Betriebsferien ', start: '2026-08-03', end: '2026-08-15', allDay: true })
    expect(e.summary).toBe('Betriebsferien')
    expect(e.uid).toMatch(/@phone4all$/)
  })

  it('speichert, filtert nach Zeitraum und löscht', () => {
    const cfg = sampleConfig()
    cfg.calendars = [cal('betrieb'), cal('feiertage', { kind: 'holidays' })]
    cfg.system.state = 'BE'
    const store = new CalendarStore(() => cfg)
    const before = store.revision
    const a = store.upsert('betrieb', { summary: 'Team', start: '2026-03-02T09:00:00Z', end: '2026-03-02T10:00:00Z' })
    store.upsert('betrieb', { summary: 'Später', start: '2026-05-02T09:00:00Z', end: '2026-05-02T10:00:00Z' })
    expect(store.revision).toBeGreaterThan(before)
    const march = store.events('betrieb', Date.parse('2026-03-01'), Date.parse('2026-04-01'))
    expect(march.map((e) => e.summary)).toEqual(['Team'])
    store.upsert('betrieb', { summary: 'Team neu', start: a.start, end: a.end }, a.uid)
    expect(store.events('betrieb', 0, Date.parse('2030-01-01')).map((e) => e.summary)).toEqual(['Team neu', 'Später'])
    store.remove('betrieb', a.uid)
    expect(store.events('betrieb', 0, Date.parse('2030-01-01'))).toHaveLength(1)
    expect(() => store.upsert('feiertage', { summary: 'x', start: '2026-01-01', end: '2026-01-02', allDay: true })).toThrow(ValidationError)
  })

  it('erzeugt Feiertage des Bundeslandes', () => {
    const cfg = sampleConfig()
    cfg.calendars = [cal('feiertage', { kind: 'holidays' })]
    cfg.system.state = 'BE'
    const store = new CalendarStore(() => cfg)
    const dec = store.events('feiertage', Date.parse('2026-12-01'), Date.parse('2027-01-02'))
    expect(dec.map((e) => e.start)).toEqual(['2026-12-25', '2026-12-26', '2027-01-01'])
    expect(dec[0].end).toBe('2026-12-26')
    expect(dec[0].allDay).toBe(true)
  })
})

describe('App-Profile', () => {
  it('liefert Vorgaben und Kalender im Einrichtungsprofil', () => {
    const cfg = sampleConfig()
    cfg.calendars = [cal('betrieb', { writable: false }), cal('feiertage', { kind: 'holidays' }), cal('raum')]
    cfg.appprofiles = [appProfile({ pages: ['home', 'dial'], start_tab: 'dial', calendars: ['betrieb', 'feiertage'] })]
    const anna = cfg.extensions[0]
    const without = profile(cfg, anna, 'https://pbx.example')
    expect(without.app).toBeNull()
    expect(without.calendars.map((c) => c.id)).toEqual(['betrieb', 'feiertage', 'raum'])
    anna.app_profile = 'p1'
    const p = profile(cfg, anna, 'https://pbx.example')
    expect(p.app).toMatchObject({ pages: ['home', 'dial'], start_tab: 'dial', lock_account: true })
    expect(p.calendars).toEqual([
      { id: 'betrieb', name: 'betrieb', color: '#1a73e8', writable: false },
      { id: 'feiertage', name: 'feiertage', color: '#1a73e8', writable: false },
    ])
    expect(p.revision).not.toBe(without.revision)
    expect(profile(cfg, anna, 'https://pbx.example').revision).toBe(p.revision)
  })

  it('prüft Profile beim Speichern', () => {
    const cfg = sampleConfig()
    for (const e of cfg.extensions) e.secret = 'langesgeheimnis'
    cfg.appprofiles = [appProfile({ pages: ['dial'], start_tab: 'home' })]
    expect(() => validate(cfg)).toThrow(/Start/i)
    cfg.appprofiles = [appProfile({ pages: [] })]
    expect(() => validate(cfg)).toThrow(ValidationError)
    cfg.appprofiles = [appProfile()]
    cfg.extensions.push(ext('e13', '13', { app_profile: 'p1', secret: 'langesgeheimnis' }))
    expect(() => validate(cfg)).not.toThrow()
  })
})
