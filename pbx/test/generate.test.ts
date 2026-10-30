import { describe, expect, it } from 'vitest'
import { generate } from '../server/generate'
import { gen, sampleConfig } from './helpers'

describe('Asterisk-Konfiguration', () => {
  const files = generate(sampleConfig(), gen)

  it('erzeugt Nebenstellen und Konten für PJSIP', () => {
    const pjsip = files['pjsip.conf']
    expect(pjsip).toContain('[10](p4a-ext)')
    expect(pjsip).toMatch(/\[trunk-t1\]\(p4a-trunk\)/)
    expect(pjsip).toContain('server_uri=sip:tel.t-online.de')
    expect(pjsip).toContain('password=geheim')
    expect(pjsip).toContain('deny=203.0.113.7')
    expect(pjsip).not.toContain('protocol=tls')
  })

  it('lässt Teilnehmer ohne PIN in Konferenzen mit Moderations-PIN', () => {
    const cfg = sampleConfig()
    cfg.conferences = [{ id: 'c1', number: '800', name: 'Runde', pin: '', admin_pin: '4711', max_members: 0, record: false } as never]
    const conf = generate(cfg, gen)['extensions.conf'].split('[p4a-conf]')[1].split('\n[')[0]
    expect(conf).toContain('"${PIN}" = "4711"]?admin')
    expect(conf).toContain('Goto(join)')
    cfg.conferences[0].pin = '1234'
    const strict = generate(cfg, gen)['extensions.conf'].split('[p4a-conf]')[1].split('\n[')[0]
    expect(strict).toContain('"${PIN}" = "1234"]?join')
    expect(strict).not.toContain('Goto(join)')
  })

  it('leitet eingehende Anrufe ohne Antwort des Verwaltungsdienstes zum Standardziel', () => {
    const ext = files['extensions.conf']
    expect(ext).toContain('n(fail),Goto(p4a-trunk-fallback,${P4A_TRUNK},1)')
    const fallback = ext.split('[p4a-trunk-fallback]')[1].split('\n[')[0]
    expect(fallback).toMatch(/exten => t1,1,NoOp/)
    expect(fallback).toContain('exten => i,1,Hangup(34)')
  })

  it('erzeugt Wählplan, Hinweise und Gruppen', () => {
    const ext = files['extensions.conf']
    expect(ext).toContain('[p4a-local]')
    expect(ext).toMatch(/exten => 10,hint,PJSIP\/10/)
    expect(ext).toContain('http://127.0.0.1:8080/internal')
    expect(files['voicemail.conf']).toContain('10 =>')
  })

  it('lädt keine veralteten Module', () => {
    expect(files['modules.conf']).toContain('autoload=no')
    expect(files['modules.conf']).not.toContain('chan_sip.so')
    expect(files['manager.conf']).toMatch(/bindaddr ?= ?127.0.0.1/)
  })
})

describe('Geladene Module', () => {
  // Anwendung im Wählplan → Modul (leer = im Kern von Asterisk)
  const APP_MODULE: Record<string, string> = {
    Answer: '', BackGround: '', Background: '', Busy: '', Congestion: '', ExecIf: '', Goto: '', GotoIf: '', Hangup: '', NoOp: '',
    Set: '', Wait: '', WaitExten: '', Ringing: '', Progress: '', ImportVar: '', Return: 'app_stack', Gosub: 'app_stack',
    Dial: 'app_dial', Playback: 'app_playback', VoiceMail: 'app_voicemail', VoiceMailMain: 'app_voicemail', Queue: 'app_queue',
    ConfBridge: 'app_confbridge', Pickup: 'app_directed_pickup', Echo: 'app_echo', MixMonitor: 'app_mixmonitor', Read: 'app_read',
    Exec: 'app_exec', Verbose: 'app_verbose', SendDTMF: 'app_senddtmf', PlayTones: 'app_playtones', Transfer: 'app_transfer',
    BlindTransfer: 'app_blind_transfer', SayUnixTime: 'app_sayunixtime', SoftHangup: 'app_softhangup', ChanSpy: 'app_chanspy',
    UserEvent: 'app_userevent', Page: 'app_page', AudioSocket: 'res_audiosocket', Park: 'res_parking', ParkedCall: 'res_parking',
    ReceiveFAX: 'res_fax', SendFAX: 'res_fax', SayDigits: '', SayNumber: '',
  }

  it('lädt für jede Anwendung im Wählplan das passende Modul', () => {
    const files = generate(sampleConfig(), gen)
    const loaded = new Set([...files['modules.conf'].matchAll(/load => (\w+)\.so/g)].map((m) => m[1]))
    const used = new Set([...files['extensions.conf'].matchAll(/(?:=>|\)|,)\s*(?:\([\w-]+\))?([A-Z][A-Za-z]+)\(/g)].map((m) => m[1]))
    expect(used).toContain('UserEvent')
    for (const app of used) {
      expect(APP_MODULE, `Anwendung ${app} fehlt in der Liste dieses Tests`).toHaveProperty(app)
      if (APP_MODULE[app]) expect(loaded, `${app} braucht ${APP_MODULE[app]}`).toContain(APP_MODULE[app])
    }
  })
})
