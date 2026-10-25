import { createHmac } from 'node:crypto'
import type http from 'node:http'
import { describe, expect, it } from 'vitest'
import { generate } from '../server/generate'
import { clientIp } from '../server/http'
import { profile } from '../server/provisioning'
import { turnConf, turnCredentials } from '../server/remote'
import { remotePort } from '../server/security'
import { gen, sampleConfig } from './helpers'

function fakeReq(remote: string, xff?: string): http.IncomingMessage {
  return { socket: { remoteAddress: remote }, headers: xff ? { 'x-forwarded-for': xff } : {} } as unknown as http.IncomingMessage
}

describe('Zugriff von unterwegs', () => {
  it('erzeugt WebSocket-Transport und ein WebRTC-Gerät je Nebenstelle', () => {
    const files = generate(sampleConfig(), gen)
    const pjsip = files['pjsip.conf']
    expect(pjsip).toMatch(/protocol=ws\nbind=0\.0\.0\.0/)
    expect(pjsip).toContain('[10-app](p4a-app)')
    expect(pjsip).toContain('username=10-app')
    expect(pjsip).toMatch(/\[p4a-app\]\(!\)[^[]*webrtc=yes/)
    expect(files['http.conf']).toContain('bindaddr=127.0.0.1')
    expect(files['http.conf']).toContain('bindport=8088')
    expect(files['rtp.conf']).toContain('icesupport=yes')
    expect(files['modules.conf']).toContain('res_pjsip_transport_websocket.so')
    const ext = files['extensions.conf']
    expect(ext).toContain('exten => 10,hint,PJSIP/10&PJSIP/10-app')
    expect(ext).toContain('Gosub(p4a-contacts,s,1(${P4A_TARGET}))')
    expect(ext).toContain('Set(A=${PJSIP_DIAL_CONTACTS(${ARG1}-app)})')
  })

  it('lässt alles weg, wenn der Zugriff von unterwegs aus ist', () => {
    const cfg = sampleConfig()
    cfg.remote.enabled = false
    const files = generate(cfg, gen)
    expect(files['pjsip.conf']).not.toContain('-app')
    expect(files['http.conf']).toContain('enabled=no')
    expect(files['rtp.conf']).toContain('icesupport=no')
    expect(files['extensions.conf']).not.toContain('p4a-contacts')
  })

  it('liefert der App WebSocket-Adresse und TURN-Server über die öffentliche Adresse', () => {
    const cfg = sampleConfig()
    cfg.remote.public_url = 'https://telefon.example.de/'
    const ice = [{ urls: ['turn:telefon.example.de:3478?transport=tcp'], username: 'u', credential: 'c' }]
    const p = profile(cfg, cfg.extensions[0], 'http://192.168.1.5:8080', ice)
    expect(p.url).toMatch(/^https:\/\/telefon\.example\.de\/provision\//)
    expect(p.remote).toEqual({ websocket: 'wss://telefon.example.de/ws', user: '10-app', domain: 'telefon.example.de', ice_servers: ice })
    // Telefone im LAN melden sich weiter direkt an
    expect(p.account.domain).toBe('192.168.1.5')
    cfg.remote.enabled = false
    expect(profile(cfg, cfg.extensions[0], 'http://192.168.1.5:8080').remote).toBeNull()
  })

  it('erzeugt TURN-Zugangsdaten nach dem REST-Verfahren', () => {
    const c = turnCredentials('geheim', '10-app', 1_800_000_000_000)
    expect(c.username).toBe('1800000000:10-app')
    expect(c.credential).toBe(createHmac('sha1', 'geheim').update(c.username).digest('base64'))
    const conf = turnConf(sampleConfig(), 'geheim', ['192.168.1.5'], 'asterisk')
    expect(conf).toContain('listening-port=3478')
    expect(conf).toContain('denied-peer-ip=0.0.0.0-255.255.255.255')
    expect(conf).toContain('allowed-peer-ip=192.168.1.5')
    expect(conf).toContain('static-auth-secret=geheim')
  })

  it('nimmt die Adresse hinter dem Proxy aus dem letzten X-Forwarded-For-Eintrag', () => {
    expect(clientIp(fakeReq('203.0.113.9'))).toBe('203.0.113.9')
    // Von außen gesetzte Kopfzeilen zählen nicht
    expect(clientIp(fakeReq('203.0.113.9', '10.0.0.1'))).toBe('203.0.113.9')
    expect(clientIp(fakeReq('172.18.0.3', '1.2.3.4, 198.51.100.7'))).toBe('198.51.100.7')
    expect(clientIp(fakeReq('::ffff:127.0.0.1', 'kaputt'))).toBe('127.0.0.1')
    expect(remotePort('IPV4/WS/127.0.0.1/41234')).toBe(41234)
  })
})
