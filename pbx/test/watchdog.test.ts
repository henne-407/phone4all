import { describe, expect, it } from 'vitest'
import { type WatchTarget, Watchdog } from '../server/watchdog'

function fake(over: Partial<WatchTarget> = {}) {
  const calls: string[] = []
  let regs: { trunk: string; status: string }[] = [{ trunk: 't1', status: 'Registered' }]
  const target: WatchTarget = {
    state: () => 'running',
    processRunning: () => true,
    amiConnected: () => true,
    ping: async () => true,
    reconnectAmi: async () => true,
    restart: async (reason) => void calls.push(`restart ${reason}`),
    trunks: () => [{ id: 't1', name: 'Telekom' }],
    registrations: async () => regs,
    register: async (id) => void calls.push(`register ${id}`),
    reloadPjsip: async () => void calls.push('reload'),
    freeBytes: () => 10 * 1024 ** 3,
    ...over,
  }
  let now = 1_000_000
  const settings = { auto_repair: true, trunk_grace: 3 }
  const dog = new Watchdog(target, () => settings, () => now)
  return {
    dog,
    calls,
    settings,
    setRegs: (r: typeof regs) => (regs = r),
    advance: (ms: number) => (now += ms),
  }
}

describe('Watchdog der Anlage', () => {
  it('meldet einen gesunden Zustand', async () => {
    const { dog, calls } = fake()
    await dog.tick()
    expect(dog.overall()).toBe('ok')
    expect(dog.status().checks.map((c) => c.level)).toEqual(['ok', 'ok', 'ok'])
    expect(calls).toEqual([])
  })

  it('meldet ein abgemeldetes SIP-Konto erst nach der Wartezeit neu an, mit wachsendem Abstand', async () => {
    const { dog, calls, setRegs, advance } = fake()
    setRegs([{ trunk: 't1', status: 'Rejected' }])
    await dog.tick()
    expect(dog.status().checks[1].level).toBe('warning')
    expect(calls).toEqual([])
    advance(3 * 60000)
    await dog.tick()
    expect(calls).toEqual(['register t1'])
    expect(dog.status().checks[1].level).toBe('error')
    advance(60000)
    await dog.tick()
    expect(calls).toHaveLength(1) // nächster Versuch erst nach 6 Minuten
    advance(5 * 60000)
    await dog.tick()
    expect(calls).toEqual(['register t1', 'register t1'])
    setRegs([{ trunk: 't1', status: 'Registered' }])
    await dog.tick()
    expect(dog.status().checks[1].level).toBe('ok')
    expect(dog.events.at(-1)).toMatchObject({ level: 'ok', text: 'SIP-Konto „Telekom“ wieder angemeldet' })
    expect(dog.repairs).toBe(2)
  })

  it('lädt PJSIP neu, wenn die Registrierung ganz fehlt', async () => {
    const { dog, calls, setRegs, advance } = fake()
    setRegs([])
    await dog.tick()
    advance(3 * 60000)
    await dog.tick()
    expect(calls).toEqual(['reload'])
  })

  it('startet ein hängendes Asterisk nach drei Fehlversuchen neu, aber nicht im Kreis', async () => {
    const { dog, calls, advance } = fake({ ping: async () => false })
    await dog.tick()
    await dog.tick()
    expect(calls).toEqual([])
    expect(dog.status().checks[0].level).toBe('warning')
    await dog.tick()
    expect(calls).toEqual(['restart keine Antwort auf 3 Prüfungen'])
    for (let i = 0; i < 3; i++) await dog.tick()
    expect(calls).toHaveLength(1)
    advance(5 * 60000)
    for (let i = 0; i < 3; i++) await dog.tick()
    expect(calls).toHaveLength(2)
  })

  it('verbindet das AMI neu, wenn Asterisk noch läuft', async () => {
    let connected = false
    const { dog, calls } = fake({
      amiConnected: () => connected,
      reconnectAmi: async () => (connected = true),
    })
    await dog.tick()
    expect(connected).toBe(true)
    expect(dog.repairs).toBe(1)
    expect(dog.status().checks[0].level).toBe('ok')
    expect(calls).toEqual([])
  })

  it('meldet nur, wenn die Selbstheilung aus ist', async () => {
    const { dog, calls, settings, setRegs, advance } = fake({ ping: async () => false })
    settings.auto_repair = false
    setRegs([{ trunk: 't1', status: 'Rejected' }])
    for (let i = 0; i < 4; i++) {
      await dog.tick()
      advance(4 * 60000)
    }
    expect(calls).toEqual([])
    expect(dog.overall()).toBe('error')
  })

  it('warnt bei wenig Speicherplatz', async () => {
    const { dog } = fake({ freeBytes: () => 50 * 1024 * 1024 })
    await dog.tick()
    expect(dog.status().checks[2]).toMatchObject({ level: 'error' })
  })
})
