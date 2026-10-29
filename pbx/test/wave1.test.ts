import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { emergencyCall, emergencyText, isEmergency } from '../server/emergency'
import { CallTracker, type PbxEvent, Webhooks, signature } from '../server/events'
import { parkingConf } from '../server/generate'
import { blankItem, type BlockedNumber, type OffsiteSettings, type Webhook } from '../server/model'
import { fileName, pack, parsePropfind, parseS3List, signS3, unpack, upload } from '../server/offsite'
import { Presence, lineState } from '../server/presence'
import { EMPTY_STATE, routeInbound } from '../server/routing'
import { parkingNumbers, validate } from '../server/store'
import { VoicemailBox, parseCallerId } from '../server/voicemail'
import { sampleConfig } from './helpers'

/** Beispielanlage, die validate() übersteht */
function validConfig(): ReturnType<typeof sampleConfig> {
  const cfg = sampleConfig()
  for (const e of cfg.extensions) e.secret = 'geheim12345'
  return cfg
}

const block = (number: string): BlockedNumber => ({ ...(blankItem('blocklist') as unknown as BlockedNumber), id: number, number })
const inbound = (cfg: ReturnType<typeof sampleConfig>, cid: string): string[] =>
  routeInbound(cfg, { trunk: 't1', did: '+49301234567', to: '', cid, name: '' }).split('|')

describe('Anrufsperren', () => {
  it('weist gesperrte Nummern in jeder Schreibweise ab', () => {
    const cfg = sampleConfig()
    cfg.blocklist = [block('030 9999999')]
    expect(inbound(cfg, '+49309999999')[0]).toBe('p4a-blocked^s')
    expect(inbound(cfg, '0309999999')[0]).toBe('p4a-blocked^s')
    expect(inbound(cfg, '+49309999998')[0]).toBe('p4a-group^g1')
  })

  it('sperrt mit * alle Nummern mit diesem Anfang', () => {
    const cfg = sampleConfig()
    cfg.blocklist = [block('+44*')]
    expect(inbound(cfg, '00447700900123')[0]).toBe('p4a-blocked^s')
    expect(inbound(cfg, '+4930111')[0]).toBe('p4a-group^g1')
  })

  it('weist Anrufe ohne Nummer nur auf Wunsch ab', () => {
    const cfg = sampleConfig()
    expect(inbound(cfg, '')[0]).toBe('p4a-group^g1')
    cfg.blocking.anonymous = 'reject'
    expect(inbound(cfg, '')[0]).toBe('p4a-blocked^s')
    expect(inbound(cfg, '0301111111')[0]).toBe('p4a-group^g1')
  })

  it('prüft und vervollständigt Einträge', () => {
    const cfg = validConfig()
    cfg.blocklist = [{ ...block('030 / 12 34-5'), id: '', created: '' }]
    validate(cfg)
    expect(cfg.blocklist[0].number).toBe('03012345')
    expect(cfg.blocklist[0].id).not.toBe('')
    expect(cfg.blocklist[0].created).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    cfg.blocklist = [block('Werbung')]
    expect(() => validate(cfg)).toThrow(/keine Rufnummer/)
  })
})

describe('Parken', () => {
  it('erzeugt res_parking.conf und belegt die Nummern', () => {
    const cfg = sampleConfig()
    const conf = parkingConf(cfg)
    expect(conf).toContain('parkext => 700')
    expect(conf).toContain('parkpos => 701-708')
    expect(conf).toContain('context => p4a-park')
    expect(parkingNumbers(cfg)).toEqual(['700', '701', '702', '703', '704', '705', '706', '707', '708'])
    cfg.parking.enabled = false
    expect(parkingNumbers(cfg)).toEqual([])
  })

  it('erkennt Überschneidungen mit anderen Nummern', () => {
    const cfg = validConfig()
    cfg.parking.number = '10'
    expect(() => validate(cfg)).toThrow()
    cfg.parking.number = '90'
    cfg.parking.slots = 20
    expect(() => validate(cfg)).toThrow(/Stellenzahl/)
  })
})

describe('Besetztanzeige', () => {
  it('übersetzt den Zustand der Hints', () => {
    expect(lineState(0)).toBe('idle')
    expect(lineState(1)).toBe('busy')
    expect(lineState(8)).toBe('ringing')
    expect(lineState(9)).toBe('busy')
    expect(lineState(4)).toBe('offline')
    expect(lineState(-1)).toBe('offline')
  })

  it('verfolgt Nebenstellen und geparkte Gespräche', () => {
    const cfg = sampleConfig()
    const p = new Presence(() => 100000)
    p.load([{ Event: 'ExtensionStatus', Context: 'p4a-local', Exten: '10', Status: '0' }], [])
    p.onAmi({ Event: 'ExtensionStatus', Context: 'p4a-local', Exten: '11', Status: '8' })
    p.onAmi({ Event: 'ExtensionStatus', Context: 'p4a-park', Exten: '701', Status: '1' })
    p.onAmi({
      Event: 'ParkedCall',
      ParkingSpace: '701',
      ParkeeCallerIDNum: '0301111111',
      ParkeeCallerIDName: 'Max Kunde',
      ParkerDialString: 'PJSIP/10-app',
      ParkingDuration: '5',
      ParkingTimeout: '120',
    })
    const state = structuredClone(EMPTY_STATE)
    state.dnd['12'] = true
    state.cfu['11'] = '017012345678'
    const v = p.view(cfg, state)
    expect(v.extensions.map((e) => [e.number, e.state, e.dnd, e.forward])).toEqual([
      ['10', 'idle', false, ''],
      ['11', 'ringing', false, 'extern'],
      ['12', 'offline', true, ''],
    ])
    expect(v.parked).toEqual([{ slot: '701', number: '0301111111', name: 'Max Kunde', by: '10', since: 95000, until: 215000 }])
    const before = v.revision
    p.onAmi({ Event: 'UnParkedCall', ParkingSpace: '701' })
    expect(p.view(cfg, state).parked).toEqual([])
    expect(p.view(cfg, state).revision).not.toBe(before)
  })
})

describe('Voicemail', () => {
  it('liest Nachrichten aus dem Spool', () => {
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-vm-'))
    const inbox = path.join(spool, 'voicemail', 'default', '10', 'INBOX')
    const old = path.join(spool, 'voicemail', 'default', '10', 'Old')
    fs.mkdirSync(inbox, { recursive: true })
    fs.mkdirSync(old, { recursive: true })
    const info = (id: string, time: number, cid: string): string =>
      `;\n; Message Information file\n;\n[message]\norigmailbox=10\ncallerid=${cid}\norigtime=${time}\nduration=12\nmsg_id=${id}\n`
    fs.writeFileSync(path.join(inbox, 'msg0000.txt'), info('a1', 1700000100, '"Anna Müller" <0301234>'))
    fs.writeFileSync(path.join(inbox, 'msg0000.wav'), 'RIFF')
    fs.writeFileSync(path.join(old, 'msg0000.txt'), info('b2', 1700000000, 'Unknown'))
    const box = new VoicemailBox(spool)
    expect(box.list('10')).toEqual([
      { id: 'a1', folder: 'INBOX', unread: true, time: 1700000100000, number: '0301234', name: 'Anna Müller', duration: 12 },
      { id: 'b2', folder: 'Old', unread: false, time: 1700000000000, number: '', name: '', duration: 12 },
    ])
    expect(box.unread('10')).toBe(1)
    expect(box.file('10', 'a1')).toBe(path.join(inbox, 'msg0000.wav'))
    expect(box.file('10', 'b2')).toBeNull()
    expect(box.list('../10')).toEqual([])
  })

  it('zerlegt die Absenderangabe', () => {
    expect(parseCallerId('"Max" <+4930>')).toEqual({ name: 'Max', number: '+4930' })
    expect(parseCallerId('0301234')).toEqual({ name: '', number: '0301234' })
  })
})

describe('Anruf-Ereignisse', () => {
  it('meldet Klingeln, Annahme und Ende eines Anrufs von außen', () => {
    let now = 1000
    const t = new CallTracker(() => now)
    const events: PbxEvent[] = []
    t.on('event', (e: PbxEvent) => events.push(e))
    t.onAmi({ Event: 'Newchannel', Channel: 'PJSIP/trunk-t1-00000001', Uniqueid: 'c1', Linkedid: 'c1', CallerIDNum: '+49301111111', CallerIDName: '' })
    t.onAmi({ Event: 'DialBegin', Linkedid: 'c1', DestChannel: 'PJSIP/10-00000002', CallerIDNum: '0301111111', CallerIDName: 'Max Kunde' })
    t.onAmi({ Event: 'DialBegin', Linkedid: 'c1', DestChannel: 'PJSIP/11-app-00000003', CallerIDNum: '0301111111', CallerIDName: 'Max Kunde' })
    now = 5000
    t.onAmi({ Event: 'DialEnd', Linkedid: 'c1', DestChannel: 'PJSIP/11-app-00000003', DialStatus: 'ANSWER' })
    now = 65000
    t.onAmi({ Event: 'Hangup', Uniqueid: 'c1', Linkedid: 'c1' })
    expect(events.map((e) => [e.event, e.data.extension ?? ''])).toEqual([
      ['call.ringing', '10'],
      ['call.ringing', '11'],
      ['call.answered', '11'],
      ['call.ended', ''],
    ])
    expect(events[0].data).toMatchObject({ direction: 'in', from: '0301111111', from_name: 'Max Kunde' })
    expect(events[3].data).toMatchObject({ answered: true, answered_by: '11', duration: 60 })
  })

  it('meldet verpasste Anrufe und neue Voicemails', () => {
    const t = new CallTracker()
    const events: PbxEvent[] = []
    t.on('event', (e: PbxEvent) => events.push(e))
    t.onAmi({ Event: 'Newchannel', Channel: 'PJSIP/trunk-t1-00000001', Uniqueid: 'c2', Linkedid: 'c2', CallerIDNum: '0301', CallerIDName: '' })
    t.onAmi({ Event: 'DialBegin', Linkedid: 'c2', DestChannel: 'PJSIP/10-00000002' })
    t.onAmi({ Event: 'Hangup', Uniqueid: 'c2', Linkedid: 'c2' })
    t.setMailbox('10', 0)
    t.onAmi({ Event: 'MessageWaiting', Mailbox: '10@default', New: '1' })
    t.onAmi({ Event: 'MessageWaiting', Mailbox: '10@default', New: '0' })
    expect(events.map((e) => e.event)).toEqual(['call.ringing', 'call.ended', 'call.missed', 'voicemail.new'])
    expect(events[2].data.extensions).toEqual(['10'])
  })

  it('erkennt ausgehende Anrufe', () => {
    const t = new CallTracker()
    const events: PbxEvent[] = []
    t.on('event', (e: PbxEvent) => events.push(e))
    t.onAmi({ Event: 'Newchannel', Channel: 'PJSIP/10-00000001', Uniqueid: 'c3', Linkedid: 'c3', CallerIDNum: '10', CallerIDName: 'Anna' })
    t.onAmi({ Event: 'DialBegin', Linkedid: 'c3', DestChannel: 'PJSIP/trunk-t1-00000002' })
    t.onAmi({ Event: 'DialEnd', Linkedid: 'c3', DestChannel: 'PJSIP/trunk-t1-00000002', DialStatus: 'ANSWER' })
    t.onAmi({ Event: 'Hangup', Uniqueid: 'c3', Linkedid: 'c3' })
    expect(events.map((e) => e.event)).toEqual(['call.answered', 'call.ended'])
    expect(events[1].data).toMatchObject({ direction: 'out', from: '10', answered_by: 'extern' })
  })
})

const HMAC_EXAMPLE = '0c3e89010807a274fd26fae3628d3e1dc8f1ee15cc206a8e72920e50b4da8baf'

describe('Webhooks', () => {
  it('signiert wie GitHub', () => {
    // echo -n '{"a":1}' | openssl dgst -sha256 -hmac geheim
    expect(signature('geheim', '{"a":1}')).toBe(`sha256=${HMAC_EXAMPLE}`)
    expect(signature('geheim', '{"a":1}')).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(signature('geheim', 'x')).not.toBe(signature('anders', 'x'))
  })

  it('schickt nur die gewählten Ereignisse an aktive Webhooks', async () => {
    const cfg = sampleConfig()
    const hook = (id: string, extra: Partial<Webhook>): Webhook => ({ id, name: id, url: `https://example.com/${id}`, enabled: true, events: [], secret: 's', ...extra })
    cfg.webhooks = [hook('alle', {}), hook('notruf', { events: ['emergency'] }), hook('aus', { enabled: false })]
    const sent: { url: string; headers: Record<string, string>; body: string }[] = []
    const send = (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) })
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch
    const w = new Webhooks(() => cfg, send)
    await Promise.all(w.dispatch({ event: 'call.missed', time: 't', data: {} }))
    expect(sent.map((s) => s.url)).toEqual(['https://example.com/alle'])
    expect(sent[0].headers['X-Phone4all-Signature']).toBe(signature('s', sent[0].body))
    expect(JSON.parse(sent[0].body)).toEqual({ event: 'call.missed', time: 't', data: {}, pbx: cfg.system.name })
    await Promise.all(w.dispatch({ event: 'emergency', time: 't', data: {} }))
    expect(sent).toHaveLength(3)
    expect(w.status.get('alle')).toMatchObject({ ok: true, result: 'HTTP 204' })
  })
})

describe('Notrufe', () => {
  it('erkennt 110 und 112, aber nicht bei Weiterleitungen', () => {
    expect(isEmergency('112', '')).toBe(true)
    expect(isEmergency('110', '')).toBe(true)
    expect(isEmergency('112', '10')).toBe(false)
    expect(isEmergency('1120', '')).toBe(false)
  })

  it('beschreibt den Notruf', () => {
    const cfg = sampleConfig()
    const c = emergencyCall(cfg, '10', '112', new Date('2026-03-01T10:00:00Z'))
    expect(c).toMatchObject({ extension: '10', name: 'Person 10', number: '112', time: '2026-03-01T10:00:00.000Z' })
    expect(emergencyText(cfg, c)).toBe('Notruf: Person 10 (10) hat am 01.03.26, 11:00:00 die 112 gewählt.')
  })
})

describe('Externe Sicherung', () => {
  const settings = (extra: Partial<OffsiteSettings>): OffsiteSettings => ({ ...sampleConfig().offsite, enabled: true, ...extra })

  it('packt und verschlüsselt', () => {
    const json = JSON.stringify({ hallo: 'welt'.repeat(100) })
    expect(unpack(pack(json, ''), '')).toBe(json)
    const enc = pack(json, 'kennwort')
    expect(enc.subarray(0, 8).toString()).toBe('P4AENC1\n')
    expect(unpack(enc, 'kennwort')).toBe(json)
    expect(() => unpack(enc, 'falsch')).toThrow(/Kennwort passt nicht/)
    expect(() => unpack(enc, '')).toThrow(/verschlüsselt/)
    expect(() => unpack(Buffer.from('xyz'), '')).toThrow(/keine Sicherung/)
  })

  it('benennt Dateien nach Datum', () => {
    expect(fileName(new Date('2026-03-01T10:20:30.400Z'), true)).toBe('phone4all-2026-03-01T10-20-30.json.gz.enc')
    expect(fileName(new Date('2026-03-01T10:20:30.400Z'), false)).toBe('phone4all-2026-03-01T10-20-30.json.gz')
  })

  it('signiert S3-Anfragen (Beispiel aus der AWS-Dokumentation)', () => {
    const headers = signS3({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      region: 'us-east-1',
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      body: '',
      date: new Date('2013-05-24T00:00:00Z'),
      headers: { Range: 'bytes=0-9' },
    })
    expect(headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
  })

  it('liest Dateilisten von WebDAV und S3', () => {
    const dav = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
      <d:response><d:href>/remote.php/dav/files/anna/phone4all/</d:href><d:propstat><d:prop/></d:propstat></d:response>
      <d:response><d:href>/remote.php/dav/files/anna/phone4all/phone4all-2026-01-01T00-00-00.json.gz</d:href><d:propstat><d:prop><d:getcontentlength>123</d:getcontentlength></d:prop></d:propstat></d:response>
      <d:response><d:href>/remote.php/dav/files/anna/phone4all/phone4all-2026-01-02T00-00-00.json.gz.enc</d:href><d:propstat><d:prop><d:getcontentlength>456</d:getcontentlength></d:prop></d:propstat></d:response>
      <d:response><d:href>/remote.php/dav/files/anna/phone4all/fremd.txt</d:href></d:response>
    </d:multistatus>`
    expect(parsePropfind(dav)).toEqual([
      { name: 'phone4all-2026-01-02T00-00-00.json.gz.enc', size: 456 },
      { name: 'phone4all-2026-01-01T00-00-00.json.gz', size: 123 },
    ])
    const s3 = '<ListBucketResult><Contents><Key>pbx/phone4all-2026-01-01T00-00-00.json.gz</Key><Size>99</Size></Contents></ListBucketResult>'
    expect(parseS3List(s3)).toEqual([{ name: 'phone4all-2026-01-01T00-00-00.json.gz', size: 99 }])
  })

  it('lädt per WebDAV hoch und löscht alte Sicherungen', async () => {
    const calls: string[] = []
    const existing = ['phone4all-2026-01-03T00-00-00.json.gz', 'phone4all-2026-01-02T00-00-00.json.gz', 'phone4all-2026-01-01T00-00-00.json.gz']
    const send = (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`)
      if (init.method === 'PROPFIND') {
        const body = existing.map((n) => `<d:response><d:href>/dav/pbx/${n}</d:href></d:response>`).join('')
        return new Response(`<d:multistatus xmlns:d="DAV:">${body}</d:multistatus>`, { status: 207 })
      }
      return new Response(null, { status: init.method === 'MKCOL' ? 405 : 201 })
    }) as unknown as typeof fetch
    const name = await upload(settings({ url: 'https://nas/dav/', folder: 'pbx', keep: 2 }), '{}', new Date('2026-01-04T00:00:00Z'), send)
    expect(name).toBe('phone4all-2026-01-04T00-00-00.json.gz')
    expect(calls).toEqual([
      'MKCOL https://nas/dav/pbx/',
      `PUT https://nas/dav/pbx/${name}`,
      'PROPFIND https://nas/dav/pbx/',
      'DELETE https://nas/dav/pbx/phone4all-2026-01-01T00-00-00.json.gz',
    ])
  })

  it('prüft die Einstellungen', () => {
    const cfg = validConfig()
    cfg.offsite = settings({ url: 'ftp://x' })
    expect(() => validate(cfg)).toThrow()
    cfg.offsite = settings({ type: 's3', url: 'https://s3.example.com', bucket: '' })
    expect(() => validate(cfg)).toThrow()
    cfg.offsite = settings({ type: 's3', url: 'https://s3.example.com', bucket: 'meine-sicherung' })
    expect(() => validate(cfg)).not.toThrow()
  })
})
