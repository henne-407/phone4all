import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false, getAppPath: () => '/tmp' }, safeStorage: {} }))

import { parsePresence } from '../src/main/provisioning'

describe('Welle 3: Daten der Anlage', () => {
  it('liest Chef/Sekretariat, offene Rückrufe und SMS', () => {
    const p = parsePresence({
      revision: '1',
      extensions: [],
      parked: [],
      boss: [{ id: 'b1', name: 'GF', role: 'boss', partner: '13', active: true }, { name: 'kaputt' }],
      callbacks: [{ id: 'c1', to: '11', name: 'Bert', expires: 99 }],
      callback_enabled: true,
      sms: true,
    })
    expect(p?.boss).toEqual([{ id: 'b1', name: 'GF', role: 'boss', partner: '13', active: true }])
    expect(p?.callbacks).toEqual([{ id: 'c1', to: '11', name: 'Bert', expires: 99 }])
    expect(p?.sms).toBe(true)
  })

  it('Rückruf ausgeschaltet oder ältere Anlage: nichts anbieten', () => {
    const off = parsePresence({ revision: '1', extensions: [], parked: [], callbacks: [], callback_enabled: false })
    expect(off?.callbacks).toBeNull()
    const old = parsePresence({ revision: '1', extensions: [], parked: [] })
    expect(old?.boss).toEqual([])
    expect(old?.callbacks).toBeNull()
    expect(old?.sms).toBe(false)
  })
})
