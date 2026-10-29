import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CentralCalendar, ContactSource } from '../server/model'
import { blankItem } from '../server/model'
import { sampleConfig } from './helpers'

process.env.PBX_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-src-'))

const { SourceSync, readEvents, toCentralEvent } = await import('../server/sources/sync')
const { CalendarStore } = await import('../server/calendars')
const { directory, external } = await import('../server/directory')
const { lookupName } = await import('../server/routing')
const { validate } = await import('../server/store')

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:team@test
DTSTART;TZID=Europe/Berlin:20261026T090000
DTEND;TZID=Europe/Berlin:20261026T093000
RRULE:FREQ=WEEKLY;COUNT=3
SUMMARY:Teamrunde
END:VEVENT
BEGIN:VEVENT
UID:ferien@test
DTSTART;VALUE=DATE:20261224
DTEND;VALUE=DATE:20261227
SUMMARY:Betriebsferien
END:VEVENT
END:VCALENDAR`

const VCF = `BEGIN:VCARD
VERSION:3.0
FN:Erika Muster
ORG:Muster GmbH
TEL;TYPE=WORK:030 5550100
TEL;TYPE=CELL:0171 5550100
END:VCARD`

let server: http.Server
let base = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/geheim.vcf' && req.headers.authorization !== 'Basic ' + Buffer.from('anna:pw').toString('base64')) {
      res.writeHead(401).end()
      return
    }
    if (req.url === '/dav/kontakte/' && req.method === 'PROPFIND') {
      res.writeHead(207, { 'Content-Type': 'application/xml' }).end(
        `<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:response><d:href>/dav/kontakte/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
      )
    } else if (req.url === '/dav/kontakte/' && req.method === 'REPORT') {
      res.writeHead(207, { 'Content-Type': 'application/xml' }).end(
        `<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:response><d:href>/dav/kontakte/1.vcf</d:href><d:propstat><d:prop><card:address-data>${VCF}</card:address-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
      )
    } else if (req.url?.endsWith('.ics')) res.end(ICS)
    else if (req.url?.endsWith('.vcf')) res.end(VCF)
    else res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

const source = (extra: Partial<ContactSource>): ContactSource => ({ ...(blankItem('contactsources') as unknown as ContactSource), id: 'crm', name: 'CRM', ...extra })

describe('Externe Kalender', () => {
  it('liest ein Abo und löst Serien auf', async () => {
    const start = Date.parse('2026-10-01T00:00:00Z')
    const events = (await readEvents({ type: 'ics', url: `${base}/k.ics`, user: '', password: '', refresh_minutes: 60 }, start, start + 90 * 86400000)).map(toCentralEvent)
    const team = events.filter((e) => e.summary === 'Teamrunde')
    expect(team).toHaveLength(3)
    expect(team[0].start).toBe('2026-10-26T08:00:00.000Z')
    expect(new Set(team.map((e) => e.uid)).size).toBe(3)
    expect(events.find((e) => e.summary === 'Betriebsferien')).toMatchObject({ allDay: true, start: '2026-12-24', end: '2026-12-27' })
  })

  it('legt die Termine im abonnierten Kalender ab', async () => {
    const cfg = sampleConfig()
    for (const e of cfg.extensions) e.secret = 'geheim1234'
    const cal: CentralCalendar = { ...(blankItem('calendars') as unknown as CentralCalendar), id: 'abo', name: 'Abo', kind: 'subscription' }
    cal.source = { type: 'ics', url: `webcal://127.0.0.1:1/x.ics`, user: '', password: '', refresh_minutes: 1 }
    cfg.calendars = [cal]
    validate(cfg)
    expect(cal.source.url).toBe('https://127.0.0.1:1/x.ics')
    expect(cal.source.refresh_minutes).toBe(5)
    expect(cal.writable).toBe(false)

    cal.source.url = `${base}/k.ics`
    const store = new CalendarStore(() => cfg)
    const sync = new SourceSync(() => cfg, (id, ev) => store.replace(id, ev))
    await sync.syncCalendar(cal)
    expect(sync.status.abo).toMatchObject({ error: '', running: false })
    expect(store.events('abo', Date.parse('2026-12-01'), Date.parse('2027-01-01')).map((e) => e.summary)).toEqual(['Betriebsferien'])
    expect(() => store.upsert('abo', { summary: 'x', start: '2026-12-01', end: '2026-12-02', allDay: true })).toThrow()
  })
})

describe('Externe Kontakte', () => {
  it('liest vCard aus dem Netz und nimmt sie ins Telefonbuch', async () => {
    const cfg = sampleConfig()
    cfg.contactsources = [source({ type: 'url', url: `${base}/geheim.vcf`, user: 'anna', password: 'pw' })]
    const sync = new SourceSync(() => cfg, () => undefined)
    external.entries = () => sync.entries()
    external.revision = () => sync.revision
    await sync.syncContacts(cfg.contactsources[0])
    expect(sync.status.crm).toMatchObject({ error: '', count: 1 })
    expect(directory(cfg).at(-1)).toMatchObject({ name: 'Erika Muster', company: 'Muster GmbH', phone: '030 5550100', mobile: '0171 5550100' })
    expect(lookupName(cfg, '+491715550100')).toBe('Erika Muster (Muster GmbH)')

    cfg.contactsources[0].enabled = false
    expect(sync.entries()).toEqual([])
    cfg.contactsources[0].enabled = true

    cfg.contactsources[0].password = 'falsch'
    await sync.syncContacts(cfg.contactsources[0])
    expect(sync.status.crm.error).toMatch(/Anmeldung/)
    // Bei Fehlern bleiben die zuletzt gelesenen Kontakte erhalten
    expect(sync.entries()).toHaveLength(1)

    cfg.contactsources = []
    sync.cleanup()
    expect(sync.entries()).toEqual([])
    external.entries = () => []
  })

  it('liest ein CardDAV-Adressbuch', async () => {
    const cfg = sampleConfig()
    cfg.contactsources = [source({ type: 'carddav', url: `${base}/dav/kontakte/` })]
    const sync = new SourceSync(() => cfg, () => undefined)
    await sync.syncContacts(cfg.contactsources[0])
    expect(sync.status.crm).toMatchObject({ error: '', count: 1 })
    expect(sync.entries()[0].name).toBe('Erika Muster')
  })

  it('prüft die Angaben', () => {
    const cfg = sampleConfig()
    for (const e of cfg.extensions) e.secret = 'geheim1234'
    cfg.contactsources = [source({ type: 'carddav', url: 'cloud.firma.de' })]
    expect(() => validate(cfg)).toThrow(/http/)
    cfg.contactsources = [source({ type: 'mssql', host: 'sql01', database: 'crm', mode: 'query', query: 'DELETE FROM x' })]
    expect(() => validate(cfg)).toThrow(/SELECT/)
  })
})
