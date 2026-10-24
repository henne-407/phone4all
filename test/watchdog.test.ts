import { describe, expect, it } from 'vitest'
import type { RegKind } from '../src/shared/types'
import type { EngineState } from '../src/main/baresip'
import { type PhoneTarget, Watchdog } from '../src/main/watchdog'

function fake(over: Partial<PhoneTarget> = {}) {
  const calls: string[] = []
  const t = {
    engine: 'running' as EngineState,
    reg: 'ok' as RegKind,
    busy: false,
    alive: true,
    net: 'wlan0=192.168.1.20',
  }
  const target: PhoneTarget = {
    wanted: () => true,
    engineState: () => t.engine,
    regKind: () => t.reg,
    busy: () => t.busy,
    ping: async () => t.alive,
    reregister: () => void calls.push('reregister'),
    restart: () => void calls.push('restart'),
    networkKey: () => t.net,
    ...over,
  }
  let now = 1_000_000
  let enabled = true
  const dog = new Watchdog(target, () => enabled, () => now)
  dog.start(1e9)
  dog.stop()
  return { dog, calls, t, advance: (ms: number) => (now += ms), disable: () => (enabled = false) }
}

describe('Watchdog der App', () => {
  it('lässt eine gesunde Verbindung in Ruhe', async () => {
    const { dog, calls } = fake()
    await dog.tick()
    expect(calls).toEqual([])
    expect(dog.summary().level).toBe('ok')
  })

  it('startet eine ausgefallene SIP-Engine mit wachsendem Abstand neu', async () => {
    const { dog, calls, t, advance } = fake()
    t.engine = 'error'
    await dog.tick()
    expect(calls).toEqual(['restart'])
    advance(5000)
    await dog.tick()
    expect(calls).toHaveLength(1)
    advance(5000)
    await dog.tick()
    expect(calls).toHaveLength(2) // nach 10 s
    advance(10000)
    await dog.tick()
    expect(calls).toHaveLength(2) // jetzt erst nach 20 s
    advance(10000)
    await dog.tick()
    expect(calls).toHaveLength(3)
    expect(dog.summary().level).toBe('error')
  })

  it('meldet erst neu an und startet nach mehreren Fehlversuchen baresip neu', async () => {
    const { dog, calls, t, advance } = fake()
    t.reg = 'error'
    await dog.tick()
    expect(calls).toEqual([])
    advance(60000)
    await dog.tick()
    expect(calls).toEqual(['reregister'])
    advance(60000)
    await dog.tick()
    expect(calls).toEqual(['reregister', 'reregister'])
    advance(120000)
    await dog.tick()
    expect(calls).toEqual(['reregister', 'reregister', 'restart'])
    t.reg = 'ok'
    await dog.tick()
    expect(dog.events.at(-1)?.text).toBe('Anmeldung an der Telefonanlage: wieder in Ordnung')
    expect(dog.repairs).toBe(3)
  })

  it('startet eine hängende Engine neu, aber nicht während eines Gesprächs', async () => {
    const { dog, calls, t } = fake()
    t.alive = false
    t.busy = true
    await dog.tick()
    await dog.tick()
    expect(calls).toEqual([])
    t.busy = false
    await dog.tick()
    expect(calls).toEqual(['restart'])
  })

  it('verbindet nach Netzwechsel und Ruhezustand neu, sobald kein Gespräch läuft', async () => {
    const { dog, calls, t } = fake()
    t.net = 'wlan0=10.0.0.5'
    t.busy = true
    await dog.tick()
    expect(calls).toEqual([])
    t.busy = false
    await dog.tick()
    expect(calls).toEqual(['restart'])
    expect(dog.events.at(-1)?.text).toBe('Netzwerk hat sich geändert – verbinde neu')
    dog.onResume()
    await new Promise((r) => setTimeout(r, 0))
    expect(calls).toEqual(['restart', 'restart'])
  })

  it('tut nichts ohne Konto oder wenn ausgeschaltet', async () => {
    const a = fake({ wanted: () => false })
    a.t.engine = 'error'
    await a.dog.tick()
    expect(a.calls).toEqual([])
    const b = fake()
    b.disable()
    b.t.engine = 'error'
    await b.dog.tick()
    expect(b.calls).toEqual([])
    expect(b.dog.summary().level).toBe('off')
  })
})
