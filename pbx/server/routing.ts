/**
 * Anruflogik, die Asterisk zur Laufzeit abfragt (CURL auf /internal/…). Alle
 * Funktionen sind rein: Konfiguration und Laufzeitzustand rein, Antworttext raus.
 * Antworten sind durch „|“ getrennte Felder; Ziele haben die Form „Kontext^Extension“.
 */

import { type DirectoryEntry, external } from './directory'
import { closedReason, localTime } from './holidays'
import type { AppPermission, BlockedNumber, Extension, ForwardRule, PbxConfig, Trunk } from './model'
import { SPECIAL_NUMBER, cleanNumber, formatFor, prefixToE164, toE164 } from './numbers'
import { HANGUP_TARGET, destTarget } from './targets'

export interface RuntimeState {
  /** Nicht stören je Nebenstelle */
  dnd: Record<string, boolean>
  /** Sofort-Weiterleitung je Nebenstelle (Ziel wie gewählt) */
  cfu: Record<string, string>
  /** Aus Gruppen abgemeldet: Nebenstelle → IDs der Gruppen */
  away: Record<string, string[]>
}

export const EMPTY_STATE: RuntimeState = { dnd: {}, cfu: {}, away: {} }

/** Termin, der gerade in einem zentralen Kalender läuft */
export interface CalendarHit {
  summary: string
  /** Ende in ms */
  end: number
  allDay: boolean
}

/**
 * Laufende Termine der zentralen Kalender (setzt der Verwaltungsdienst; in Tests leer).
 * keyword: alle Wörter müssen im Titel vorkommen, leer = jeder Termin.
 */
export const calendarStatus = {
  find: (_calendar: string, _keyword: string, _now: Date): CalendarHit | null => null,
}

/** Enthält der Titel alle Wörter des Stichworts (ohne Groß-/Kleinschreibung)? */
export function keywordMatch(summary: string, keyword: string): boolean {
  const title = summary.toLocaleLowerCase('de')
  return keyword
    .toLocaleLowerCase('de')
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => title.includes(w))
}

/** Felder dürfen kein Trennzeichen und keine Zeichen enthalten, die den Wählplan stören. */
function field(s: string): string {
  return s.replace(/[|\r\n"\\]/g, ' ').trim()
}

function reply(...fields: string[]): string {
  return fields.map(field).join('|')
}

/** Nationale Rufnummer ohne Länderkennung (für Vergleiche über Formate hinweg). */
function significant(e164: string, country: string): string {
  return e164.startsWith('+' + country) ? e164.slice(1 + country.length) : e164.replace(/^\+/, '')
}

export function sameNumber(a: string, b: string, cfg: PbxConfig): boolean {
  const cc = cfg.system.country_code
  const ea = toE164(a, cc, cfg.system.area_code)
  const eb = toE164(b, cc, cfg.system.area_code)
  if (ea === eb) return true
  const sa = significant(ea, cc).replace(/\D/g, '')
  const sb = significant(eb, cc).replace(/\D/g, '')
  if (sa.length < 4 || sb.length < 4) return false
  // Anbieter senden die Nummer mal mit, mal ohne Vorwahl/Länderkennung
  return sa.endsWith(sb) || sb.endsWith(sa)
}

/** Anzeige der Anrufernummer: national mit 0, Ausland mit 00. */
export function displayNumber(raw: string, cfg: PbxConfig): string {
  const n = cleanNumber(raw)
  if (!n || !/\d/.test(n)) return 'anonymous'
  const cc = cfg.system.country_code
  let e164 = toE164(n, cc)
  // Anbieter, die ohne + senden (4930…), erkennen
  if (!e164.startsWith('+') && n.startsWith(cc) && n.length > 9) e164 = '+' + n
  return e164.startsWith('+') ? formatFor(e164, 'national', cc) : n
}

interface NameIndex {
  revision: number
  /** Einträge je letzte 6 Ziffern der nationalen Nummer */
  bySuffix: Map<string, { pos: number; entry: DirectoryEntry }[]>
  /** Kurze Nummern, die über das Suffix nicht sicher zu finden sind */
  short: { pos: number; entry: DirectoryEntry }[]
}

const SUFFIX = 6
const nameIndexes = new WeakMap<PbxConfig, NameIndex>()

function suffixOf(n: string, cfg: PbxConfig): string {
  const cc = cfg.system.country_code
  return significant(toE164(n, cc, cfg.system.area_code), cc).replace(/\D/g, '').slice(-SUFFIX)
}

// Externe Quellen bringen schnell tausende Kontakte mit – nicht bei jedem Anruf alle umrechnen
function nameIndex(cfg: PbxConfig): NameIndex {
  const revision = external.revision()
  const known = nameIndexes.get(cfg)
  if (known?.revision === revision) return known
  const index: NameIndex = { revision, bySuffix: new Map(), short: [] }
  ;[...cfg.phonebook, ...external.entries()].forEach((entry, pos) => {
    const keys = new Set<string>()
    for (const n of [entry.phone, entry.mobile]) {
      if (!n) continue
      const key = suffixOf(n, cfg)
      if (key.length < SUFFIX) index.short.push({ pos, entry })
      else keys.add(key)
    }
    for (const key of keys) index.bySuffix.set(key, [...(index.bySuffix.get(key) ?? []), { pos, entry }])
  })
  nameIndexes.set(cfg, index)
  return index
}

/** Bekannter Name zu einer Nummer (Telefonbuch, Nebenstellen). */
export function lookupName(cfg: PbxConfig, number: string): string {
  if (!/\d{3,}/.test(number)) return ''
  const index = nameIndex(cfg)
  const key = suffixOf(number, cfg)
  // Kurze gesuchte Nummern können zu jedem längeren Eintrag passen, der so endet
  const candidates =
    key.length < SUFFIX ? [...index.bySuffix.values()].flat().concat(index.short) : [...(index.bySuffix.get(key) ?? []), ...index.short]
  const e = candidates
    .sort((a, b) => a.pos - b.pos)
    .map((c) => c.entry)
    .find((c) => [c.phone, c.mobile].some((n) => n && sameNumber(n, number, cfg)))
  if (!e) return ''
  return e.company && e.name ? `${e.name} (${e.company})` : e.name || e.company
}

function userPart(header: string): string {
  const m = /<?sips?:([^@>;]+)@/.exec(header) ?? /<?tel:([^>;]+)/.exec(header)
  return m ? decodeURIComponent(m[1]) : ''
}

/** Ziel im Wählplan für gesperrte Anrufer */
export const BLOCKED_TARGET = 'p4a-blocked^s'

/** Sperre, die für einen Anrufer greift (Nummer wie angezeigt), oder 'anonymous' */
export function blockedBy(cfg: PbxConfig, caller: string): BlockedNumber | 'anonymous' | null {
  if (caller === 'anonymous') return cfg.blocking.anonymous === 'reject' ? 'anonymous' : null
  const cc = cfg.system.country_code
  const e164 = toE164(caller, cc)
  for (const b of cfg.blocklist) {
    const raw = b.number.trim()
    if (raw.endsWith('*')) {
      const prefix = prefixToE164(raw.slice(0, -1), cc)
      if (prefix && (e164.startsWith(prefix) || cleanNumber(caller).startsWith(cleanNumber(raw.slice(0, -1))))) return b
    } else if (cleanNumber(raw) && sameNumber(raw, caller, cfg)) return b
  }
  return null
}

export interface InboundRequest {
  trunk: string
  did: string
  to: string
  cid: string
  name: string
}

export function routeInbound(cfg: PbxConfig, req: InboundRequest): string {
  const trunk = cfg.trunks.find((t) => t.id === req.trunk)
  let called = req.did
  if (trunk?.did_source === 'to' || !called || called === 's') called = userPart(req.to) || called
  const caller = displayNumber(req.cid, cfg)
  if (blockedBy(cfg, caller)) return reply(BLOCKED_TARGET, lookupName(cfg, caller), caller, displayNumber(called, cfg))

  const candidates = cfg.inbound
    .filter((r) => !r.trunk || r.trunk === req.trunk)
    .filter((r) => !r.number.trim() || sameNumber(r.number, called, cfg) || r.number.trim() === called)
    .filter((r) => !r.caller.trim() || toE164(caller, cfg.system.country_code).startsWith(toE164(r.caller, cfg.system.country_code)))
    .map((r) => ({ r, score: (r.number.trim() ? 4 : 0) + (r.caller.trim() ? 2 : 0) + (r.trunk ? 1 : 0) }))
    .sort((a, b) => b.score - a.score)
  const route = candidates[0]?.r

  const target = route ? destTarget(cfg, route.destination) : trunk ? destTarget(cfg, trunk.inbound_default) : HANGUP_TARGET
  let name = req.name && req.name !== req.cid ? req.name : ''
  if (!name || /^[+\d\s]+$/.test(name)) name = lookupName(cfg, caller) || name
  if (route?.name_prefix) name = route.name_prefix + (name || caller)
  return reply(target, name, caller, displayNumber(called, cfg))
}

/** Nummer innerhalb der Anlage (Nebenstelle, Gruppe, Konferenz, Sprachmenü)? */
export function isLocalNumber(cfg: PbxConfig, n: string): boolean {
  return [cfg.extensions, cfg.groups, cfg.conferences, cfg.ivrs].some((list) => list.some((x) => x.number === n))
}

function targetForNumber(cfg: PbxConfig, raw: string): string {
  const n = cleanNumber(raw)
  if (!n) return ''
  return isLocalNumber(cfg, n) ? `p4a-local^${n}` : `p4a-fwd^${n}`
}

/** Darf die Nebenstelle auf dieses Ziel umleiten? Gibt den Grund zurück, wenn nicht. */
export function forwardDenied(cfg: PbxConfig, num: string, raw: string, need: AppPermission = 'forward'): string {
  const perms = appPermissions(cfg, num)
  if (!perms.includes(need)) return need === 'forward' ? 'Umleiten ist für diese Nebenstelle nicht freigegeben.' : 'Umleitungsregeln sind für diese Nebenstelle nicht freigegeben.'
  const n = cleanNumber(raw)
  if (!n) return ''
  if (n === num) return 'Die Umleitung kann nicht auf die eigene Nebenstelle zeigen.'
  if (!isLocalNumber(cfg, n) && !perms.includes('forward_external')) return 'Umleiten auf externe Rufnummern ist nicht freigegeben.'
  return ''
}

/** Greift die Regel gerade? */
export function ruleActive(cfg: PbxConfig, state: RuntimeState, num: string, rule: ForwardRule, now = new Date()): boolean {
  if (!rule.enabled) return false
  if (rule.action === 'dnd') {
    if (rule.when === 'dnd') return false
  } else if (!cleanNumber(rule.target) || cleanNumber(rule.target) === num) return false
  switch (rule.when) {
    case 'dnd':
      return Boolean(state.dnd[num])
    case 'calendar':
      return Boolean(rule.calendar && calendarStatus.find(rule.calendar, rule.keyword ?? '', now))
    case 'schedule': {
      const tc = { rules: [{ days: rule.days, from: rule.from, to: rule.to }], holidays: false, closed_dates: [], override: 'auto' as const }
      return closedReason(tc as never, now, cfg.system.state, cfg.system.timezone) === null
    }
    case 'timecondition': {
      const tc = cfg.timeconditions.find((t) => t.id === rule.timecondition)
      if (!tc) return false
      const closed = closedReason(tc, now, cfg.system.state, cfg.system.timezone) !== null
      return closed === (rule.tc_state === 'closed')
    }
    default:
      return false
  }
}

/** Nicht stören: von Hand (*76, App) oder durch eine Regel (Zeitplan, Termin) */
export function dndActive(cfg: PbxConfig, state: RuntimeState, num: string, now = new Date()): boolean {
  if (state.dnd[num]) return true
  const ext = cfg.extensions.find((e) => e.number === num)
  return Boolean(ext?.forward.rules.some((r) => r.action === 'dnd' && ruleActive(cfg, state, num, r, now)))
}

/** Laufender Termin, der eine Regel der Nebenstelle auslöst (für die Besetztanzeige) */
export function calendarNote(cfg: PbxConfig, state: RuntimeState, num: string, now = new Date()): string {
  const ext = cfg.extensions.find((e) => e.number === num)
  for (const r of ext?.forward.rules ?? []) {
    if (r.when !== 'calendar' || !r.calendar || !ruleActive(cfg, state, num, r, now)) continue
    const hit = calendarStatus.find(r.calendar, r.keyword ?? '', now)
    if (!hit) continue
    const tz = cfg.system.timezone
    const day = (ms: number): string => new Date(ms).toLocaleDateString('de-DE', { timeZone: tz })
    // Ganztägig: Ende ist exklusiv, also der Tag davor ist der letzte
    const last = hit.allDay ? hit.end - 86400000 : hit.end
    const until =
      !hit.allDay && day(last) === day(now.getTime())
        ? new Date(last).toLocaleTimeString('de-DE', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
        : new Date(last).toLocaleDateString('de-DE', { timeZone: tz, day: 'numeric', month: 'numeric' })
    return `${hit.summary} bis ${until}`
  }
  return ''
}

/** Aktuelles Umleitungsziel: Sofort-Umleitung, sonst die erste greifende Regel. */
export function activeForward(cfg: PbxConfig, state: RuntimeState, num: string, now = new Date()): string {
  const cfu = state.cfu[num]
  if (cfu && cleanNumber(cfu) !== num) return cfu
  const ext = cfg.extensions.find((e) => e.number === num)
  return ext?.forward.rules.find((r) => r.action !== 'dnd' && ruleActive(cfg, state, num, r, now))?.target ?? ''
}

/** Rechte in der App: für alle Nebenstellen plus die ihrer Gruppen */
export function appPermissions(cfg: PbxConfig, num: string): AppPermission[] {
  const set = new Set(cfg.provisioning.permissions)
  for (const g of cfg.groups) if (g.members.includes(num)) for (const p of g.permissions) set.add(p)
  return [...set]
}

export function extensionPlan(cfg: PbxConfig, state: RuntimeState, num: string, now = new Date()): string {
  const ext = cfg.extensions.find((e) => e.number === num)
  if (!ext) return reply('goto', HANGUP_TARGET)
  const vm = ext.voicemail.enabled
  const busy = ext.forward.busy ? targetForNumber(cfg, ext.forward.busy) : vm ? `p4a-vmb^${num}` : ''
  const noanswer = ext.forward.noanswer ? targetForNumber(cfg, ext.forward.noanswer) : vm ? `p4a-vmu^${num}` : ''
  const forward = activeForward(cfg, state, num, now)
  if (forward) return reply('goto', targetForNumber(cfg, forward))
  if (dndActive(cfg, state, num, now)) return reply('goto', busy)
  const mobile = ext.mobile.enabled && cleanNumber(ext.mobile.number) ? '1' : '0'
  return reply('ring', String(ext.ring_seconds || 25), ext.record ? '1' : '0', busy, noanswer, mobile)
}

/** Handy der Nebenstelle klingeln lassen: Verzögerung und Nummer, ob mit Bestätigung */
export function mobilePlan(cfg: PbxConfig, num: string): string {
  const ext = cfg.extensions.find((e) => e.number === num)
  const n = cleanNumber(ext?.mobile.number ?? '')
  if (!ext?.mobile.enabled || !n) return ''
  return reply(String(Math.min(60, Math.max(0, ext.mobile.delay || 0))), n, ext.mobile.confirm ? '1' : '0')
}

/** Aus der Gruppe abgemeldet? */
export function isAway(state: RuntimeState, num: string, gid: string): boolean {
  return Boolean(state.away[num]?.includes(gid))
}

/** An- oder abmelden; nur Mitglieder der Gruppe */
export function setAway(cfg: PbxConfig, state: RuntimeState, num: string, gid: string, away: boolean): boolean {
  const g = cfg.groups.find((x) => x.id === gid)
  if (!g?.members.includes(num)) return false
  const list = (state.away[num] ?? []).filter((id) => id !== gid)
  if (away) list.push(gid)
  if (list.length) state.away[num] = list
  else delete state.away[num]
  return true
}

/** Gruppen, in denen die Nebenstelle Mitglied ist, mit Anmeldestand */
export function memberGroups(cfg: PbxConfig, state: RuntimeState, num: string): { id: string; number: string; name: string; active: boolean }[] {
  return cfg.groups
    .filter((g) => g.members.includes(num))
    .map((g) => ({ id: g.id, number: g.number, name: g.name, active: !isAway(state, num, g.id) }))
}

export function isAvailable(state: RuntimeState, num: string, cfg?: PbxConfig, gid = ''): boolean {
  if (gid && isAway(state, num, gid)) return false
  return !(cfg ? dndActive(cfg, state, num) : state.dnd[num]) && !(cfg ? activeForward(cfg, state, num) : state.cfu[num])
}

export function groupPlan(cfg: PbxConfig, state: RuntimeState, id: string, callerName: string, soundDir: string): string {
  const g = cfg.groups.find((x) => x.id === id)
  if (!g) return ''
  // Wie im Warteschlangen-Modus (p4a-qmember): Wer nicht stören will oder umgeleitet hat, klingelt nicht mit
  const members = g.members.filter((n) => cfg.extensions.some((e) => e.number === n) && isAvailable(state, n, cfg, g.id))
  const ann = cfg.announcements.find((a) => a.id === g.announcement)
  return reply(
    g.mode,
    String(g.timeout || 30),
    members.join('&'),
    destTarget(cfg, g.fallback),
    g.name_prefix ? g.name_prefix + callerName : callerName,
    ann?.file ? `${soundDir}/${ann.file}` : '',
    String(g.member_seconds || 15),
  )
}

/** Durchsage (page: Gruppe oder alle) und Gegensprechen (intercom: eine Nebenstelle): wer angesprochen wird, '' = nicht erlaubt */
export function pagePlan(cfg: PbxConfig, state: RuntimeState, ext: string, target: string, mode: string, now = new Date()): string {
  if (!cfg.extensions.some((e) => e.number === ext) || !appPermissions(cfg, ext).includes('intercom')) return ''
  const reachable = (n: string): boolean => n !== ext && cfg.extensions.some((e) => e.number === n) && !dndActive(cfg, state, n, now)
  if (mode === 'intercom') return reachable(target) ? target : ''
  if (mode !== 'page') return ''
  if (!target) return cfg.extensions.map((e) => e.number).filter(reachable).join('&')
  const g = cfg.groups.find((x) => x.number && x.number === target)
  return g ? g.members.filter((n) => reachable(n) && !isAway(state, n, g.id)).join('&') : ''
}

/** Wer bei einer Ansage über die Schnittstelle klingelt: Nebenstelle oder angemeldete Mitglieder einer Gruppe */
export function ringPlan(cfg: PbxConfig, state: RuntimeState, target: string): string {
  if (cfg.extensions.some((e) => e.number === target)) return target
  const g = cfg.groups.find((x) => x.number && x.number === target)
  return g ? g.members.filter((n) => cfg.extensions.some((e) => e.number === n) && isAvailable(state, n, cfg, g.id)).join('&') : ''
}

export function timeConditionTarget(cfg: PbxConfig, id: string, now = new Date()): string {
  const tc = cfg.timeconditions.find((t) => t.id === id)
  if (!tc) return HANGUP_TARGET
  const closed = closedReason(tc, now, cfg.system.state, cfg.system.timezone)
  return destTarget(cfg, closed ? tc.closed : tc.open)
}

/** Gewählte Nummer als E.164 (Sondernummern wie 112 bleiben, wie sie sind) */
export function dialedNumber(cfg: PbxConfig, raw: string): { dialed: string; special: boolean; e164: string } {
  const cc = cfg.system.country_code
  const dialed = cleanNumber(raw)
  const special = SPECIAL_NUMBER.test(dialed)
  let e164 = special ? dialed : toE164(dialed, cc, cfg.system.area_code)
  // Kurze Ortsnummern (3–4 Stellen, gibt es in kleinen Ortsnetzen): toE164 ergänzt
  // die Vorwahl erst ab 5 Stellen, weil kürzere Nummern sonst auch interne sein könnten.
  // Hier ist klar, dass es keine interne Nummer ist – die stehen vorher im Wählplan.
  const area = cfg.system.area_code.trim()
  if (!special && area && /^[1-9]\d{2,3}$/.test(dialed)) e164 = `+${cc}${area}${dialed}`
  return { dialed, special, e164 }
}

/** Ins Ausland (nicht Sondernummer, nicht eigenes Land)? */
export function isInternational(cfg: PbxConfig, raw: string): boolean {
  const { special, e164 } = dialedNumber(cfg, raw)
  return !special && e164.startsWith('+') && !e164.startsWith('+' + cfg.system.country_code)
}

/** Notruf und kostenlose Sondernummern: gehen auch bei Notbremse und Grenzen */
export function isEmergency(raw: string): boolean {
  const n = cleanNumber(raw)
  return SPECIAL_NUMBER.test(n) && !n.startsWith('118')
}

function isPremium(cfg: PbxConfig, e164: string): boolean {
  const cc = cfg.system.country_code
  return cfg.security.premium_prefixes.some((p) => {
    const prefix = prefixToE164(p, cc)
    return prefix.startsWith('+') && e164.startsWith(prefix)
  })
}

/** Warum ein Auslandsgespräch nicht erlaubt ist ('' = erlaubt) */
function internationalDenied(cfg: PbxConfig, e164: string, forwarding: boolean, now: Date): string {
  const s = cfg.security
  if (forwarding && !s.forward_international) return 'forward'
  const countries = s.countries.map((c) => c.trim()).filter(Boolean)
  if (countries.length && !countries.includes('*') && !countries.some((c) => e164.startsWith('+' + c))) return 'country'
  if (s.international_daytime) {
    const minutes = localTime(now, cfg.system.timezone).minutes
    if (minutes < 6 * 60 || minutes >= 22 * 60) return 'night'
  }
  return ''
}

export interface OutboundRequest {
  ext: string
  fwd: string
  num: string
  cid: string
}

function trunkCid(cfg: PbxConfig, trunk: Trunk, ext: Extension | undefined): string {
  const cc = cfg.system.country_code
  const area = cfg.system.area_code
  const own = ext?.outbound_cid
  let cid = ''
  if (own && (trunk.forward_caller_id || trunk.numbers.some((n) => sameNumber(n, own, cfg)))) cid = own
  else cid = trunk.default_cid || trunk.numbers[0] || ''
  return cid ? formatFor(toE164(cid, cc, area), trunk.number_format, cc) : ''
}

export function routeOutbound(cfg: PbxConfig, req: OutboundRequest, now = new Date()): string {
  const cc = cfg.system.country_code
  const forwarding = Boolean(req.fwd)
  const actorNumber = forwarding ? (req.fwd === 'flow' ? '' : req.fwd) : req.ext
  const actor = cfg.extensions.find((e) => e.number === actorNumber)
  if (!forwarding && !actor) return reply('deny')

  const { dialed, special, e164 } = dialedNumber(cfg, req.num)

  // Eigene Rufnummer eines anderen (oder desselben) SIP-Kontos: direkt intern
  // durchstellen, als käme der Anruf von außen. Über das Telefonnetz zurück klappt
  // bei vielen Anbietern nicht (besetzt oder „Nummer nicht vergeben“). Ohne Vorwahl
  // gewählt zählt auch der Teil hinter der Vorwahl – die Konten können in
  // verschiedenen Ortsnetzen liegen, eingestellt ist aber nur eine Ortsvorwahl.
  if (!special && !forwarding && actor && actor.permission !== 'internal') {
    const local = /^[1-9]\d{4,}$/.test(dialed) ? dialed : ''
    const isOwn = (n: string): boolean =>
      (e164.startsWith('+') && sameNumber(n, e164, cfg)) || Boolean(local && significant(toE164(n, cc, cfg.system.area_code), cc).endsWith(local))
    const own = cfg.trunks.find((t) => t.enabled && t.numbers.some(isOwn))
    if (own) {
      const did = own.numbers.find(isOwn) ?? dialed
      const inbound = routeInbound(cfg, { trunk: own.id, did, to: '', cid: actor.number, name: actor.name })
      const [target, , , called] = inbound.split('|')
      return reply('local', target, actor.name, actor.number, called)
    }
  }

  if (!special && !e164.startsWith('+')) return reply('invalid')

  // Notbremse: nur noch Notruf und kostenlose Sondernummern
  if (cfg.security.outbound_stop && !isEmergency(dialed)) return reply('deny')
  if (special && dialed.startsWith('118') && !actor?.allow_premium) return reply('deny')
  if (!special) {
    const permission = actor?.permission ?? 'national'
    if (permission === 'internal') return reply('deny')
    const abroad = !e164.startsWith('+' + cc)
    if (permission === 'national' && abroad) return reply('deny')
    if (isPremium(cfg, e164) && !actor?.allow_premium) return reply('deny')
    if (abroad && internationalDenied(cfg, e164, forwarding, now)) return reply('deny')
  }

  const enabled = cfg.trunks.filter((t) => t.enabled && t.registrar.trim())
  let trunks: Trunk[] = []
  const routes = cfg.outbound.filter((r) => !r.extensions.length || (actor && r.extensions.includes(actor.number)))
  for (const r of routes) {
    const prefixes = r.prefixes.map((p) => p.trim()).filter(Boolean)
    const match = !prefixes.length || prefixes.some((p) => (special ? dialed.startsWith(cleanNumber(p)) : e164.startsWith(prefixToE164(p, cc))))
    if (!match) continue
    trunks = r.trunks.map((id) => enabled.find((t) => t.id === id)).filter((t): t is Trunk => Boolean(t))
    if (trunks.length) break
  }
  // Ohne passende Regel (oder für Notrufe ohne Regel) jedes aktive Konto versuchen
  if (!trunks.length && (!cfg.outbound.length || special)) trunks = enabled
  if (!trunks.length) return reply('deny')
  // Das Konto, zu dem die eigene Rufnummer der Nebenstelle gehört, zuerst nehmen –
  // nur dort darf die Nummer auch angezeigt werden
  const ownCid = !forwarding ? actor?.outbound_cid.trim() : ''
  if (ownCid) {
    const owner = trunks.find((t) => t.numbers.some((n) => sameNumber(n, ownCid, cfg)))
    if (owner) trunks = [owner, ...trunks.filter((t) => t !== owner)]
  }

  const callerE164 = toE164(req.cid, cc, cfg.system.area_code)
  const legs = trunks.flatMap((t) => {
    const number = special ? dialed : formatFor(e164, t.number_format, cc)
    let cid = trunkCid(cfg, t, actor)
    if (forwarding && t.forward_caller_id && callerE164.startsWith('+')) cid = formatFor(callerE164, t.number_format, cc)
    return [`trunk-${t.id}`, number, cid]
  })
  return reply('ok', ...legs)
}

export interface FeatureResult {
  reply: 'on' | 'off' | 'error'
  stateChanged?: boolean
  configChanged?: boolean
}

/** Funktionscodes vom Telefon (*76, *21, *28). Ändert state/cfg direkt. */
export function feature(cfg: PbxConfig, state: RuntimeState, ext: string, code: string, arg: string, now = new Date()): FeatureResult {
  if (!cfg.extensions.some((e) => e.number === ext)) return { reply: 'error' }
  switch (code) {
    case 'dnd':
      if (state.dnd[ext]) delete state.dnd[ext]
      else state.dnd[ext] = true
      return { reply: state.dnd[ext] ? 'on' : 'off', stateChanged: true }
    case 'cfu': {
      const target = cleanNumber(arg)
      if (!target) {
        delete state.cfu[ext]
        return { reply: 'off', stateChanged: true }
      }
      if (forwardDenied(cfg, ext, target)) return { reply: 'error' }
      state.cfu[ext] = target
      return { reply: 'on', stateChanged: true }
    }
    case 'away': {
      // *45 = alle Gruppen umschalten, *45<Gruppe> = eine; „on“ = angemeldet
      const groups = memberGroups(cfg, state, ext).filter((g) => !arg || g.number === cleanNumber(arg))
      if (!groups.length) return { reply: 'error' }
      const away = groups.some((g) => g.active)
      for (const g of groups) setAway(cfg, state, ext, g.id, away)
      return { reply: away ? 'off' : 'on', stateChanged: true }
    }
    case 'vmother':
      return { reply: appPermissions(cfg, ext).includes('voicemail_other') ? 'on' : 'error' }
    case 'tc': {
      const tc = cfg.timeconditions[Number(arg) - 1]
      if (!tc) return { reply: 'error' }
      if (tc.override !== 'auto') {
        tc.override = 'auto'
        return { reply: 'off', configChanged: true }
      }
      const closed = closedReason(tc, now, cfg.system.state, cfg.system.timezone)
      tc.override = closed ? 'open' : 'closed'
      return { reply: 'on', configChanged: true }
    }
    default:
      return { reply: 'error' }
  }
}

/** Name eines Anrufers von außen: Am Namen erkennen die Apps Durchsagen und nehmen von selbst an – von außen nie */
export function inboundName(name: string): string {
  return name.replace(/^\W*(durchsage|gegensprechen)\b\W*/i, '')
}
