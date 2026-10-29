import { createHmac } from 'node:crypto'
import type http from 'node:http'
import { describe, expect, it } from 'vitest'
import { generate } from '../server/generate'
import { DEFAULT_TRUSTED_PROXIES, clientIp, proxyHints, setTrustedProxies } from '../server/http'
import { profile } from '../server/provisioning'
import { localAddresses, turnConf, turnCredentials, turnPeers } from '../server/remote'
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

  it('lässt alles weg, wenn der Zugriff von unterwegs und Videoanrufe aus sind', () => {
    const cfg = sampleConfig()
    cfg.remote.enabled = false
    cfg.messenger.video = false
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
    const p = profile(cfg, cfg.extensions[0], 'http://192.168.1.5:8080', ice, 'Geraet123')
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
    expect(conf).toContain('no-tcp-relay')
  })

  it('lässt das TURN-Relais nur zur Anlage weiterleiten, nicht in Docker-Netze', () => {
    const v4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal }) as never
    const ifaces = { lo: [v4('127.0.0.1', true)], eth0: [v4('192.168.1.5')], docker0: [v4('172.17.0.1')], 'br-1a2b': [v4('172.18.0.1')], tailscale0: [v4('100.64.1.2')] }
    expect(localAddresses(ifaces)).toEqual(['192.168.1.5'])
    const cfg = sampleConfig()
    expect(turnPeers(cfg, ['192.168.1.5', '10.0.0.2'])).toEqual(['192.168.1.5', '10.0.0.2'])
    cfg.system.sip_host = '10.0.0.2'
    expect(turnPeers(cfg, ['192.168.1.5', '10.0.0.2'])).toEqual(['10.0.0.2'])
    // Fremde Adresse als SIP-Adresse: nicht als Ziel übernehmen
    cfg.system.sip_host = '8.8.8.8'
    expect(turnPeers(cfg, ['192.168.1.5'])).toEqual(['192.168.1.5'])
  })

  it('lässt App- und Videogeräte nur über den eigenen WebSocket-Proxy zu', () => {
    const cfg = sampleConfig()
    cfg.security.extension_nets = ['192.168.0.0/16']
    const pjsip = generate(cfg, gen)['pjsip.conf']
    const app = /\[10-app\]\(p4a-app\)\n([^[]*)/.exec(pjsip)![1]
    expect(app).toContain('deny=0.0.0.0/0.0.0.0')
    expect(app).toContain('permit=127.0.0.1/255.255.255.255')
    const video = /\[10-video\]\(p4a-video\)\n([^[]*)/.exec(pjsip)![1]
    expect(video).toContain('permit=127.0.0.1/255.255.255.255')
    expect(pjsip).toContain('endpoint_identifier_order=ip,username\n')
    expect(generate(cfg, gen)['modules.conf']).not.toContain('anonymous')
  })

  it('nimmt die Adresse hinter dem Proxy aus dem letzten X-Forwarded-For-Eintrag', () => {
    expect(clientIp(fakeReq('203.0.113.9'))).toBe('203.0.113.9')
    // Von außen gesetzte Kopfzeilen zählen nicht
    expect(clientIp(fakeReq('203.0.113.9', '10.0.0.1'))).toBe('203.0.113.9')
    expect(clientIp(fakeReq('172.18.0.3', '1.2.3.4, 198.51.100.7'))).toBe('198.51.100.7')
    expect(clientIp(fakeReq('::ffff:127.0.0.1', 'kaputt'))).toBe('127.0.0.1')
    // Geräte im LAN sind keine Proxys: Sie können sich nicht als 127.0.0.1 ausgeben
    expect(clientIp(fakeReq('192.168.1.20', '127.0.0.1'))).toBe('192.168.1.20')
    expect(proxyHints.has('192.168.1.20')).toBe(true)
    setTrustedProxies(() => ['192.168.1.20'])
    expect(clientIp(fakeReq('192.168.1.20', '198.51.100.7'))).toBe('198.51.100.7')
    expect(clientIp(fakeReq('172.18.0.3', '198.51.100.7'))).toBe('172.18.0.3')
    setTrustedProxies(() => DEFAULT_TRUSTED_PROXIES)
    expect(remotePort('IPV4/WS/127.0.0.1/41234')).toBe(41234)
  })
})
