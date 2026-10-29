/**
 * Notrufe: Wählt eine Nebenstelle 110 oder 112, erfahren es die eingetragenen Personen
 * per E-Mail und Messenger, Home Assistant und Webhooks. Am Anruf selbst ändert sich
 * nichts – er geht wie immer sofort raus.
 */

import type { PbxConfig } from './model'
import { cleanNumber } from './numbers'

export const EMERGENCY_NUMBER = /^(110|112)$/

export interface EmergencyCall {
  id: string
  /** ISO-Zeitpunkt */
  time: string
  extension: string
  name: string
  number: string
}

/** Notruf? Nur von Nebenstellen, nicht bei Weiterleitungen von außen */
export function isEmergency(num: string, fwd: string): boolean {
  return !fwd && EMERGENCY_NUMBER.test(cleanNumber(num))
}

export function emergencyCall(cfg: PbxConfig, ext: string, number: string, now = new Date()): EmergencyCall {
  return {
    id: `${now.getTime()}-${ext}`,
    time: now.toISOString(),
    extension: ext,
    name: cfg.extensions.find((e) => e.number === ext)?.name ?? '',
    number: cleanNumber(number),
  }
}

/** Text für E-Mail und Messenger */
export function emergencyText(cfg: PbxConfig, c: EmergencyCall): string {
  const when = new Date(c.time).toLocaleString('de-DE', { timeZone: cfg.system.timezone || 'Europe/Berlin', dateStyle: 'short', timeStyle: 'medium' })
  return `Notruf: ${c.name || 'Nebenstelle'} (${c.extension}) hat am ${when} die ${c.number} gewählt.`
}

/** Klingeln an einer Türsprechstelle (für Home Assistant) */
export interface DoorRing {
  id: string
  time: string
  extension: string
  name: string
}

/** Die letzten Notrufe (für Home Assistant), höchstens 10 */
export class EmergencyLog<T extends { id: string } = EmergencyCall> {
  calls: T[] = []

  add(c: T): void {
    if (this.calls.some((x) => x.id === c.id)) return
    this.calls = [c, ...this.calls].slice(0, 10)
  }
}
