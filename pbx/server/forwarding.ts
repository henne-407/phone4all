/**
 * Umleitungen aus der App: Sofort-Umleitung, besetzt / keine Antwort und Regeln.
 * Was eine Nebenstelle ändern darf, bestimmen die Rechte (Grundrechte plus Gruppen).
 */

import type { AppPermission, Extension, ForwardRule, PbxConfig } from './model'
import { cleanNumber } from './numbers'
import { type RuntimeState, activeForward, appPermissions, forwardDenied } from './routing'

export interface ForwardTarget {
  number: string
  name: string
  kind: 'extension' | 'group'
}

export interface ForwardInfo {
  permissions: AppPermission[]
  /** Sofort-Umleitung ('' = aus) */
  cfu: string
  /** Was gerade greift (Sofort-Umleitung oder Regel) */
  active: string
  busy: string
  noanswer: string
  rules: ForwardRule[]
  /** Interne Ziele zur Auswahl */
  targets: ForwardTarget[]
  timeconditions: { id: string; name: string }[]
  /** Zentrale Kalender für Regeln „bei Termin“ */
  calendars: { id: string; name: string }[]
  /** Handy klingelt mit (null = keine Handynummer eingetragen) */
  mobile: { enabled: boolean; number: string } | null
}

export interface ForwardChange {
  cfu?: string
  busy?: string
  noanswer?: string
  rules?: ForwardRule[]
  /** Handy klingelt mit: ein/aus (Nummer trägt die Verwaltung ein) */
  mobile?: boolean
}

export class ForwardError extends Error {}

export function forwardInfo(cfg: PbxConfig, state: RuntimeState, ext: Extension, now = new Date()): ForwardInfo {
  const targets: ForwardTarget[] = [
    ...cfg.extensions.filter((e) => e.number !== ext.number).map((e) => ({ number: e.number, name: e.name, kind: 'extension' as const })),
    ...cfg.groups.filter((g) => g.number).map((g) => ({ number: g.number, name: g.name, kind: 'group' as const })),
  ].sort((a, b) => a.number.localeCompare(b.number, 'de', { numeric: true }))
  return {
    permissions: appPermissions(cfg, ext.number),
    cfu: state.cfu[ext.number] ?? '',
    active: activeForward(cfg, state, ext.number, now),
    busy: ext.forward.busy,
    noanswer: ext.forward.noanswer,
    rules: ext.forward.rules,
    targets,
    timeconditions: cfg.timeconditions.map((t) => ({ id: t.id, name: t.name })),
    calendars: cfg.calendars.map((c) => ({ id: c.id, name: c.name })),
    mobile: ext.mobile.number ? { enabled: ext.mobile.enabled, number: ext.mobile.number } : null,
  }
}

export function check(cfg: PbxConfig, num: string, target: string, need: AppPermission = 'forward'): void {
  const denied = forwardDenied(cfg, num, target, need)
  if (denied) throw new ForwardError(denied)
}

/** Sofort-Umleitung prüfen und in den Laufzeitzustand schreiben */
export function applyCfu(cfg: PbxConfig, state: RuntimeState, num: string, raw: string): void {
  const target = cleanNumber(raw)
  check(cfg, num, target)
  if (target) state.cfu[num] = target
  else delete state.cfu[num]
}

/** Feste Weiterleitungen und Regeln prüfen und in die Nebenstelle (Entwurf) schreiben */
export function applyRules(cfg: PbxConfig, ext: Extension, change: ForwardChange): void {
  check(cfg, ext.number, '', 'forward_rules')
  if (change.busy !== undefined) ext.forward.busy = cleanNumber(change.busy)
  if (change.noanswer !== undefined) ext.forward.noanswer = cleanNumber(change.noanswer)
  if (change.rules !== undefined) {
    if (!Array.isArray(change.rules)) throw new ForwardError('Regeln fehlen.')
    ext.forward.rules = change.rules.map((r) => ({
      id: String(r.id ?? ''),
      enabled: Boolean(r.enabled),
      when: r.when,
      days: Array.isArray(r.days) ? r.days.map(Number) : [],
      from: String(r.from ?? ''),
      to: String(r.to ?? ''),
      timecondition: String(r.timecondition ?? ''),
      tc_state: r.tc_state === 'open' ? 'open' : 'closed',
      target: cleanNumber(String(r.target ?? '')),
      action: r.action === 'dnd' ? 'dnd' : 'forward',
      ...(r.when === 'calendar' ? { calendar: String(r.calendar ?? ''), keyword: String(r.keyword ?? '') } : {}),
    }))
  }
  for (const t of [ext.forward.busy, ext.forward.noanswer, ...ext.forward.rules.map((r) => r.target)]) check(cfg, ext.number, t, 'forward_rules')
}

/** Handy mitklingeln lassen oder nicht (Recht „Umleitung schalten“) */
export function applyMobile(cfg: PbxConfig, ext: Extension, enabled: boolean): void {
  check(cfg, ext.number, '')
  if (!ext.mobile.number) throw new ForwardError('Für diese Nebenstelle ist keine Handynummer eingetragen.')
  ext.mobile.enabled = enabled
}
