import { describe, expect, it } from 'vitest'
import { closedReason, holidays } from '../server/holidays'
import type { TimeCondition } from '../server/model'
import { to } from './helpers'

const office: TimeCondition = {
  id: 'tc',
  name: 'Bürozeiten',
  rules: [{ days: [1, 2, 3, 4, 5], from: '08:00', to: '17:00' }],
  holidays: true,
  closed_dates: ['2026-12-24..2026-12-31'],
  override: 'auto',
  open: to('hangup'),
  closed: to('hangup'),
}

describe('Feiertage', () => {
  it('berechnet bewegliche Feiertage', () => {
    const h = holidays(2026, 'BY')
    expect(h.get('2026-04-05')).toBeUndefined() // Ostersonntag ist kein gesetzlicher Feiertag
    expect(h.has('2026-04-03')).toBe(true) // Karfreitag
    expect(h.has('2026-04-06')).toBe(true) // Ostermontag
    expect(h.has('2026-06-04')).toBe(true) // Fronleichnam in Bayern
    expect(holidays(2026, 'HH').has('2026-06-04')).toBe(false)
    expect(holidays(2026, 'HH').has('2026-10-31')).toBe(true) // Reformationstag
  })

  it('prüft Öffnungszeiten in deutscher Zeit', () => {
    expect(closedReason(office, new Date('2026-10-20T08:30:00+02:00'), 'BE', 'Europe/Berlin')).toBeNull()
    expect(closedReason(office, new Date('2026-10-20T17:30:00+02:00'), 'BE', 'Europe/Berlin')).toBe('Außerhalb der Öffnungszeiten')
    expect(closedReason(office, new Date('2026-10-24T10:00:00+02:00'), 'BE', 'Europe/Berlin')).not.toBeNull() // Samstag
    expect(closedReason(office, new Date('2026-10-03T10:00:00+02:00'), 'BE', 'Europe/Berlin')).toBe('Tag der Deutschen Einheit')
    expect(closedReason(office, new Date('2026-12-28T10:00:00+01:00'), 'BE', 'Europe/Berlin')).toBe('Geschlossener Tag')
  })

  it('beachtet die manuelle Umschaltung', () => {
    const night = new Date('2026-10-20T23:00:00+02:00')
    expect(closedReason({ ...office, override: 'open' }, night, 'BE', 'Europe/Berlin')).toBeNull()
    expect(closedReason({ ...office, override: 'closed' }, new Date('2026-10-20T10:00:00+02:00'), 'BE', 'Europe/Berlin')).toBe('Manuell geschlossen')
  })
})
