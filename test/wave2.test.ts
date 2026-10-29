import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false, getAppPath: () => '/tmp' }, safeStorage: {} }))

import { parseForward, parsePermissions, parsePresence } from '../src/main/provisioning'

describe('Welle 2: Daten der Anlage', () => {
  it('liest Gruppen, verpasste Gruppenanrufe und den Kalender-Status', () => {
    const p = parsePresence({
      revision: '1',
      extensions: [{ number: '10', name: 'Anna', state: 'idle', dnd: false, forward: '', note: 'Urlaub bis Fr' }],
      parked: [],
      voicemail: null,
      groups: [{ id: 'g1', number: '600', name: 'Vertrieb', active: false }, { number: 'kaputt' }],
      missed: { open: 3, revision: '7' },
    })
    expect(p?.extensions[0].note).toBe('Urlaub bis Fr')
    expect(p?.groups).toEqual([{ id: 'g1', number: '600', name: 'Vertrieb', active: false }])
    expect(p?.missed).toEqual({ open: 3, revision: '7' })
  })

  it('kommt mit älteren Anlagen ohne Gruppen zurecht', () => {
    const p = parsePresence({ revision: '1', extensions: [], parked: [] })
    expect(p?.groups).toBeNull()
    expect(p?.missed).toBeNull()
  })

  it('kennt die neuen Rechte', () => {
    expect(parsePermissions(['intercom', 'fax_send', 'unbekannt'])).toEqual(['intercom', 'fax_send'])
  })

  it('liest Handy und Kalender der Umleitung', () => {
    const f = parseForward({
      cfu: '',
      busy: '',
      noanswer: '',
      rules: [],
      active: '',
      targets: [],
      permissions: ['forward'],
      timeconditions: [],
      calendars: [{ id: 'k', name: 'Urlaub' }],
      mobile: { enabled: true, number: '0171' },
    })
    expect(f?.calendars).toEqual([{ id: 'k', name: 'Urlaub' }])
    expect(f?.mobile).toEqual({ enabled: true, number: '0171' })
  })
})
