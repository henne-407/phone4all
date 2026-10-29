import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MessengerHub, MessengerStore } from '../pbx/server/messenger'
import { blankItem, withDefaults } from '../pbx/server/model'
import type { Extension } from '../pbx/server/model'
import { upgrade } from '../pbx/server/websocket'
import { isExecutable, safeFileName } from '../src/main/files'
import { Messenger, mimeOf } from '../src/main/messenger'
import type { ChatMessage } from '../src/shared/types'

const ext = (number: string): Extension => ({ ...(blankItem('extensions') as unknown as Extension), id: `e${number}`, number, name: `Person ${number}`, provision_token: `t${number}` })

/** Wartet, bis eine Bedingung erfüllt ist (Ereignisse kommen asynchron) */
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('Zeitüberschreitung')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('Messenger der App mit der Anlage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-app-chat-'))
  const cfg = withDefaults({})
  cfg.extensions = [ext('10'), ext('11')]
  const hub = new MessengerHub(new MessengerStore(dir), () => cfg)
  const server = http.createServer()
  let base = ''

  beforeAll(async () => {
    server.on('upgrade', (req, socket) => {
      const token = /\/provision\/(\w+)\/chat/.exec(req.url ?? '')?.[1]
      const e = cfg.extensions.find((x) => x.provision_token === token)
      const conn = e && upgrade(req, socket)
      if (conn) hub.attach(e.number, e.provision_token, conn)
      else socket.destroy()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/provision`
  })
  afterAll(() => {
    hub.close()
    server.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('verbindet sich, schreibt und zählt Ungelesenes', async () => {
    const a = new Messenger({ url: () => `${base}/t10`, enabled: () => true })
    const b = new Messenger({ url: () => `${base}/t11`, enabled: () => true })
    const received: ChatMessage[] = []
    b.on('message', (m: ChatMessage) => received.push(m))
    a.update()
    b.update()
    await until(() => a.state.status === 'online' && b.state.status === 'online')
    expect(a.state.me).toBe('10')
    expect(a.state.online.sort()).toEqual(['10', '11'])

    const room = await a.openDirect('11')
    const sent = await a.sendText(room.id, 'Hallo aus dem Test')
    expect(sent.seq).toBe(1)
    await until(() => received.length === 1)
    // Der neue Einzelchat erscheint bei 11 mit der ersten Nachricht
    await until(() => b.unread === 1)
    expect(b.state.rooms[0].last?.text).toBe('Hallo aus dem Test')
    const history = await b.loadHistory(room.id)
    expect(history.messages.map((m) => m.text)).toEqual(['Hallo aus dem Test'])
    b.markRead(room.id, 1)
    await until(() => (a.state.rooms[0]?.read['11'] ?? 0) === 1)
    await until(() => b.unread === 0)

    await expect(a.sendText('falsch', 'x')).rejects.toThrow('Unterhaltung nicht gefunden')

    const group = await a.createGroup('Team', ['11'])
    await until(() => b.state.rooms.some((r) => r.id === group.id))
    a.stop()
    b.stop()
    expect(a.state.status).toBe('off')
  })

  it('kennt Dateitypen', () => {
    expect(mimeOf('/x/Foto.JPG')).toBe('image/jpeg')
    expect(mimeOf('a.unbekannt')).toBe('application/octet-stream')
  })
})

describe('Anhänge in der Desktop-App', () => {
  it('öffnet keine Programme und Skripte direkt', () => {
    for (const n of ['rechnung.exe', 'Rechnung.PDF.exe', 'x.js', 'makro.docm', 'a.lnk', 'b.ps1 ', 'c.hta.', 'setup.msi', 'start.sh']) {
      expect(isExecutable(n), n).toBe(true)
    }
    for (const n of ['foto.jpg', 'brief.pdf', 'tabelle.xlsx', 'notiz.txt', 'exe.png']) expect(isExecutable(n), n).toBe(false)
  })

  it('macht Dateinamen ungefährlich', () => {
    expect(safeFileName('../../.bashrc')).toBe('bashrc')
    expect(safeFileName('..\\..\\Windows\\evil.dll')).toBe('evil.dll')
    expect(safeFileName('a:b*c?.txt')).toBe('a_b_c_.txt')
    expect(safeFileName('')).toBe('Datei')
  })
})
