import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixOwner } from '../server/asterisk'

// chown auf fremde Benutzer geht nur als root (im Docker-Build der Fall)
describe.skipIf(process.getuid?.() !== 0)('Eigentümer der Asterisk-Dateien', () => {
  it('gibt Dateien mit fremdem Eigentümer dem Asterisk-Benutzer zurück', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-owner-'))
    fs.mkdirSync(path.join(dir, 'cdr-custom'))
    const csv = path.join(dir, 'cdr-custom', 'cdr.csv')
    fs.writeFileSync(csv, '')
    fs.writeFileSync(path.join(dir, 'messages.log'), '')
    fs.chownSync(csv, 4242, 4242)
    expect(fixOwner(dir, 1234, 1234)).toBe(3)
    expect(fs.statSync(csv).uid).toBe(1234)
    expect(fs.statSync(path.join(dir, 'cdr-custom')).gid).toBe(1234)
    // Beim zweiten Mal ist nichts mehr zu tun
    expect(fixOwner(dir, 1234, 1234)).toBe(0)
    fs.rmSync(dir, { recursive: true })
  })

  it('übersteht fehlende Ordner', () => {
    expect(fixOwner('/gibt/es/nicht', 1, 1)).toBe(0)
  })
})
