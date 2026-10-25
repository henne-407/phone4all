/** iCalendar-Hilfen auf Basis von ical.js: Termine lesen und Serien expandieren (wie in der App). */

import ICAL from 'ical.js'

export const MAX_INSTANCES = 500

export interface RawEvent {
  uid: string
  summary: string
  start: number
  end: number
  allDay: boolean
  location: string
  description: string
  recurring: boolean
}

export interface EventFields {
  uid: string
  summary: string
  start: number
  end: number
  allDay: boolean
  location: string
  description: string
}

/** Offset (ms) einer IANA-Zone zum Zeitpunkt `utc`. */
function zoneOffset(utc: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utc))
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utc
}

/** libical-Zonen heißen z. B. /freeassociation.sourceforge.net/Europe/Berlin */
function ianaZone(tzid: string): string | null {
  const parts = tzid.replace(/^\/+|\/+$/g, '').split('/')
  for (let i = 0; i < parts.length; i++) {
    const candidate = parts.slice(i).join('/')
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate })
      return candidate
    } catch {
      // nächster Versuch
    }
  }
  return null
}

/** ICAL.Time -> [ms (lokale Darstellung), ganztägig] */
export function timeToMs(t: ICAL.Time, tzid?: string | null): [number, boolean] {
  if (t.isDate) return [new Date(t.year, t.month - 1, t.day).getTime(), true]
  const zone = t.zone
  if (zone === ICAL.Timezone.utcTimezone || zone?.tzid === 'UTC' || zone?.tzid === 'Z') {
    return [Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second), false]
  }
  // Zone aus mitgelieferter VTIMEZONE
  if (zone && zone !== ICAL.Timezone.localTimezone && zone.component) return [t.toJSDate().getTime(), false]
  const name = tzid ?? zone?.tzid
  const iana = name ? ianaZone(name) : null
  if (iana) {
    const guess = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
    let utc = guess - zoneOffset(guess, iana)
    utc = guess - zoneOffset(utc, iana) // Sommerzeitwechsel
    return [utc, false]
  }
  // "floating" Zeit
  return [new Date(t.year, t.month - 1, t.day, t.hour, t.minute, t.second).getTime(), false]
}

function registerZones(vcal: ICAL.Component): void {
  for (const tz of vcal.getAllSubcomponents('vtimezone')) {
    const tzid = tz.getFirstPropertyValue('tzid')
    if (tzid && !ICAL.TimezoneService.has(String(tzid))) {
      ICAL.TimezoneService.register(new ICAL.Timezone({ component: tz, tzid: String(tzid) }))
    }
  }
}

export function parseCalendar(text: string): ICAL.Component | null {
  try {
    const vcal = new ICAL.Component(ICAL.parse(text))
    registerZones(vcal)
    return vcal
  } catch {
    return null
  }
}

function tzidOf(comp: ICAL.Component, prop: string): string | null {
  const p = comp.getFirstProperty(prop)
  const tz = p?.getParameter('tzid')
  return typeof tz === 'string' ? tz : null
}

function str(comp: ICAL.Component, prop: string): string {
  const v = comp.getFirstPropertyValue(prop)
  return v === null || v === undefined ? '' : String(v)
}

/** VEVENT -> Termin (ohne Serienexpansion) */
export function eventFromComp(comp: ICAL.Component): RawEvent | null {
  const dtstart = comp.getFirstPropertyValue('dtstart') as ICAL.Time | null
  if (!dtstart) return null
  const [start, allDay] = timeToMs(dtstart, tzidOf(comp, 'dtstart'))
  const dtend = comp.getFirstPropertyValue('dtend') as ICAL.Time | null
  let end: number
  if (dtend) {
    end = timeToMs(dtend, tzidOf(comp, 'dtend'))[0]
  } else {
    const duration = comp.getFirstPropertyValue('duration') as ICAL.Duration | null
    if (duration) end = start + duration.toSeconds() * 1000
    else end = allDay ? start + 86400000 : start
  }
  return {
    uid: str(comp, 'uid'),
    summary: str(comp, 'summary') || '(ohne Titel)',
    start,
    end,
    allDay,
    location: str(comp, 'location'),
    description: str(comp, 'description'),
    recurring: comp.hasProperty('rrule') || comp.hasProperty('recurrence-id'),
  }
}

/** Expandiert Serien lokal (falls der Server das nicht getan hat). */
export function expandEvents(vcal: ICAL.Component, rangeStart: number, rangeEnd: number): RawEvent[] {
  const result: RawEvent[] = []
  for (const comp of vcal.getAllSubcomponents('vevent')) {
    const master = eventFromComp(comp)
    if (!master) continue
    if (!comp.hasProperty('rrule')) {
      if (master.end > rangeStart && master.start < rangeEnd) result.push(master)
      else if (master.start === master.end && master.start >= rangeStart && master.start < rangeEnd) result.push(master)
      continue
    }
    const duration = master.end - master.start
    const tzid = tzidOf(comp, 'dtstart')
    const iterator = new ICAL.RecurExpansion({
      component: comp,
      dtstart: comp.getFirstPropertyValue('dtstart') as ICAL.Time,
    })
    let count = 0
    for (let i = 0; i < MAX_INSTANCES * 4; i++) {
      const next = iterator.next()
      if (!next) break
      const [s] = timeToMs(next, tzid)
      if (s >= rangeEnd) break
      if (s + duration > rangeStart) {
        result.push({ ...master, start: s, end: s + duration })
        if (++count >= MAX_INSTANCES) break
      }
    }
  }
  return result
}
