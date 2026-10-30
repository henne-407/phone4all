import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Ami } from '../server/ami'
import { Debug, captureFilter, verboseCommands } from '../server/debug'
import { forbidden } from '../server/users'

describe('Fehlersuche', () => {
  it('schneidet SIP, TURN und den RTP-Bereich mit', () => {
    expect(captureFilter({ sipPorts: [5060, 5061, 5060, 0], rtpStart: 10000, rtpEnd: 10999 })).toBe('port 5060 or port 5061 or port 3478 or portrange 10000-10999')
    expect(captureFilter({ sipPorts: [5060], rtpStart: 0, rtpEnd: 0 })).toBe('port 5060 or port 3478')
  })

  it('schaltet SIP-Mitschnitt und debug.log gemeinsam', () => {
    expect(verboseCommands(true)).toContain('pjsip set logger on')
    expect(verboseCommands(true)[0]).toMatch(/^logger add channel debug\.log /)
    expect(verboseCommands(false)).toContain('pjsip set logger off')
    expect(verboseCommands(false).at(-1)).toBe('logger remove channel debug.log')
  })

  it('endet von selbst und ist mit PBX_DEBUG=1 dauerhaft an', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-debug-'))
    const d = new Debug(new Ami(), dir, false, '/nicht/vorhanden')
    expect(d.status().verbose).toBe(false)
    await d.enable(5)
    const s = d.status()
    expect(s.verbose).toBe(true)
    expect(s.until - Date.now()).toBeGreaterThan(4 * 60_000)
    await d.disable()
    expect(d.status().verbose).toBe(false)
    expect(d.status().capture.available).toBe(false)
    expect(() => d.startCapture(10, { sipPorts: [5060], rtpStart: 0, rtpEnd: 0 })).toThrow(/tcpdump/)
    expect(new Debug(new Ami(), dir, true).status()).toMatchObject({ verbose: true, forced: true, until: 0 })
  })

  it('packt Logs und Zusatzdateien in ein Diagnose-Paket', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-debug-'))
    fs.writeFileSync(path.join(dir, 'messages.log'), 'WARNING Test\n')
    const file = await new Debug(new Ami(), dir, false).bundle({ 'status.json': '{}' })
    const list = (await import('node:child_process')).execFileSync('tar', ['-tzf', file]).toString()
    expect(list).toContain('./messages.log')
    expect(list).toContain('./status.json')
  })

  it('ist nur für die Verwaltung', () => {
    expect(forbidden('viewer', 'GET', '/api/debug')).not.toBe('')
    expect(forbidden('operator', 'GET', '/api/debug/bundle')).not.toBe('')
    expect(forbidden('admin', 'PUT', '/api/debug')).toBe('')
  })
})
