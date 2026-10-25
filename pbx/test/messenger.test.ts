import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generate } from '../server/generate'
import { MessengerHub, MessengerStore, messengerUsers } from '../server/messenger'
import type { AppProfile } from '../server/model'
import { profile } from '../server/provisioning'
import { decodeFrame, encodeFrame, upgrade } from '../server/websocket'
import { ext, gen, sampleConfig } from './helpers'

let dir = ''
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-chat-'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

/** Rahmen wie ein Browser ihn schickt (maskiert) */
function clientFrame(text: string, opcode = 1, fin = true): Buffer {
  const payload = Buffer.from(text)
  const mask = Buffer.from([1, 2, 3, 4])
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]))
  const len = payload.length
  const head = len < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | len]) : Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126, len >> 8, len & 255])
  return Buffer.concat([head, mask, masked])
}

describe('WebSocket-Rahmen', () => {
  it('liest maskierte Rahmen, auch wenn sie stückweise ankommen', () => {
    const f = clientFrame('hallo')
    expect(decodeFrame(f.subarray(0, 4))).toBeNull()
    const r = decodeFrame(Buffer.concat([f, clientFrame('x')]))!
    expect(r.frame.payload.toString()).toBe('hallo')
    expect(decodeFrame(r.rest)!.frame.payload.toString()).toBe('x')
  })

  it('liest längere Nachrichten', () => {
    const text = 'ä'.repeat(300)
    expect(decodeFrame(clientFrame(text))!.frame.payload.toString()).toBe(text)
  })

  it('lehnt unmaskierte Rahmen ab', () => {
    expect(() => decodeFrame(encodeFrame(1, Buffer.from('x')))).toThrow()
  })

  it('kodiert Längenfelder richtig', () => {
    expect(encodeFrame(1, Buffer.alloc(10))[1]).toBe(10)
    expect(encodeFrame(1, Buffer.alloc(200))[1]).toBe(126)
    expect(encodeFrame(1, Buffer.alloc(70000))[1]).toBe(127)
  })
})

describe('Messenger-Ablage', () => {
  it('legt Einzelchats nur einmal an und zählt Ungelesenes', () => {
    const s = new MessengerStore(dir)
    const r = s.direct('11', '10')
    expect(s.direct('10', '11')).toBe(r)
    s.post(r, '10', 'Hallo')
    s.post(r, '10', 'Bist du da?')
    expect(s.view(r, '11').unread).toBe(2)
    expect(s.view(r, '10').unread).toBe(0)
    s.markRead(r, '11', 1)
    expect(s.view(r, '11').unread).toBe(1)
    expect(() => s.direct('10', '10')).toThrow()
  })

  it('übersteht einen Neustart', () => {
    const s = new MessengerStore(dir)
    const g = s.createGroup('10', 'Familie', ['11', '12'])
    s.post(g, '11', 'Essen ist fertig')
    s.flush()
    const again = new MessengerStore(dir)
    expect(again.rooms.get(g.id)?.members).toEqual(['10', '11', '12'])
    expect(again.history(g.id).messages.map((m) => m.text)).toEqual(['Essen ist fertig'])
    expect(again.rooms.get(g.id)?.seq).toBe(1)
  })

  it('blättert im Verlauf rückwärts', () => {
    const s = new MessengerStore(dir)
    const r = s.direct('10', '11')
    for (let i = 1; i <= 120; i++) s.post(r, '10', `Nachricht ${i}`)
    const first = s.history(r.id)
    expect(first.messages).toHaveLength(50)
    expect(first.messages.at(-1)?.seq).toBe(120)
    expect(first.complete).toBe(false)
    const older = s.history(r.id, first.messages[0].seq, 100)
    expect(older.messages[0].seq).toBe(1)
    expect(older.messages.at(-1)?.seq).toBe(70)
    expect(older.complete).toBe(true)
  })

  it('löscht nur bei knappem Speicher, älteste Nachrichten samt Anhang zuerst', () => {
    const s = new MessengerStore(dir)
    const r = s.direct('10', '11')
    const file = s.saveFile(r.id, 'bild.png', 'image/png', Buffer.from('x'))
    const old = s.post(r, '10', '', file)
    old.time = 1000
    for (let i = 0; i < 19; i++) s.post(r, '11', `Neu ${i}`)
    expect(s.cleanup(() => 10_000_000, 1000)).toBe(0)
    expect(s.messages(r.id)).toHaveLength(20)

    let free = 0
    const removed = s.cleanup(() => (free += 600), 1000)
    expect(removed).toBeGreaterThan(0)
    expect(s.messages(r.id).some((m) => m.file)).toBe(false)
    expect(fs.existsSync(s.filePath(r.id, file.id))).toBe(false)
    // Nach dem Neustart sind die gelöschten Nachrichten weg
    expect(new MessengerStore(dir).messages(r.id)).toHaveLength(20 - removed)
  })

  it('nimmt nur Nebenstellen, deren App-Profil den Messenger zeigt', () => {
    const cfg = sampleConfig()
    cfg.appprofiles = [{ id: 'p1', name: 'Nur Telefon', pages: ['dial'], start_tab: 'dial' } as AppProfile]
    cfg.extensions[2].app_profile = 'p1'
    expect(messengerUsers(cfg).map((e) => e.number)).toEqual(['10', '11'])
    cfg.messenger.enabled = false
    expect(messengerUsers(cfg)).toEqual([])
  })
})

describe('Messenger über WebSocket', () => {
  it('verteilt Nachrichten an alle Geräte der Mitglieder', async () => {
    const cfg = sampleConfig()
    cfg.extensions = [ext('e10', '10', { provision_token: 't10' }), ext('e11', '11', { provision_token: 't11' })]
    const hub = new MessengerHub(new MessengerStore(dir), () => cfg)
    const server = http.createServer()
    server.on('upgrade', (req, socket) => {
      const token = /\/provision\/(\w+)\/chat/.exec(req.url ?? '')?.[1]
      const e = cfg.extensions.find((x) => x.provision_token === token)!
      hub.attach(e.number, token!, upgrade(req, socket)!)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port

    const open = async (token: string) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/provision/${token}/chat`)
      const inbox: Record<string, unknown>[] = []
      const waiters: [string, (m: Record<string, unknown>) => void][] = []
      ws.addEventListener('message', (e) => {
        const m = JSON.parse(String(e.data)) as Record<string, unknown>
        const i = waiters.findIndex(([t]) => t === m.t)
        if (i >= 0) waiters.splice(i, 1)[0][1](m)
        else inbox.push(m)
      })
      const next = (t: string): Promise<Record<string, unknown>> => {
        const i = inbox.findIndex((m) => m.t === t)
        if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0])
        return new Promise((resolve) => waiters.push([t, resolve]))
      }
      await new Promise((resolve) => ws.addEventListener('open', resolve))
      return { ws, next, send: (m: unknown) => ws.send(JSON.stringify(m)) }
    }

    const a = await open('t10')
    const b = await open('t11')
    expect((await a.next('init')).me).toBe('10')
    expect(((await b.next('init')).users as unknown[]).length).toBe(2)

    a.send({ t: 'direct', with: '11', ref: 'x' })
    const room = (await a.next('room')).room as { id: string }
    a.send({ t: 'send', room: room.id, text: 'Hallo 11', ref: 'm1' })
    const got = (await b.next('message')).message as { text: string; from: string; seq: number }
    expect(got).toMatchObject({ text: 'Hallo 11', from: '10' })
    expect((await a.next('message')).ref).toBe('m1')

    b.send({ t: 'read', room: room.id, seq: got.seq })
    expect(await a.next('read')).toMatchObject({ ext: '11', seq: 1 })

    b.send({ t: 'send', room: 'gibt-es-nicht', text: 'x', ref: 'e' })
    expect(await b.next('error')).toMatchObject({ ref: 'e' })

    // Ohne Berechtigung wird getrennt
    cfg.messenger.enabled = false
    const closed = new Promise((resolve) => b.ws.addEventListener('close', resolve))
    hub.refresh()
    await closed

    a.ws.close()
    hub.close()
    server.close()
  })
})

describe('Videoanrufe', () => {
  it('legt Video-Geräte, Wählplan und Konferenzprofil an', () => {
    const cfg = sampleConfig()
    cfg.remote.enabled = false
    cfg.extensions = [ext('e10', '10', { secret: 'geheim10' })]
    const files = generate(cfg, gen)
    expect(files['pjsip.conf']).toContain('[10-video](p4a-video)')
    expect(files['pjsip.conf']).toContain('max_video_streams=16')
    expect(files['pjsip.conf']).toMatch(/allow=.*vp8/)
    // SIP über WebSocket auch ohne Fernzugriff
    expect(files['pjsip.conf']).toContain('[transport-ws]')
    expect(files['http.conf']).toContain('enabled=yes')
    expect(files['extensions.conf']).toContain('[p4a-video]')
    expect(files['extensions.conf']).toContain('ConfBridge(p4a-chat-${EXTEN},p4a-video,p4a-video-user)')
    expect(files['confbridge.conf']).toContain('video_mode=sfu')

    cfg.messenger.video = false
    const off = generate(cfg, gen)
    expect(off['pjsip.conf']).not.toContain('-video]')
    expect(off['pjsip.conf']).not.toContain('[transport-ws]')
    expect(off['extensions.conf']).not.toContain('[p4a-video]')
  })

  it('gibt den Zugang nur Messenger-Nutzern ins Profil', () => {
    const cfg = sampleConfig()
    cfg.extensions = [ext('e10', '10')]
    const p = profile(cfg, cfg.extensions[0], 'http://192.168.1.5:8080')
    expect(p.video).toMatchObject({ websocket: 'ws://192.168.1.5:8080/ws', user: '10-video' })
    cfg.messenger.video = false
    expect(profile(cfg, cfg.extensions[0], 'http://192.168.1.5:8080').video).toBeNull()
  })

  it('verfolgt Teilnehmer über die Konferenz-Ereignisse und meldet das Ende im Chat', () => {
    const cfg = sampleConfig()
    cfg.extensions = [ext('e10', '10'), ext('e11', '11'), ext('e12', '12')]
    const hub = new MessengerHub(new MessengerStore(dir), () => cfg)
    const r = hub.store.direct('10', '11')
    expect(hub.mayJoin('10', r.id)).toBe(true)
    expect(hub.mayJoin('12', r.id)).toBe(false)
    expect(hub.mayJoin('10', 'g-gibtsnicht')).toBe(false)

    const conf = `p4a-chat-${r.id}`
    hub.onAmi({ Event: 'ConfbridgeJoin', Conference: conf, Channel: 'PJSIP/10-video-00000001', CallerIDNum: '10' })
    expect(hub.activeCalls).toBe(1)
    hub.onAmi({ Event: 'ConfbridgeJoin', Conference: conf, Channel: 'PJSIP/11-video-00000002', CallerIDNum: '11' })
    hub.onAmi({ Event: 'ConfbridgeLeave', Conference: conf, Channel: 'PJSIP/11-video-00000002' })
    hub.onAmi({ Event: 'ConfbridgeLeave', Conference: conf, Channel: 'PJSIP/10-video-00000001' })
    expect(hub.activeCalls).toBe(0)
    expect(hub.store.messages(r.id).at(-1)?.text).toMatch(/^Videoanruf, 0:0\d Min\.$/)

    // Allein geblieben: verpasst
    hub.onAmi({ Event: 'ConfbridgeJoin', Conference: conf, Channel: 'PJSIP/11-video-00000003', CallerIDNum: '11' })
    hub.onAmi({ Event: 'ConfbridgeLeave', Conference: conf, Channel: 'PJSIP/11-video-00000003' })
    expect(hub.store.messages(r.id).at(-1)?.text).toBe('Verpasster Videoanruf von Person 11')
    // Fremde Konferenzen interessieren nicht
    hub.onAmi({ Event: 'ConfbridgeJoin', Conference: 'p4a-700', Channel: 'PJSIP/10-00000004' })
    expect(hub.activeCalls).toBe(0)
    hub.close()
  })
})
