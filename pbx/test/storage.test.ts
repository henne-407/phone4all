import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { expireRecordings, expireVoicemail, listRecordings, recordingFile } from '../server/storage'

const DAY = 86400000

function touch(file: string, ageDays: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, 'x')
  const t = new Date(Date.now() - ageDays * DAY)
  fs.utimesSync(file, t, t)
}

describe('Speicher', () => {
  it('listet Gesprächs- und Konferenzaufnahmen und löscht nach der Frist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'))
    touch(path.join(dir, '1700000000.1-1700000000.2.wav'), 40)
    touch(path.join(dir, 'konferenz-800-1700000000.wav'), 5)
    touch(path.join(dir, 'notiz.txt'), 100)
    expect(listRecordings(dir).map((r) => r.kind)).toEqual(['conference', 'call'])
    expect(expireRecordings(0, Date.now(), dir)).toBe(0)
    expect(expireRecordings(30, Date.now(), dir)).toBe(1)
    expect(listRecordings(dir).map((r) => r.name)).toEqual(['konferenz-800-1700000000.wav'])
    expect(fs.existsSync(path.join(dir, 'notiz.txt'))).toBe(true)
  })

  it('löscht alte Voicemails mit allen Tondateien', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-'))
    const inbox = path.join(dir, '10', 'INBOX')
    for (const ext of ['txt', 'wav', 'WAV']) touch(path.join(inbox, `msg0000.${ext}`), 60)
    for (const ext of ['txt', 'wav']) touch(path.join(inbox, `msg0001.${ext}`), 1)
    expect(expireVoicemail(30, Date.now(), dir)).toBe(1)
    expect(fs.readdirSync(inbox).sort()).toEqual(['msg0001.txt', 'msg0001.wav'])
  })

  it('lässt nur einfache Dateinamen zu', () => {
    expect(recordingFile('../config.json')).toBeNull()
    expect(recordingFile('../../x.wav')).toBeNull()
    expect(recordingFile('a-b.wav')).not.toBeNull()
  })
})
