import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentServer, FRAME_BYTES, FrameReader, KIND, Utterance, frame, readReply, systemPrompt, uuidOf } from '../server/aiagent'
import { Callbacks } from '../server/callbacks'
import { extensionsConf } from '../server/generate/dialplan'
import { generate } from '../server/generate'
import { type ChatTurn, parseJsonReply } from '../server/llm'
import { type AiAgent, type BossPair, type ContactSource, type Group, type Reminder, blankItem } from '../server/model'
import { metricsText, syslogLine } from '../server/monitoring'
import type { LineState } from '../server/presence'
import { dueReminders } from '../server/reminders'
import { EMPTY_STATE, type RuntimeState, bossView, extensionPlan, feature, spyPlan, toggleBoss } from '../server/routing'
import { fillTemplate, parseInbound, smsNumber } from '../server/sms'
import { cloudContacts, cloudEvents, googleAssertion } from '../server/sources/cloud'
import { validate } from '../server/store'
import { Summaries, recordingsOf } from '../server/summaries'
import { maskNumber, wallboardData } from '../server/wallboard'
import { ext, gen, sampleConfig } from './helpers'

const state = (): RuntimeState => structuredClone(EMPTY_STATE)
/** Beispielanlage mit gültigen SIP-Passwörtern (für validate) */
function validConfig(): ReturnType<typeof sampleConfig> {
  const cfg = sampleConfig()
  for (const e of cfg.extensions) e.secret = 'geheim12345'
  return cfg
}
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-w3-'))

function bossConfig(mode: BossPair['mode'] = 'secretary') {
  const cfg = validConfig()
  cfg.extensions.push(ext('e13', '13', { name: 'Chefin Meier', secret: 'geheim12345' }), ext('e14', '14', { name: 'Sekretariat', secret: 'geheim12345' }))
  cfg.bosses = [{ id: 'b1', name: '', boss: '13', secretary: '14', mode, vip: ['0171*', '+4930999'], internal_direct: false }]
  return cfg
}

describe('Chef und Sekretariat', () => {
  it('leitet nur bei eingeschaltetem Paar ins Sekretariat', () => {
    const cfg = bossConfig()
    const s = state()
    expect(extensionPlan(cfg, s, '13')).toMatch(/^ring\|/)
    expect(feature(cfg, s, '14', 'boss', '').reply).toBe('on')
    expect(extensionPlan(cfg, s, '13', new Date(), { from: '10', transfer: '' })).toBe('goto|p4a-boss^b1')
    expect(bossView(cfg, s, '13')).toEqual([{ id: 'b1', name: 'Chefin Meier / Sekretariat', role: 'boss', partner: '14', active: true }])
    expect(feature(cfg, s, '13', 'boss', '').reply).toBe('off')
    expect(extensionPlan(cfg, s, '13')).toMatch(/^ring\|/)
  })

  it('lässt Sekretariat, Weitergabe und VIP-Nummern durch', () => {
    const cfg = bossConfig()
    const s = state()
    toggleBoss(cfg, s, '13', 'b1', true)
    expect(extensionPlan(cfg, s, '13', new Date(), { from: '14', transfer: '' })).toMatch(/^ring\|/)
    // Vom Sekretariat weitergegeben (BLINDTRANSFER zeigt auf dessen Kanal, auch die App)
    expect(extensionPlan(cfg, s, '13', new Date(), { from: '0301234', transfer: 'PJSIP/14-app-0000001a' })).toMatch(/^ring\|/)
    expect(extensionPlan(cfg, s, '13', new Date(), { from: '0301234', transfer: 'PJSIP/15-0000001a' })).toBe('goto|p4a-boss^b1')
    expect(extensionPlan(cfg, s, '13', new Date(), { from: '01712345678', transfer: '' })).toMatch(/^ring\|/)
    expect(extensionPlan(cfg, s, '13', new Date(), { from: '030999', transfer: '' })).toMatch(/^ring\|/)
    expect(extensionPlan(cfg, s, '13', new Date(), { from: '10', transfer: '' })).toBe('goto|p4a-boss^b1')
    cfg.bosses[0].internal_direct = true
    expect(extensionPlan(cfg, s, '13', new Date(), { from: '10', transfer: '' })).toMatch(/^ring\|/)
  })

  it('lässt im Modus „beide“ das Sekretariat mitklingeln', () => {
    const cfg = bossConfig('both')
    const s = state()
    toggleBoss(cfg, s, '14', '', true)
    expect(extensionPlan(cfg, s, '13', new Date(), { from: '0301234', transfer: '' })).toBe('ring|25|0|p4a-vmb^13|p4a-vmu^13|0|14')
  })

  it('erzeugt den Wählplan mit Namenshinweis', () => {
    const conf = extensionsConf(bossConfig(), gen)
    expect(conf).toContain('[p4a-boss]')
    expect(conf).toContain('exten => b1,1,Set(CALLERID(name)=Für Chefin Meier: ${CALLERID(name)})')
    expect(conf).toContain('exten => *83,1,Gosub(p4a-feature,s,1(boss,))')
    expect(conf).toContain('Set(C=${C}&Local/${ALSO}@p4a-direct)')
    expect(conf).toContain('bt=${URIENCODE(${BLINDTRANSFER})}')
  })

  it('prüft die Paare', () => {
    const cfg = bossConfig()
    cfg.bosses[0].secretary = '13'
    expect(() => validate(cfg)).toThrow(/zwei verschiedene/)
    cfg.bosses[0].secretary = '14'
    cfg.bosses[0].vip = ['abc']
    expect(() => validate(cfg)).toThrow(/keine Rufnummer/)
  })
})

describe('Hinweisansage vor Aufnahmen', () => {
  it('kommt nur bei aufgezeichneten Nebenstellen mit', () => {
    const cfg = sampleConfig()
    expect(extensionPlan(cfg, state(), '10', new Date(), { from: '0301', transfer: '', notice: '/data/sounds/custom/hinweis' })).toBe('ring|25|0|p4a-vmb^10|p4a-vmu^10|0')
    cfg.extensions[0].record = true
    expect(extensionPlan(cfg, state(), '10', new Date(), { from: '0301', transfer: '', notice: '/data/sounds/custom/hinweis' })).toBe(
      'ring|25|1|p4a-vmb^10|p4a-vmu^10|0||/data/sounds/custom/hinweis',
    )
  })

  it('schaltet die Aufnahme mit der Zusammenfassung ein', () => {
    const cfg = validConfig()
    cfg.ai = { url: 'http://ollama:11434/v1', key: '', model: 'llama3', summaries: true, record_notice: '' }
    cfg.extensions[0].summary = true
    validate(cfg)
    expect(cfg.extensions[0].record).toBe(true)
    cfg.ai.model = ''
    expect(() => validate(cfg)).toThrow(/Modell/)
  })
})

describe('Mithören, Einflüstern, Aufschalten', () => {
  it('braucht Schalter und Recht', () => {
    const cfg = sampleConfig()
    expect(spyPlan(cfg, '10', '11', 'listen')).toBe('')
    cfg.spy.enabled = true
    expect(spyPlan(cfg, '10', '11', 'listen')).toBe('')
    cfg.groups[0].permissions = ['spy']
    expect(spyPlan(cfg, '10', '11', 'listen')).toBe('qESd')
    expect(spyPlan(cfg, '10', '11', 'whisper')).toBe('qESdw')
    expect(spyPlan(cfg, '10', '11', 'barge')).toBe('qESdB')
    expect(spyPlan(cfg, '10', '10', 'listen')).toBe('')
    expect(spyPlan(cfg, '10', '99', 'listen')).toBe('')
    const conf = extensionsConf(cfg, gen)
    expect(conf).toContain('exten => _*90X.,1,Set(ST=${EXTEN:3})')
    expect(conf).toContain('ChanSpy(PJSIP/${ST}-,${R})')
  })

  it('fehlt im Wählplan, wenn ausgeschaltet', () => {
    expect(extensionsConf(sampleConfig(), gen)).not.toContain('p4a-spy')
  })
})

describe('Klingelton je Herkunft', () => {
  it('setzt Alert-Info über einen Vorwahl-Handler', () => {
    const conf = extensionsConf(sampleConfig(), gen)
    expect(conf).toContain('[p4a-alert]')
    expect(conf).toContain('Set(PJSIP_HEADER(add,Alert-Info)=<http://phone4all/ring/${O}>\\;info=alert-${O})')
    expect(conf).toContain('n(dial),Dial(${C},${RT},${P4A_DIALOPTS}b(p4a-alert^s^1))')
    expect(conf).toContain('Set(__P4A_ORIGIN=external)')
    expect(conf).toContain('Set(__P4A_ORIGIN=group)')
  })

  it('lässt sich ausschalten', () => {
    const cfg = sampleConfig()
    cfg.ring.enabled = false
    const conf = extensionsConf(cfg, gen)
    expect(conf).not.toContain('p4a-alert')
    expect(conf).toContain('n(dial),Dial(${C},${RT},${P4A_DIALOPTS})')
  })
})

/** Rückrufe mit nachgebildeter Besetztanzeige und AMI */
function callbackRig() {
  const dir = tmp()
  const cfg = sampleConfig()
  cfg.groups.push({ ...(blankItem('groups') as unknown as Group), id: 'q1', number: '30', name: 'Hotline', members: ['11'], mode: 'queue', callback: true })
  const lines: Record<string, LineState> = { '10': 'idle', '11': 'busy', '12': 'idle' }
  const originated: Record<string, string>[] = []
  let answer = true
  let now = 1_000_000
  const cb = new Callbacks(path.join(dir, 'callbacks.json'), {
    config: () => cfg,
    lineState: (n) => lines[n] ?? 'offline',
    available: () => true,
    originate: async (f) => {
      originated.push(f)
      return answer
    },
    now: () => now,
  })
  return { cfg, cb, lines, originated, dir, setAnswer: (a: boolean) => (answer = a), advance: (ms: number) => (now += ms) }
}

describe('Rückruf bei besetzt (*37)', () => {
  it('ruft zurück, sobald beide frei sind', async () => {
    const { cb, lines, originated } = callbackRig()
    expect(cb.requestCcbs('10')).toBe('error') // noch nichts besetzt
    cb.busy('10', '11')
    expect(cb.requestCcbs('10')).toBe('on')
    await cb.tick()
    expect(originated).toEqual([])
    lines['11'] = 'idle'
    await cb.tick()
    await new Promise((r) => setTimeout(r, 0))
    expect(originated[0]).toMatchObject({ Action: 'Originate', Channel: 'Local/10@p4a-originate', Context: 'p4a-from-ext', Exten: '11' })
    expect(originated[0].Variable).toContain('_P4A_LABEL=Rückruf Person 11')
    expect(cb.all()).toEqual([])
  })

  it('versucht es dreimal und lässt sich zurücknehmen', async () => {
    const { cb, lines, originated, setAnswer, advance } = callbackRig()
    lines['11'] = 'idle'
    setAnswer(false)
    expect(cb.requestCcbs('10', '12')).toBe('on')
    expect(cb.forExtension('10')).toHaveLength(1)
    for (let i = 0; i < 4; i++) {
      await cb.tick()
      await new Promise((r) => setTimeout(r, 0))
      advance(3 * 60000)
    }
    expect(originated).toHaveLength(3)
    expect(cb.all()).toEqual([])
    expect(cb.requestCcbs('10', '12')).toBe('on')
    expect(cb.requestCcbs('10', '12')).toBe('off')
    expect(cb.requestCcbs('10', '10')).toBe('error')
    expect(cb.requestCcbs('10', '77')).toBe('error')
  })

  it('verfällt nach der eingestellten Zeit', () => {
    const { cb, cfg, advance } = callbackRig()
    cfg.callback.minutes = 5
    cb.requestCcbs('10', '11')
    advance(6 * 60000)
    expect(cb.all()).toEqual([])
  })
})

describe('Rückruf statt Warteschleife', () => {
  it('holt den Anrufer zurück in die Warteschlange, wenn jemand frei ist', async () => {
    const { cb, lines, originated } = callbackRig()
    expect(cb.requestQueue('q1', '0171 2345678', 'Frau Kunde')).toBe(true)
    expect(cb.requestQueue('g1', '0171 2345678', '')).toBe(false) // keine Warteschlange
    await cb.tick()
    expect(originated).toEqual([])
    lines['11'] = 'idle'
    await cb.tick()
    await new Promise((r) => setTimeout(r, 0))
    expect(originated[0]).toMatchObject({ Channel: 'Local/01712345678@p4a-fwd', Context: 'p4a-qcb-in', Exten: 's' })
    expect(originated[0].Variable).toBe('P4A_GID=q1,P4A_QNAME=Frau Kunde,P4A_QNUM=01712345678')
  })

  it('erzeugt Warteschlange und Wählplan', () => {
    const { cfg } = callbackRig()
    const files = generate(cfg, gen)
    expect(files['queues.conf']).toContain('context=p4a-qcb-q1')
    expect(files['queues.conf']).toContain('periodic-announce=/data/sounds/prompts/qcb-offer')
    expect(files['extensions.conf']).toContain('[p4a-qcb-q1]')
    expect(files['extensions.conf']).toContain('Queue(p4a-${P4A_GID},t,,,300,,,,,1)')
    expect(files['modules.conf']).toContain('load => chan_audiosocket.so')
  })
})

describe('Erinnerungsanrufe', () => {
  const rem = (extra: Partial<Reminder>): Reminder => ({ id: 'r1', extension: '10', enabled: true, time: '07:30', days: [1, 2, 3, 4, 5], date: '', text: '', ...extra })

  it('sind an Wochentagen und einmal am Datum fällig', () => {
    const cfg = sampleConfig()
    cfg.system.timezone = 'Europe/Berlin'
    cfg.reminders = [rem({}), rem({ id: 'r2', time: '07:31', days: [], date: '2026-11-02' }), rem({ id: 'r3', days: [6, 7] })]
    // Montag, 2. November 2026, 07:31 Ortszeit (06:31 UTC)
    const now = new Date('2026-11-02T06:31:20Z')
    const due = dueReminders(cfg, now, {})
    expect(due.map((d) => d.reminder.id)).toEqual(['r1', 'r2'])
    expect(dueReminders(cfg, now, { r1: '2026-11-02 07:30' }).map((d) => d.reminder.id)).toEqual(['r2'])
    // Nach mehr als fünf Minuten nicht mehr nachholen
    expect(dueReminders(cfg, new Date('2026-11-02T06:40:00Z'), {})).toEqual([])
  })

  it('werden geprüft', () => {
    const cfg = validConfig()
    cfg.reminders = [rem({ time: '7:30' })]
    expect(() => validate(cfg)).toThrow(/Uhrzeit/)
    cfg.reminders = [rem({ days: [], date: '' })]
    expect(() => validate(cfg)).toThrow(/Wochentage oder ein Datum/)
  })

  it('stehen im Wählplan', () => {
    const conf = extensionsConf(sampleConfig(), gen)
    expect(conf).toContain('exten => _*55XXXX,1,Gosub(p4a-feature,s,1(remind,${EXTEN:3}))')
    expect(conf).toContain('exten => *37,1,Gosub(p4a-feature,s,1(ccbs,))')
  })
})

describe('KI-Telefonassistent', () => {
  const agent = (): AiAgent => ({
    ...(blankItem('aiagents') as unknown as AiAgent),
    id: 'a1',
    name: 'Empfang',
    targets: [{ name: 'Vertrieb', number: '11' }],
  })

  it('liest AudioSocket-Rahmen auch in Teilstücken', () => {
    const r = new FrameReader()
    const data = Buffer.concat([frame(KIND.uuid, Buffer.alloc(16, 0xab)), frame(KIND.audio, Buffer.alloc(320, 1))])
    expect(r.push(data.subarray(0, 10))).toEqual([])
    const out = r.push(data.subarray(10))
    expect(out.map((f) => [f.kind, f.payload.length])).toEqual([
      [1, 16],
      [16, 320],
    ])
    expect(uuidOf(Buffer.from('00112233445566778899aabbccddeeff', 'hex'))).toBe('00112233-4455-6677-8899-aabbccddeeff')
  })

  it('erkennt das Ende des Gesagten an der Pause', () => {
    const u = new Utterance(500, 5, 100)
    const loud = Buffer.alloc(FRAME_BYTES)
    for (let i = 0; i < FRAME_BYTES / 2; i++) loud.writeInt16LE(i % 2 ? 4000 : -4000, i * 2)
    const quiet = Buffer.alloc(FRAME_BYTES)
    expect(u.push(quiet)).toBeNull()
    for (let i = 0; i < 4; i++) expect(u.push(loud)).toBeNull()
    expect(u.active).toBe(true)
    let said: Buffer | null = null
    for (let i = 0; i < 5 && !said; i++) said = u.push(quiet)
    expect(said!.length).toBeGreaterThan(4 * FRAME_BYTES)
  })

  it('verbindet nur mit erlaubten Zielen', () => {
    expect(readReply(agent(), '```json\n{"say":"Ich verbinde.","action":"transfer","target":"11"}\n```')).toEqual({ say: 'Ich verbinde.', action: 'transfer', target: '11', message: '' })
    expect(readReply(agent(), '{"say":"Moment","action":"transfer","target":"0900123"}').action).toBe('continue')
    expect(readReply(agent(), 'Gern geschehen.')).toMatchObject({ say: 'Gern geschehen.', action: 'continue' })
    expect(parseJsonReply('kein json')).toBeNull()
    expect(systemPrompt(agent(), '0301', { company: 'Muster GmbH', now: 'Montag' })).toContain('- Vertrieb: 11')
  })

  it('führt ein Gespräch über AudioSocket bis zur Weiterleitung', async () => {
    const tts = vi.fn(async () => Buffer.alloc(FRAME_BYTES * 2))
    const chat = vi.fn(async (_m: ChatTurn[]) => JSON.stringify({ say: 'Ich verbinde Sie.', action: 'transfer', target: '11' }))
    const server = new AgentServer({ stt: async () => 'Vertrieb bitte', chat, tts, note: () => {}, context: () => ({ company: 'Test', now: 'jetzt' }) })
    const port = 40000 + Math.floor(Math.random() * 10000)
    server.start(port)
    const call = server.open(agent(), '0301', 'Kunde')
    const sock = net.connect(port, '127.0.0.1')
    await new Promise((r) => sock.once('connect', r))
    const reader = new FrameReader()
    const kinds: number[] = []
    sock.on('data', (d: Buffer) => kinds.push(...reader.push(d).map((f) => f.kind)))
    sock.write(frame(KIND.uuid, Buffer.from(call.id.replace(/-/g, ''), 'hex')))
    // Begrüßung abwarten, dann sprechen und schweigen
    await new Promise((r) => setTimeout(r, 150))
    const loud = Buffer.alloc(FRAME_BYTES)
    for (let i = 0; i < FRAME_BYTES / 2; i++) loud.writeInt16LE(i % 2 ? 5000 : -5000, i * 2)
    for (let i = 0; i < 10; i++) sock.write(frame(KIND.audio, loud))
    for (let i = 0; i < 45; i++) sock.write(frame(KIND.audio, Buffer.alloc(FRAME_BYTES)))
    await new Promise((r) => call.once('end', r))
    await new Promise((r) => setTimeout(r, 50))
    expect(call.result).toEqual({ kind: 'transfer', number: '11' })
    expect(kinds).toContain(KIND.audio)
    expect(kinds.at(-1)).toBe(KIND.hangup)
    expect(chat.mock.calls[0]![0].at(-1)).toEqual({ role: 'user', content: 'Vertrieb bitte' })
    expect(server.get(call.id)).toBe(call)
    sock.destroy()
    server.close()
  })

  it('steht im Wählplan mit Ausweichziel', () => {
    const cfg = sampleConfig()
    cfg.aiagents = [{ ...agent(), number: '40' }]
    const conf = extensionsConf(cfg, gen)
    expect(conf).toContain('exten => 40,1,Goto(p4a-ai,a1,1)')
    expect(conf).toContain('Dial(AudioSocket/127.0.0.1:9093/${R},,g)')
    expect(conf).toContain('n(fallback),Goto(p4a-hangup,s,1)')
  })
})

describe('Zusammenfassungen', () => {
  let dir = ''
  afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }))

  it('findet die Aufnahmen und fasst zusammen', async () => {
    dir = tmp()
    fs.writeFileSync(path.join(dir, '1793.5-1793.6.wav'), '')
    fs.writeFileSync(path.join(dir, '1793.50-1.wav'), '')
    expect(recordingsOf(dir, '1793.5').map((f) => path.basename(f))).toEqual(['1793.5-1793.6.wav'])
    const delivered: unknown[] = []
    const chat = vi.fn(async (_m: ChatTurn[]) => 'Anliegen: Angebot\nErgebnis: kommt morgen')
    const s = new Summaries(path.join(dir, 'summaries'), {
      transcribe: async () => 'Guten Tag, ich hätte gern ein Angebot für zehn Telefone.',
      chat: () => chat,
      deliver: (x) => delivered.push(x),
      now: () => 1000,
    })
    s.enqueue({ id: '1793.5', extension: '10', direction: 'in', other: '0301', other_name: 'Kunde', duration: 120 }, recordingsOf(dir, '1793.5'))
    await vi.waitFor(() => expect(delivered).toHaveLength(1))
    expect(s.get('1793.5')).toMatchObject({ summary: 'Anliegen: Angebot\nErgebnis: kommt morgen', error: '', extension: '10' })
    expect(s.list('10')).toHaveLength(1)
    expect(s.list('11')).toHaveLength(0)
    expect(chat.mock.calls[0]![0][1].content).toContain('Kunde (0301)')
  })

  it('meldet zu kurze Gespräche', async () => {
    dir = tmp()
    const s = new Summaries(dir, { transcribe: async () => 'Hallo?', chat: () => async () => 'x', deliver: () => {} })
    expect((await s.run({ id: 'x', extension: '10', direction: 'in', other: '', other_name: '', duration: 3 }, ['a.wav'])).error).toMatch(/Zu wenig/)
  })
})

describe('SMS', () => {
  it('füllt Vorlagen JSON-sicher oder als Formular', () => {
    expect(fillTemplate('{"to":"{to}","msg":"{text}"}', { to: '+49171', text: 'Sag "Hallo"' })).toEqual({ body: '{"to":"+49171","msg":"Sag \\"Hallo\\""}', type: 'application/json' })
    expect(fillTemplate('to={to}&text={text}', { to: '+49171', text: 'a&b' })).toEqual({ body: 'to=%2B49171&text=a%26b', type: 'application/x-www-form-urlencoded' })
  })

  it('liest eingehende SMS verschiedener Anbieter', () => {
    expect(parseInbound({ from: '+49 171 234', text: 'Hi' })).toEqual({ from: '+49171234', text: 'Hi' })
    expect(parseInbound({ msisdn: 49171, message: 'Hi' })).toEqual({ from: '49171', text: 'Hi' })
    expect(parseInbound({ text: 'ohne Absender' })).toBeNull()
  })

  it('braucht eine gültige Handynummer', () => {
    expect(smsNumber('0171 2345678', '49')).toBe('+491712345678')
    expect(() => smsNumber('12', '49')).toThrow(/gültige/)
  })

  it('prüft die Einstellungen', () => {
    const cfg = validConfig()
    cfg.sms = { ...cfg.sms, enabled: true, provider: 'sipgate', user: 'token-1', password: 'x', sender: 'abc' }
    expect(() => validate(cfg)).toThrow(/SMS-ID/)
    cfg.sms.sender = 's0'
    validate(cfg)
  })
})

describe('Prometheus und Syslog', () => {
  it('liefert Messwerte im Textformat', () => {
    const cfg = sampleConfig()
    const text = metricsText({
      cfg,
      version: '1.0',
      asterisk: 'running',
      amiConnected: true,
      registered: ['10'],
      trunks: [{ trunk: 't1', status: 'Registered' }],
      activeCalls: 2,
      today: { inbound: 5, answered: 4, missed: 1, voicemail: 0, outbound: 3, internal: 1 },
      waiting: {},
      callbacks: 1,
      banned: 0,
      freeBytes: 1024,
      uptime: 61.4,
    })
    expect(text).toContain('phone4all_asterisk_up 1')
    expect(text).toContain('phone4all_extension_registered{extension="10",name="Person 10"} 1')
    expect(text).toContain('phone4all_trunk_registered{trunk="Telekom"} 1')
    expect(text).toContain('phone4all_calls_today{kind="missed"} 1')
    expect(text).toContain('# TYPE phone4all_active_calls gauge')
  })

  it('schreibt Zeilen nach RFC 5424', () => {
    expect(syslogLine('warning', 'watchdog', 'SIP-Konto\nabgemeldet', new Date('2026-10-30T10:00:00Z'), 'pbx')).toBe(
      '<132>1 2026-10-30T10:00:00.000Z pbx phone4all - watchdog - SIP-Konto abgemeldet',
    )
  })

  it('vergibt Schlüssel beim Einschalten', () => {
    const cfg = validConfig()
    cfg.monitoring.syslog = true
    expect(() => validate(cfg)).toThrow(/Syslog/)
  })
})

describe('Wallboard', () => {
  it('zeigt Wartende, Mitglieder und Tageswerte', () => {
    const cfg = sampleConfig()
    cfg.groups[0].mode = 'queue'
    const data = wallboardData(
      cfg,
      [
        { Event: 'QueueEntry', Queue: 'p4a-g1', Position: '2', CallerIDNum: '01712345678', CallerIDName: '<unknown>', Wait: '40' },
        { Event: 'QueueEntry', Queue: 'p4a-g1', Position: '1', CallerIDNum: '0301111111', CallerIDName: '', Wait: '75' },
      ],
      {
        lineState: (n) => (n === '10' ? 'busy' : 'idle'),
        available: (n) => n !== '11',
        callbacks: () => 2,
        today: [{ id: 'g1', calls: 9, answered: 8, abandoned: 1, avg_wait: 12, max_wait: 80 }],
        knownName: (n) => (n === '0301111111' ? 'Max Kunde' : ''),
        now: 5,
      },
    )
    expect(data.queues[0].waiting).toEqual([
      { position: 1, caller: 'Max Kunde', wait: 75 },
      { position: 2, caller: '0171 ••• 78', wait: 40 },
    ])
    expect(data.queues[0].members.map((m) => m.state)).toEqual(['busy', 'away'])
    expect(data.queues[0].today.calls).toBe(9)
    expect(maskNumber('110')).toBe('110')
  })
})

describe('Microsoft 365 und Google', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('liest Kontakte und Termine aus Microsoft Graph', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        urls.push(url)
        if (url.includes('login.microsoftonline.com')) {
          expect(String(init?.body)).toContain('grant_type=client_credentials')
          return Response.json({ access_token: 'tok', expires_in: 3600 })
        }
        if (url.includes('/contacts')) {
          return Response.json({
            value: [
              { displayName: 'Erika Muster', companyName: 'Muster AG', businessPhones: ['030 123'], mobilePhone: '0171 999', homePhones: [] },
              { displayName: 'Ohne Nummer', businessPhones: [] },
            ],
          })
        }
        return Response.json({
          value: [
            { iCalUId: 'u1', subject: 'Termin', isAllDay: false, start: { dateTime: '2026-11-02T08:00:00.0000000' }, end: { dateTime: '2026-11-02T09:00:00.0000000' }, type: 'singleInstance' },
            { iCalUId: 'u2', subject: 'Urlaub', isAllDay: true, start: { dateTime: '2026-11-03T00:00:00.0000000' }, end: { dateTime: '2026-11-04T00:00:00.0000000' }, type: 'occurrence' },
          ],
        })
      }),
    )
    const acc = { type: 'm365' as const, user: 'empfang@muster.de', password: 'geheim', tenant: 'muster.onmicrosoft.com', client_id: '11111111-2222-3333-4444-555555555555' }
    expect(await cloudContacts(acc)).toEqual([{ name: 'Erika Muster', company: 'Muster AG', phone: '030 123', mobile: '0171 999', other: [] }])
    const events = await cloudEvents(acc, Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 30))
    expect(events[0]).toMatchObject({ uid: 'u1', summary: 'Termin', start: Date.UTC(2026, 10, 2, 8), allDay: false })
    expect(events[1]).toMatchObject({ allDay: true, recurring: true })
    expect(urls.filter((u) => u.includes('login')).length).toBe(1) // Zugang wird wiederverwendet
  })

  it('signiert das JWT für Google-Dienstkonten', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const jwt = googleAssertion({ client_email: 'sa@p.iam.gserviceaccount.com', private_key: pem }, 'scope-x', 'chef@muster.de', 1_700_000_000_000)
    const [h, c, sig] = jwt.split('.')
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toMatchObject({ iss: 'sa@p.iam.gserviceaccount.com', sub: 'chef@muster.de', scope: 'scope-x', iat: 1_700_000_000 })
    expect(crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(true)
  })

  it('prüft die Zugangsdaten', () => {
    const cfg = validConfig()
    cfg.contactsources = [{ ...(blankItem('contactsources') as unknown as ContactSource), id: 'c1', name: 'Firma', type: 'm365', user: 'empfang@muster.de', tenant: 'x', client_id: 'kein-guid' }]
    expect(() => validate(cfg)).toThrow(/Anwendungs-ID/)
    cfg.contactsources[0].client_id = '11111111-2222-3333-4444-555555555555'
    validate(cfg)
    cfg.contactsources[0] = { ...cfg.contactsources[0], type: 'google', password: '{"x":1}' }
    expect(() => validate(cfg)).toThrow(/JSON-Schlüsseldatei/)
  })
})
