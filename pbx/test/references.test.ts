import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MessengerStore } from '../server/messenger'
import { usages } from '../server/references'
import { sampleConfig, to } from './helpers'

process.env.PBX_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-ref-'))
const { ConfigStore } = await import('../server/store')

describe('Verweise auf Einträge', () => {
  it('findet Ziele, Gruppen und Weiterleitungen einer Nebenstelle', () => {
    const cfg = sampleConfig()
    cfg.inbound = [{ id: 'i1', name: 'Hauptnummer', number: '', trunk: '', caller: '', name_prefix: '', destination: to('extension', 'e10') }]
    cfg.extensions[1].forward.busy = '10'
    const found = usages(cfg, 'extensions', 'e10')
    expect(found).toContain('Eingehende Regel „Hauptnummer“')
    expect(found).toContain('Mitglied der Gruppe „Zentrale“')
    expect(found).toContain('Weiterleitung von Nebenstelle 11 (Person 11)')
    // Die Gruppe verweist mit ihrem Ausweichziel auf die Voicemail von 10
    expect(found).toContain('Gruppe „Zentrale“ (Ausweichziel)')
    expect(usages(cfg, 'extensions', 'e12')).toEqual([])
  })
})

describe('Nebenstelle umnummerieren und löschen', () => {
  it('zieht Gruppen, Weiterleitungen und Zustand zur neuen Nummer mit', () => {
    const store = new ConfigStore()
    const moved: string[] = []
    store.hooks = { renumbered: (a, b) => moved.push(`${a}>${b}`), removed: (n) => moved.push(`-${n}`) }
    const a = store.upsert('extensions', { number: '10', name: 'Anna' })
    const b = store.upsert('extensions', { number: '11', name: 'Bert', forward: { busy: '10', noanswer: '', rules: [] } })
    store.upsert('groups', { number: '50', name: 'Team', members: ['10', '11'] })
    store.upsert('dect', { name: 'Basis', handsets: ['10'] })
    store.state.dnd['10'] = true
    store.state.cfu['11'] = '10'
    store.upsert('extensions', { id: a.id, number: '20' })
    expect(store.config.groups[0].members).toEqual(['20', '11'])
    expect(store.config.dect[0].handsets).toEqual(['20'])
    expect(store.config.extensions.find((e) => e.id === b.id)?.forward.busy).toBe('20')
    expect(store.state.dnd).toEqual({ '20': true })
    expect(store.state.cfu['11']).toBe('20')
    expect(moved).toEqual(['10>20'])

    store.remove('extensions', String(a.id))
    expect(store.config.groups[0].members).toEqual(['11'])
    expect(store.config.extensions[0].forward.busy).toBe('')
    expect(store.state.cfu['11']).toBeUndefined()
    expect(moved).toEqual(['10>20', '-20'])
  })

  it('nimmt Chats mit und gibt alte Chats nicht an eine neue Nebenstelle gleicher Nummer', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-'))
    const s = new MessengerStore(dir)
    const r = s.direct('10', '11')
    s.post(r, '10', 'Hallo')
    s.renumber('10', '20')
    expect(s.direct('20', '11').id).toBe(r.id)
    s.forget('20')
    // Neue Nebenstelle 20: eigener, leerer Chat
    const fresh = s.direct('20', '11')
    expect(fresh.id).not.toBe(r.id)
    expect(s.messages(fresh.id)).toHaveLength(0)
    expect(s.roomsFor('11')).toHaveLength(2)
  })
})
