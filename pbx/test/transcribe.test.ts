import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generate } from '../server/generate'
import { DEFAULT_CONFIG, type TranscriptionSettings } from '../server/model'
import { type Transcript, Transcriber, cleanText } from '../server/transcribe'
import { gen, sampleConfig } from './helpers'

const dirs: string[] = []
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'p4a-stt-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const settings = (patch: Partial<TranscriptionSettings> = {}): TranscriptionSettings => ({ ...DEFAULT_CONFIG.transcription, enabled: true, ...patch })

describe('Voicemail als Text', () => {
  it('räumt die Ausgabe von whisper auf', () => {
    expect(cleanText(' Hallo, hier ist Anna.\n [Musik]\n Bitte rufen Sie zurück. \n')).toBe('Hallo, hier ist Anna. Bitte rufen Sie zurück.')
    expect(cleanText('(Musik)')).toBe('')
  })

  it('wandelt lokal mit whisper-cli um und speichert das Ergebnis', async () => {
    const root = tmp()
    const bin = path.join(root, 'bin')
    fs.mkdirSync(bin)
    // Ersatz für whisper-cli: gibt die Argumente zurück, damit sie geprüft werden können
    fs.writeFileSync(path.join(bin, 'whisper-cli'), '#!/bin/sh\necho " Rückruf bitte."\necho "$@" >&2\nexit 0\n', { mode: 0o755 })
    fs.mkdirSync(path.join(root, 'models'))
    fs.writeFileSync(path.join(root, 'models', 'ggml-small-q5_1.bin'), 'x')
    const wav = path.join(root, 'msg.wav')
    fs.writeFileSync(wav, 'RIFF')
    const t = new Transcriber(path.join(root, 'models'), path.join(root, 'out'), bin)
    expect(t.status()).toMatchObject({ binary: true, models: ['small-q5_1'] })
    const done = await new Promise<Transcript>((resolve) => t.enqueue(() => settings(), '10', '1700000000-00000001', wav, resolve))
    expect(done).toMatchObject({ text: 'Rückruf bitte.', error: '' })
    expect(t.get('10', '1700000000-00000001')?.text).toBe('Rückruf bitte.')
    expect(t.count('10')).toBe(1)
    t.prune('10', new Set())
    expect(t.get('10', '1700000000-00000001')).toBeNull()
  })

  it('meldet einen Fehler, wenn das Modell fehlt (und lädt es nach)', async () => {
    const root = tmp()
    const t = new Transcriber(path.join(root, 'models'), path.join(root, 'out'), root)
    // Download nicht wirklich starten
    t.downloading = 'small-q5_1'
    const done = await new Promise<Transcript>((resolve) => t.enqueue(() => settings(), '10', 'a', path.join(root, 'x.wav'), resolve))
    expect(done.error).toMatch(/wird gerade geladen/)
    expect(t.get('10', 'a')?.error).toMatch(/geladen/)
  })

  it('nutzt eine OpenAI-kompatible Schnittstelle', async () => {
    const root = tmp()
    const wav = path.join(root, 'msg.wav')
    fs.writeFileSync(wav, 'RIFFdata')
    let seen = { auth: '', body: '', url: '' }
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', () => {
        seen = { auth: req.headers.authorization ?? '', body, url: req.url ?? '' }
        if (body.includes('name="model"\r\n\r\nkaputt')) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'Modell unbekannt' } }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ text: 'Bitte um Rückruf.' }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    try {
      const t = new Transcriber(root, root, root)
      expect(await t.transcribe(settings({ engine: 'api', api_url: url, api_key: 'sk-1', api_model: 'whisper-1' }), wav)).toBe('Bitte um Rückruf.')
      expect(seen.url).toBe('/v1/audio/transcriptions')
      expect(seen.auth).toBe('Bearer sk-1')
      expect(seen.body).toContain('name="language"\r\n\r\nde')
      expect(seen.body).toContain('RIFFdata')
      await expect(t.transcribe(settings({ engine: 'api', api_url: url, api_model: 'kaputt' }), wav)).rejects.toThrow(/HTTP 400 Modell unbekannt/)
    } finally {
      server.close()
    }
  })

  it('Asterisk verschickt keine Voicemail-E-Mail, wenn die Anlage sie mit Text schickt', () => {
    const cfg = sampleConfig()
    cfg.mail = { ...cfg.mail, host: 'smtp.example.de', from: 'pbx@example.de' }
    const ext = cfg.extensions.find((e) => e.voicemail.enabled)!
    ext.email = 'anna@example.de'
    expect(generate(cfg, gen)['voicemail.conf']).toContain('anna@example.de')
    cfg.transcription = settings({ email: true })
    expect(generate(cfg, gen)['voicemail.conf']).not.toContain('anna@example.de')
    cfg.transcription.email = false
    expect(generate(cfg, gen)['voicemail.conf']).toContain('anna@example.de')
  })
})
