import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Profile, checkProfile, fetchProfile, normalizeBase, parseSetupInput, setupWithPin, visiblePages } from '../src/provisioning'

const profile = (extra: Partial<Profile> = {}): Profile => ({
  format: 'phone4all-provisioning',
  version: 1,
  pbx: { name: 'Büro', version: '0.3.0' },
  extension: '10',
  account: { display_name: 'Anna', user: '10', domain: 'telefon.example.de' },
  password: 'geheim',
  url: 'https://telefon.example.de/provision/abc',
  phonebook: [],
  features: {},
  app: null,
  calendars: [],
  remote: { websocket: 'wss://telefon.example.de/ws', user: '10-app', domain: 'telefon.example.de', ice_servers: [] },
  revision: 'r1',
  ...extra,
})

afterEach(() => vi.unstubAllGlobals())

describe('Einrichtungslinks', () => {
  it('erkennt QR-Code, Einladungslink und App-Link', () => {
    expect(parseSetupInput('https://telefon.example.de/setup/AbC123')).toEqual({ kind: 'profile', url: 'https://telefon.example.de/provision/AbC123' })
    expect(parseSetupInput(' http://192.168.1.5:8080/provision/xyz9 ')).toEqual({ kind: 'profile', url: 'http://192.168.1.5:8080/provision/xyz9' })
    const app = `sip-telefon://provision?url=${encodeURIComponent('https://telefon.example.de/provision/T0k3n')}`
    expect(parseSetupInput(app)).toEqual({ kind: 'profile', url: 'https://telefon.example.de/provision/T0k3n' })
  })

  it('nimmt reine Serveradressen für die PIN-Einrichtung', () => {
    expect(parseSetupInput('telefon.example.de')).toEqual({ kind: 'server', base: 'https://telefon.example.de' })
    expect(parseSetupInput('http://10.0.0.2:8080/')).toEqual({ kind: 'server', base: 'http://10.0.0.2:8080' })
    expect(normalizeBase('telefon.example.de/')).toBe('https://telefon.example.de')
  })

  it('lehnt anderes ab', () => {
    expect(parseSetupInput('')).toBeNull()
    expect(parseSetupInput('hallo welt')).toBeNull()
    expect(parseSetupInput('https://example.de/irgendwas')).toBeNull()
  })
})

describe('Profil', () => {
  it('verlangt den Zugang für unterwegs', () => {
    expect(() => checkProfile(profile({ remote: null }))).toThrow(/Fernzugriff/)
    expect(() => checkProfile({ format: 'x' } as unknown as Profile)).toThrow(/Phone4all/)
    expect(checkProfile(profile()).remote?.user).toBe('10-app')
  })

  it('holt das Profil und meldet Fehler der Anlage verständlich', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(profile()), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    expect((await fetchProfile('https://telefon.example.de/provision/abc')).extension).toBe('10')

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Nebenstelle oder Einrichtungs-PIN stimmen nicht.' }), { status: 403 })))
    await expect(setupWithPin('telefon.example.de', '10', '000000')).rejects.toThrow('Nebenstelle oder Einrichtungs-PIN stimmen nicht.')

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Network request failed'))))
    await expect(fetchProfile('https://x.example/provision/a')).rejects.toThrow(/nicht erreichbar/)
  })

  it('schickt Nebenstelle und PIN an /provision', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(profile()), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await setupWithPin('https://telefon.example.de/', ' 10 ', '123456')
    expect(fetch.mock.calls[0][0]).toBe('https://telefon.example.de/provision')
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ extension: '10', pin: '123456' })
  })

  it('zeigt die Seiten nach App-Profil', () => {
    expect(visiblePages(profile())).toEqual(['home', 'dial', 'contacts', 'calendar', 'history'])
    const app = { pages: ['dial', 'contacts'] as const, start_tab: 'dial' as const, home_cards: [], lock_layout: false, lock_account: true }
    expect(visiblePages(profile({ app: { ...app, pages: [...app.pages] } }))).toEqual(['dial', 'contacts'])
  })
})
