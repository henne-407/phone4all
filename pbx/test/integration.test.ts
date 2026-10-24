import { describe, expect, it } from 'vitest'
import type { PbxStatus } from '../server/asterisk'
import type { CallRecord } from '../server/cdr'
import { integrationReport, validToken } from '../server/integration'
import type { UpdateInfo } from '../server/updates'
import { sampleConfig } from './helpers'

const update: UpdateInfo = { current: '0.3.0', latest: null, available: false, canApply: false, reason: '', checked: 0, error: '' }

function status(extra: Partial<PbxStatus> = {}): PbxStatus {
  return { asterisk: 'running', message: '', uptime: '120', endpoints: [], registrations: [], calls: [], ...extra }
}

function call(id: string, extra: Partial<CallRecord> = {}): CallRecord {
  return {
    id,
    start: '2026-10-24 09:15:00',
    direction: 'in',
    from: '0301111',
    fromName: 'Kunde',
    to: '0301234567',
    answeredBy: '',
    status: 'missed',
    duration: 0,
    recordings: [],
    ...extra,
  }
}

describe('Home-Assistant-Schnittstelle', () => {
  it('meldet abgemeldete SIP-Konten als Problem', () => {
    const cfg = sampleConfig()
    const ok = integrationReport(cfg, { dnd: {}, cfu: {} }, status({ registrations: [{ trunk: 't1', status: 'Registered' }] }), [], update, '0.3.0', 0)
    expect(ok.problems).toEqual([])
    expect(ok.trunks[0]).toMatchObject({ id: 't1', registered: true, problem: false })

    const bad = integrationReport(cfg, { dnd: {}, cfu: {} }, status({ registrations: [{ trunk: 't1', status: 'Rejected' }] }), [], update, '0.3.0', 0)
    expect(bad.trunks[0].problem).toBe(true)
    expect(bad.problems).toEqual([{ key: 'trunk:t1', message: 'SIP-Konto Telekom ist nicht angemeldet (Rejected)' }])
  })

  it('meldet nicht laufendes Asterisk statt jedes Kontos', () => {
    const r = integrationReport(sampleConfig(), { dnd: {}, cfu: {} }, status({ asterisk: 'error', message: 'abgestürzt' }), [], update, '0.3.0', 0)
    expect(r.problems).toEqual([{ key: 'asterisk', message: 'abgestürzt' }])
  })

  it('ignoriert Konten ohne Anmeldung', () => {
    const cfg = sampleConfig()
    cfg.trunks[0].ip_auth = true
    const r = integrationReport(cfg, { dnd: {}, cfu: {} }, status(), [], update, '0.3.0', 0)
    expect(r.problems).toEqual([])
    expect(r.trunks[0].register).toBe(false)
  })

  it('zählt verpasste und auf Voicemail gelaufene Anrufe, aber keine laufenden', () => {
    const calls = [
      call('a'),
      call('b', { status: 'answered', answeredBy: 'Voicemail' }),
      call('c', { status: 'answered', answeredBy: '10' }),
      call('d', { direction: 'out', status: 'failed' }),
      call('e', { start: '2026-10-23 18:00:00' }),
      call('f'),
    ]
    const r = integrationReport(sampleConfig(), { dnd: {}, cfu: {} }, status({ calls: [{ id: 'f', from: '', fromName: '', to: '', toName: '', channels: [] }] }), calls, update, '0.3.0', 0, new Date(2026, 9, 24, 12))
    expect(r.missed.calls.map((c) => c.id)).toEqual(['a', 'b', 'e'])
    expect(r.missed.calls[1].voicemail).toBe(true)
    expect(r.missed.today).toBe(2)
    expect(r.active_calls).toBe(1)
    expect(new Date(r.missed.calls[0].time).getHours()).toBe(9)
  })

  it('prüft den Zugriffsschlüssel', () => {
    const cfg = sampleConfig()
    cfg.integration = { enabled: true, token: 'abc123' }
    expect(validToken(cfg, 'Bearer abc123')).toBe(true)
    expect(validToken(cfg, 'Bearer abc124')).toBe(false)
    expect(validToken(cfg, 'abc123')).toBe(false)
    expect(validToken(cfg, undefined)).toBe(false)
    cfg.integration.enabled = false
    expect(validToken(cfg, 'Bearer abc123')).toBe(false)
  })
})
