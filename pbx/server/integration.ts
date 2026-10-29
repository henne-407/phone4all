/**
 * Schnittstelle für Hausautomation (Home Assistant u. a.): ein Zustandsbericht mit
 * SIP-Konten, verpassten Anrufen und Problemen. Zugriff mit Bearer-Token, damit sie
 * auch über einen Reverse-Proxy (HTTPS) ohne Anmeldung an der Weboberfläche geht.
 */

import { timingSafeEqual } from 'node:crypto'
import type { PbxStatus } from './asterisk'
import type { CallRecord } from './cdr'
import type { PbxConfig } from './model'
import type { RuntimeState } from './routing'
import type { UpdateInfo } from './updates'

/** Version der Schnittstelle; steigt nur bei inkompatiblen Änderungen */
export const INTEGRATION_API = 1

const MISSED_LIMIT = 25

export interface MissedCall {
  id: string
  /** ISO-Zeitpunkt (UTC) */
  time: string
  from: string
  from_name: string
  /** Angerufene Rufnummer der Anlage */
  to: string
  /** Auf die Voicemail gegangen (zählt als verpasst) */
  voicemail: boolean
}

export interface TrunkReport {
  id: string
  name: string
  enabled: boolean
  /** Meldet sich beim Anbieter an (sonst IP-Prüfung oder ausgeschaltet) */
  register: boolean
  /** Status von Asterisk, z. B. „Registered“, „Rejected“; leer = unbekannt */
  status: string
  registered: boolean
  problem: boolean
}

export interface Problem {
  /** Stabiler Schlüssel, z. B. „asterisk“ oder „trunk:<id>“ */
  key: string
  message: string
}

export interface IntegrationReport {
  api: number
  name: string
  version: string
  asterisk: { state: PbxStatus['asterisk']; message: string; uptime: number }
  trunks: TrunkReport[]
  extensions: { number: string; name: string; devices: number; dnd: boolean; forward: string }[]
  active_calls: number
  missed: { today: number; calls: MissedCall[] }
  problems: Problem[]
  update: { available: boolean; current: string; latest: string }
  bans: number
}

/** CDR-Zeit „2026-10-24 14:05:00“ (Ortszeit des Containers) als ISO-Zeitpunkt */
export function cdrTime(start: string): string {
  const d = new Date(start.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? start : d.toISOString()
}

/** Eingehende Anrufe, die niemand angenommen hat (auch Voicemail), ohne laufende */
export function missedCalls(calls: CallRecord[], active: Set<string>): MissedCall[] {
  return calls
    .filter((c) => c.direction === 'in' && !active.has(c.id))
    .filter((c) => c.status !== 'answered' || c.answeredBy === 'Voicemail')
    .map((c) => ({
      id: c.id,
      time: cdrTime(c.start),
      from: c.from,
      from_name: c.fromName,
      to: c.to,
      voicemail: c.answeredBy === 'Voicemail',
    }))
}

function sameLocalDay(iso: string, now: Date): boolean {
  const d = new Date(iso)
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export function integrationReport(
  cfg: PbxConfig,
  state: RuntimeState,
  status: PbxStatus,
  calls: CallRecord[],
  update: UpdateInfo,
  version: string,
  bans: number,
  now = new Date(),
): IntegrationReport {
  const running = status.asterisk === 'running'
  const problems: Problem[] = []
  if (!running) {
    problems.push({ key: 'asterisk', message: status.message || `Asterisk läuft nicht (${status.asterisk})` })
  }
  if (cfg.security.outbound_stop) {
    problems.push({ key: 'outbound_stop', message: 'Notbremse aktiv: keine Gespräche nach außen (außer Notruf)' })
  }

  const trunks = cfg.trunks.map((t): TrunkReport => {
    const register = t.enabled && t.register && !t.ip_auth
    const reg = status.registrations.find((r) => r.trunk === t.id)
    const registered = reg?.status === 'Registered'
    // Ohne laufendes Asterisk meldet schon „asterisk“ das Problem
    const problem = register && running && !registered
    if (problem) {
      problems.push({ key: `trunk:${t.id}`, message: `SIP-Konto ${t.name} ist nicht angemeldet${reg?.status ? ` (${reg.status})` : ''}` })
    }
    return { id: t.id, name: t.name, enabled: t.enabled, register, status: reg?.status ?? '', registered, problem }
  })

  const active = new Set(status.calls.map((c) => c.id))
  const missed = missedCalls(calls, active)

  return {
    api: INTEGRATION_API,
    name: cfg.system.name,
    version,
    asterisk: { state: status.asterisk, message: status.message, uptime: Number(status.uptime) || 0 },
    trunks,
    extensions: cfg.extensions.map((e) => ({
      number: e.number,
      name: e.name,
      devices: status.endpoints.find((s) => s.number === e.number)?.contacts.length ?? 0,
      dnd: !!state.dnd[e.number],
      forward: state.cfu[e.number] ?? '',
    })),
    active_calls: status.calls.length,
    missed: { today: missed.filter((m) => sameLocalDay(m.time, now)).length, calls: missed.slice(0, MISSED_LIMIT) },
    problems,
    update: { available: update.available, current: update.current, latest: update.latest?.version ?? '' },
    bans,
  }
}

/** „Authorization: Bearer <token>“ prüfen (zeitkonstant) */
export function validToken(cfg: PbxConfig, header: string | undefined): boolean {
  if (!cfg.integration.enabled || !cfg.integration.token) return false
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '')
  if (!m) return false
  const a = Buffer.from(m[1])
  const b = Buffer.from(cfg.integration.token)
  return a.length === b.length && timingSafeEqual(a, b)
}
