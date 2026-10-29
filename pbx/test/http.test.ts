import { describe, expect, it } from 'vitest'
import { HttpError, Router } from '../server/http'

describe('Router', () => {
  it('entschlüsselt Pfadteile und weist kaputte %-Folgen mit 400 ab', () => {
    const r = new Router()
    r.get('/api/backups/:name', () => null)
    expect(r.match('GET', '/api/backups/a%20b.json')?.params).toEqual({ name: 'a b.json' })
    expect(() => r.match('GET', '/api/backups/%E0%A4%A')).toThrow(HttpError)
    expect(r.match('POST', '/api/backups/x')).toBeNull()
  })
})
