import { describe, expect, it } from 'vitest'
import { dayLabel, groupByDay, timeLabel } from '../src/dates'
import type { CalendarEvent } from '../src/provisioning'

const ev = (uid: string, start: string, end: string, allDay = false): CalendarEvent => ({ uid, calendar: 'k', summary: uid, start, end, allDay })

describe('Termine', () => {
  const today = new Date(2026, 11, 22, 10, 0)

  it('ordnet Termine nach Tagen, mehrtägige an jedem Tag', () => {
    const list = [
      ev('Feiertage', '2026-12-24', '2026-12-27', true),
      ev('Besprechung', new Date(2026, 11, 22, 14, 0).toISOString(), new Date(2026, 11, 22, 15, 0).toISOString()),
      ev('Frühstück', new Date(2026, 11, 22, 8, 0).toISOString(), new Date(2026, 11, 22, 9, 0).toISOString()),
    ]
    const groups = groupByDay(list, today, 7, today)
    expect(groups.map((g) => g.date)).toEqual(['2026-12-22', '2026-12-24', '2026-12-25', '2026-12-26'])
    expect(groups[0].events.map((e) => e.uid)).toEqual(['Frühstück', 'Besprechung'])
    expect(groups[0].label).toMatch(/^Heute/)
  })

  it('beschriftet Tage und Zeiten', () => {
    expect(dayLabel(new Date(2026, 11, 23), today)).toMatch(/^Morgen/)
    expect(timeLabel(ev('x', '2026-12-24', '2026-12-25', true))).toBe('ganztägig')
    expect(timeLabel(ev('y', new Date(2026, 11, 22, 9, 5).toISOString(), new Date(2026, 11, 22, 10, 30).toISOString()))).toBe('09:05–10:30')
  })
})
