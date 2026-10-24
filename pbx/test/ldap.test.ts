import { describe, expect, it } from 'vitest'
import { type Ber, int, readBer, respond, seq, str, tlv } from '../server/ldap'
import { sampleConfig } from './helpers'

// Filter wie in RFC 4511 kodiert
const eq = (attr: string, value: string): Buffer => tlv(0xa3, [str(attr), str(value)])
const sub = (attr: string, initial: string): Buffer => tlv(0xa4, [str(attr), seq(str(initial, 0x80))])
const or = (...f: Buffer[]): Buffer => tlv(0xa1, f)
const present = (attr: string): Buffer => str(attr, 0x87)

function searchMsg(filter: Buffer, base = 'dc=phone4all', scope = 2, attrs: string[] = [], sizeLimit = 0): Ber {
  const op = tlv(0x63, [str(base), int(scope, 0x0a), int(0, 0x0a), int(sizeLimit), int(0), tlv(0x01, Buffer.from([0])), filter, seq(...attrs.map((a) => str(a)))])
  return readBer(seq(int(2), op))!.ber
}

const bindMsg = (name: string, password: string): Ber => readBer(seq(int(1), tlv(0x60, [int(3), str(name), str(password, 0x80)])))!.ber

/** Antworten lesen: Einträge als { dn, attrs } und der Ergebniscode */
function decode(out: Buffer[] | 'close'): { entries: { dn: string; attrs: Record<string, string[]> }[]; code: number } {
  if (out === 'close') throw new Error('geschlossen')
  const entries: { dn: string; attrs: Record<string, string[]> }[] = []
  let code = -1
  for (const b of out) {
    const op = readBer(b)!.ber.children[1]
    if (op.tag === 0x64) {
      const attrs: Record<string, string[]> = {}
      for (const a of op.children[1].children) attrs[a.children[0].value.toString()] = a.children[1].children.map((v) => v.value.toString())
      entries.push({ dn: op.children[0].value.toString(), attrs })
    } else code = op.children[0].value[0]
  }
  return { entries, code }
}

describe('LDAP-Telefonbuch', () => {
  const cfg = sampleConfig()
  cfg.ldap.enabled = true

  it('sucht nach Namen und liefert die Kontakte mit Rufnummern', () => {
    const r = decode(respond(cfg, searchMsg(or(sub('cn', 'max'), sub('sn', 'max'))), { bound: false }))
    expect(r.code).toBe(0)
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0].dn).toBe('uid=pb-p1,dc=phone4all')
    expect(r.entries[0].attrs).toMatchObject({ cn: ['Max Kunde'], givenName: ['Max'], sn: ['Kunde'], o: ['Kunde GmbH'], telephoneNumber: ['0301111111'] })
  })

  it('findet Rufnummern in jeder Schreibweise', () => {
    for (const n of ['+49301111111', '0301111111', '030 1111111']) {
      const r = decode(respond(cfg, searchMsg(or(eq('telephoneNumber', n), eq('mobile', n)), 'dc=phone4all', 2, ['cn']), { bound: false }))
      expect(r.entries.map((e) => e.attrs)).toEqual([{ cn: ['Max Kunde'] }])
    }
  })

  it('enthält Nebenstellen und Gruppen', () => {
    const r = decode(respond(cfg, searchMsg(present('telephoneNumber'), 'dc=phone4all', 1, ['telephoneNumber']), { bound: false }))
    expect(r.entries.map((e) => e.attrs.telephoneNumber[0])).toEqual(['10', '11', '12', '20', '0301111111'])
  })

  it('beachtet die Größenbegrenzung und den Root DSE', () => {
    expect(decode(respond(cfg, searchMsg(present('cn'), 'dc=phone4all', 2, [], 2), { bound: false }))).toMatchObject({ code: 4 })
    const dse = decode(respond(cfg, searchMsg(present('objectClass'), '', 0, ['namingContexts']), { bound: false }))
    expect(dse.entries[0].attrs.namingContexts).toEqual(['dc=phone4all'])
    expect(decode(respond(cfg, searchMsg(present('cn'), 'dc=andere'), { bound: false })).code).toBe(32)
  })

  it('verlangt das Kennwort, wenn eines gesetzt ist', () => {
    const locked = structuredClone(cfg)
    locked.ldap.password = 'buch123'
    locked.extensions[0].secret = 'sipgeheim'
    const session = { bound: false }
    expect(decode(respond(locked, searchMsg(present('cn')), session)).code).toBe(50)
    expect(decode(respond(locked, bindMsg('cn=telefonbuch,dc=phone4all', 'falsch'), session)).code).toBe(49)
    expect(decode(respond(locked, bindMsg('cn=telefonbuch,dc=phone4all', 'buch123'), session)).code).toBe(0)
    expect(decode(respond(locked, searchMsg(present('cn')), session)).entries.length).toBeGreaterThan(0)
    // Gigaset-Anmeldeart „SIP“: Nebenstelle und SIP-Passwort
    const sip = { bound: false }
    expect(decode(respond(locked, bindMsg('10', 'sipgeheim'), sip)).code).toBe(0)
    expect(sip.bound).toBe(true)
  })

  it('liest Nachrichten, die in Stücken ankommen', () => {
    const msg = seq(int(7), tlv(0x63, [str('dc=phone4all'), int(2, 0x0a), int(0, 0x0a), int(0), int(0), tlv(0x01, Buffer.from([0])), present('cn'), seq()]))
    expect(readBer(msg.subarray(0, 10))).toBeNull()
    expect(readBer(msg)?.end).toBe(msg.length)
  })
})
