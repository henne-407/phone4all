import { describe, expect, it, vi } from 'vitest'

// Module mit Electron-Abhängigkeiten nur so weit wie nötig ersetzen
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false, getAppPath: () => '/tmp' }, safeStorage: {} }))

import { accountLine } from '../src/main/baresip'
import { guessColumns, mergeInto, parseCsv, parseFileData, parseVcards } from '../src/main/contactImport'
import { expandEvents, newCalendar, parseCalendar, updateCalendar } from '../src/main/ical'
import { encodeWav } from '../src/main/ringtones'
import { broadcastAddresses, normalizeServer, parseProfile, profileUrlFromLink } from '../src/main/provisioning'
import { MsSqlSource, quoteIdent } from '../src/main/sqlSource'
import { covers, fmtEventTime, formatDuration, formatTalk } from '../src/shared/format'
import { findNumbers, normalizeNumber, numberFromUri, numbersMatch } from '../src/shared/numbers'
import { frequent, summary } from '../src/shared/stats'
import { THEMES, contrast, paletteFor } from '../src/shared/themes'
import type { CalEvent, Contact, SqlSourceConf } from '../src/shared/types'

describe('Rufnummern', () => {
  it('normalisiert und vergleicht', () => {
    expect(normalizeNumber(' +49 (30) 123-45 67 ')).toBe('+49301234567')
    expect(normalizeNumber('sip:alice@pbx')).toBe('sip:alice@pbx')
    expect(numberFromUri('sip:0301234@pbx.local;user=phone')).toBe('0301234')
    expect(numbersMatch('+49301234567', '0301234567')).toBe(true)
    expect(numbersMatch('030 1234567', '0301234567')).toBe(true)
    expect(numbersMatch('12345', '912345')).toBe(false)
    expect(numbersMatch('', '1')).toBe(false)
  })

  it('findet Einwahlnummern, aber keine Datumsangaben', () => {
    expect(findNumbers('Einwahl: +49 69 1234 5678, PIN 1234', 'am 2026-10-15')).toEqual(['+49 69 1234 5678'])
    expect(findNumbers('tel:+4930123456')).toEqual(['+4930123456'])
  })
})

describe('Formate', () => {
  it('Dauer und Gesprächszeit', () => {
    expect(formatDuration(83)).toBe('01:23')
    expect(formatDuration(3723)).toBe('1:02:03')
    expect(formatTalk(59)).toBe('0 Min.')
    expect(formatTalk(3900)).toBe('1 Std. 05 Min.')
  })

  it('Termine über mehrere Tage', () => {
    const start = new Date(2026, 9, 14, 22, 0).getTime()
    const ev = { start, end: new Date(2026, 9, 15, 2, 0).getTime(), allDay: false } as CalEvent
    expect(covers(ev, new Date(2026, 9, 15))).toBe(true)
    expect(covers(ev, new Date(2026, 9, 16))).toBe(false)
    expect(fmtEventTime(ev, new Date(2026, 9, 15))).toBe('Seit 14.10. 22:00 – 15.10. 02:00')
  })
})

describe('vCard', () => {
  it('liest vCard 3.0 und 2.1 mit Quoted-Printable', () => {
    const text = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Erika Mustermann',
      'ORG:Beispiel GmbH;Vertrieb',
      'TEL;TYPE=CELL:+49 170 1234567',
      'TEL;TYPE=WORK,PREF:030 123456',
      'TEL;TYPE=FAX:030 999999',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:2.1',
      'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=BCller;J=C3=BCrgen;;;',
      'TEL;CELL;VOICE:0151 2223334',
      'END:VCARD',
      'BEGIN:VCARD',
      'FN:Ohne Nummer',
      'END:VCARD',
    ].join('\r\n')
    const contacts = parseVcards(text)
    expect(contacts).toHaveLength(2)
    expect(contacts[0]).toMatchObject({ name: 'Erika Mustermann', company: 'Beispiel GmbH', phone: '030 123456', mobile: '+49 170 1234567', other: [] })
    expect(contacts[1]).toMatchObject({ name: 'Jürgen Müller', mobile: '0151 2223334' })
    const [, skipped] = parseFileData(Buffer.from(text))
    expect(skipped).toBe(1)
  })
})

describe('CSV', () => {
  it('erkennt Google-Export mit Typspalten', () => {
    const csv =
      'Name,Organization 1 - Name,Phone 1 - Type,Phone 1 - Value,Phone 2 - Type,Phone 2 - Value\n' +
      'Max Muster,ACME,Mobile,0171 111111 ::: 0171 222222,Work Fax,030 5555\n'
    const [contacts, total] = parseCsv(csv)
    expect(total).toBe(1)
    expect(contacts[0]).toMatchObject({ name: 'Max Muster', company: 'ACME', mobile: '0171 111111', other: ['0171 222222'] })
  })

  it('erkennt Semikolon, Anführungszeichen und deutsche Spalten', () => {
    const csv = 'Vorname;Nachname;Firma;Telefon;Handy\n"Anna";"Beispiel; Jr.";"X";"030 1";"0160 2"\n'
    const [contacts] = parseCsv(csv)
    expect(contacts[0]).toMatchObject({ name: 'Anna Beispiel; Jr.', company: 'X', phone: '030 1', mobile: '0160 2' })
  })

  it('Windows-1252-Dateien', () => {
    const data = Buffer.from('Name;Telefon\nG\xf6tz;0301234567\n', 'latin1')
    expect(parseFileData(data)[0][0].name).toBe('Götz')
  })

  it('Spaltenzuordnung', () => {
    const g = guessColumns(['Kundenname', 'Name1', 'Tel', 'Faxnummer', 'Mobil'])
    expect(g.company).toEqual([0])
    expect(g.phone).toEqual([2, 4])
  })
})

describe('Zusammenführen', () => {
  it('ergänzt statt doppelt anzulegen', () => {
    const contacts: Contact[] = [{ id: '1', name: 'Erika', phone: '030123456', mobile: '', other: [], company: '' }]
    const stats = mergeInto(contacts, [
      { name: 'Erika M.', phone: '+4930123456', mobile: '0170 999', other: [], company: 'Firma' },
      { name: 'erika', phone: '', mobile: '', other: ['040 1'], company: '' },
      { name: 'Neu', phone: '089 1', mobile: '', other: [], company: '' },
      { name: 'Erika', phone: '030123456', mobile: '', other: [], company: '' },
    ])
    expect(stats).toEqual([1, 2, 1])
    expect(contacts[0]).toMatchObject({ company: 'Firma', mobile: '0170 999', other: ['040 1'] })
  })
})

describe('baresip', () => {
  it('Kontozeile', () => {
    const acc = {
      display_name: 'Büro',
      user: '620',
      domain: 'fritz.box',
      auth_user: '',
      port: 0,
      local_port: 0,
      transport: 'tls' as const,
      outbound: 'proxy.example.org',
      stun: 'stun.example.org',
      mediaenc: 'srtp',
      regint: 600,
    }
    expect(accountLine(acc, 'geheim')).toBe(
      '"Büro" <sip:620@fritz.box;transport=tls>;auth_user=620;auth_pass=geheim;outbound="sip:proxy.example.org";' +
        'stunserver=stun:stun.example.org;medianat=stun;mediaenc=srtp;regint=600;answermode=manual',
    )
    expect(accountLine({ ...acc, domain: '' }, 'x')).toBeNull()
  })
})

describe('iCalendar', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:serie@test',
    'DTSTART;TZID=Europe/Berlin:20261005T090000',
    'DTEND;TZID=Europe/Berlin:20261005T093000',
    'RRULE:FREQ=WEEKLY;COUNT=10',
    'EXDATE;TZID=Europe/Berlin:20261012T090000',
    'SUMMARY:Jour fixe',
    'LOCATION:Einwahl 069 12345678',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:ganz@test',
    'DTSTART;VALUE=DATE:20261020',
    'DTEND;VALUE=DATE:20261022',
    'SUMMARY:Urlaub',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  it('expandiert Serien mit Ausnahmen und Zeitzonen', () => {
    const vcal = parseCalendar(ics)!
    const events = expandEvents(vcal, Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 31))
    const series = events.filter((e) => e.uid === 'serie@test')
    // 5., 19., 26. Oktober (12. ausgenommen); 9:00 Berlin = 7:00 UTC (Sommerzeit)
    expect(series.map((e) => new Date(e.start).toISOString())).toEqual([
      '2026-10-05T07:00:00.000Z',
      '2026-10-19T07:00:00.000Z',
      '2026-10-26T08:00:00.000Z', // nach der Zeitumstellung am 25.10.
    ])
    expect(series[0].end - series[0].start).toBe(30 * 60000)
    expect(series[0].recurring).toBe(true)
    const vacation = events.find((e) => e.uid === 'ganz@test')!
    expect(vacation.allDay).toBe(true)
    expect(new Date(vacation.start).getDate()).toBe(20)
    expect(vacation.end - vacation.start).toBe(2 * 86400000)
  })

  it('schreibt und ändert Termine', () => {
    const start = Date.UTC(2026, 9, 20, 12, 0)
    const ev = { uid: 'neu@test', summary: 'Rückruf', start, end: start + 900000, allDay: false, location: '', description: 'Telefon: 0301' }
    const text = newCalendar(ev)
    expect(text).toContain('DTSTART:20261020T120000Z')
    expect(text).toContain('DESCRIPTION:Telefon: 0301')
    const changed = updateCalendar(text, { ...ev, summary: 'Geändert', description: '' })!
    expect(changed).toContain('SUMMARY:Geändert')
    expect(changed).not.toContain('DESCRIPTION')
    const parsed = expandEvents(parseCalendar(changed)!, start - 1, start + 1)
    expect(parsed[0].start).toBe(start)
  })
})

describe('SQL Server', () => {
  it('maskiert Bezeichner und baut die Abfrage', () => {
    expect(quoteIdent('dbo.Kunden]x')).toBe('[dbo].[Kunden]]x]')
    const conf: SqlSourceConf = {
      id: '1',
      name: '',
      host: 'srv',
      port: 1433,
      database: 'crm',
      user: 'u',
      mode: 'table',
      table: 'dbo.Kontakte',
      name_cols: 'Vorname, Nachname',
      company_col: 'Firma',
      phone_cols: 'Telefon, Handy',
      query: '',
    }
    expect(new MsSqlSource(conf, '').buildQuery()).toBe(
      "SELECT TOP 50000 LTRIM(RTRIM(CONCAT([Vorname], ' ', [Nachname], ''))) AS [name], [Firma] AS [company], " +
        '[Telefon] AS [phone 1], [Handy] AS [mobile 2] FROM [dbo].[Kontakte]',
    )
    expect(MsSqlSource.suggest(['ID', 'Vorname', 'Nachname', 'Firma', 'Tel', 'Mobil'])).toEqual({
      name_cols: 'Vorname, Nachname',
      company_col: 'Firma',
      phone_cols: 'Tel, Mobil',
    })
  })
})

describe('Statistik', () => {
  it('zählt Kontakte über mehrere Nummern', () => {
    const now = Date.now() / 1000
    const history = [
      { time: now, direction: 'out' as const, number: '1', name: '', duration: 60, missed: false, contactId: 'a', contactName: 'Anna' },
      { time: now, direction: 'in' as const, number: '2', name: '', duration: 0, missed: true, contactId: 'a', contactName: 'Anna' },
      { time: now, direction: 'in' as const, number: '3', name: 'Bob', duration: 30, missed: false },
    ]
    expect(summary(history)).toMatchObject({ total: 3, incoming: 1, outgoing: 1, missed: 1, talk: 90 })
    expect(frequent(history)).toEqual([
      { name: 'Anna', number: '1', count: 2 },
      { name: 'Bob', number: '3', count: 1 },
    ])
    expect(frequent(history, 8, 90, new Set(['a']))).toHaveLength(1)
  })
})

describe('Farbthemen', () => {
  it('Text auf Primärfarbe ist lesbar (WCAG AA)', () => {
    for (const t of THEMES) {
      for (const dark of [false, true]) {
        const r = paletteFor(t.key, dark, '#3584e4')
        expect(contrast(r.primary, r.onPrimary), `${t.key} ${dark}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(r.onSurface, r.surface)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('Klingeltöne', () => {
  it('erzeugt gültiges WAV', () => {
    const wav = encodeWav([0, 0.5, -0.5, 1])
    expect(wav.subarray(0, 4).toString()).toBe('RIFF')
    expect(wav.readUInt32LE(24)).toBe(32000)
    expect(wav.length).toBe(44 + 8)
  })
})

describe('Einrichtung durch die Telefonanlage', () => {
  const profile = {
    format: 'phone4all-provisioning',
    version: 1,
    pbx: { name: 'Büro', version: '1.0.0' },
    extension: '10',
    account: { display_name: 'Anna', user: '10', domain: '192.168.1.10', auth_user: '10', port: 0, local_port: 0, transport: 'udp', outbound: '', stun: '', mediaenc: '', regint: 300 },
    password: 'geheim',
    url: 'http://192.168.1.10:8080/provision/abc',
    phonebook: [{ name: 'Bert', company: 'Büro', phone: '11', mobile: '' }],
  }

  it('liest Links aus App, Einladung und Profil', () => {
    expect(profileUrlFromLink('sip-telefon://provision?url=http%3A%2F%2Fpbx%3A8080%2Fprovision%2Fabc')).toBe('http://pbx:8080/provision/abc')
    expect(profileUrlFromLink('http://pbx:8080/setup/abc')).toBe('http://pbx:8080/provision/abc')
    expect(profileUrlFromLink('sip-telefon://provision?url=file%3A%2F%2F%2Fetc%2Fpasswd')).toBeNull()
    expect(profileUrlFromLink('Hallo')).toBeNull()
  })

  it('ergänzt die Adresse der Anlage', () => {
    expect(normalizeServer('192.168.1.10')).toBe('http://192.168.1.10:8080')
    expect(normalizeServer('pbx.local:9000/')).toBe('http://pbx.local:9000')
    expect(normalizeServer('https://pbx.example.de')).toBe('https://pbx.example.de')
  })

  it('prüft das Profil', () => {
    expect(parseProfile(profile).account.domain).toBe('192.168.1.10')
    expect(() => parseProfile({ ...profile, format: 'x' })).toThrow()
    expect(() => parseProfile({ ...profile, password: 'a;b' })).toThrow()
  })

  it('berechnet Broadcast-Adressen', () => {
    const ifaces = {
      eth0: [{ address: '192.168.1.23', netmask: '255.255.255.0', family: 'IPv4', internal: false }],
      lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }],
    } as never
    expect(broadcastAddresses(ifaces)).toEqual(['255.255.255.255', '192.168.1.255'])
  })
})
