/**
 * Wo wird ein Eintrag noch verwendet? Für die Warnung vor dem Löschen (Weboberfläche)
 * und zum Mitziehen von Rufnummern, wenn eine Nebenstelle eine neue Nummer bekommt.
 */

import type { CollectionName, Destination, DestinationType, Extension, PbxConfig } from './model'

const TYPES: Partial<Record<CollectionName, DestinationType[]>> = {
  extensions: ['extension', 'voicemail'],
  groups: ['group'],
  ivrs: ['ivr'],
  timeconditions: ['timecondition'],
  conferences: ['conference'],
  announcements: ['announcement'],
}

/** Alle Ziele der Konfiguration mit einer Beschreibung, wo sie stehen */
function destinations(cfg: PbxConfig): [string, Destination][] {
  return [
    ...cfg.inbound.map((r): [string, Destination] => [`Eingehende Regel „${r.name || r.number || 'alle Nummern'}“`, r.destination]),
    ...cfg.trunks.map((t): [string, Destination] => [`SIP-Konto „${t.name}“ (Standardziel)`, t.inbound_default]),
    ...cfg.groups.map((g): [string, Destination] => [`Gruppe „${g.name}“ (Ausweichziel)`, g.fallback]),
    ...cfg.ivrs.flatMap((i): [string, Destination][] => [
      ...i.options.map((o): [string, Destination] => [`Sprachmenü „${i.name}“, Taste ${o.digit}`, o.destination]),
      [`Sprachmenü „${i.name}“ (keine Eingabe)`, i.timeout_destination],
      [`Sprachmenü „${i.name}“ (falsche Eingabe)`, i.invalid_destination],
    ]),
    ...cfg.timeconditions.flatMap((t): [string, Destination][] => [
      [`Zeitsteuerung „${t.name}“ (geöffnet)`, t.open],
      [`Zeitsteuerung „${t.name}“ (geschlossen)`, t.closed],
    ]),
    ...cfg.announcements.map((a): [string, Destination] => [`Ansage „${a.name}“ (danach)`, a.next]),
  ]
}

/** Umleitungsziele einer Nebenstelle (Rufnummern) */
function forwardTargets(e: Extension): string[] {
  return [e.forward.busy, e.forward.noanswer, ...e.forward.rules.map((r) => r.target)]
}

/** Beschreibungen aller Stellen, die auf den Eintrag verweisen */
export function usages(cfg: PbxConfig, kind: CollectionName, id: string): string[] {
  const found: string[] = []
  const types = TYPES[kind] ?? []
  for (const [where, d] of destinations(cfg)) if (d && types.includes(d.type) && d.target === id) found.push(where)
  if (kind === 'extensions') {
    const ext = cfg.extensions.find((e) => e.id === id)
    if (ext) {
      for (const g of cfg.groups) if (g.members.includes(ext.number)) found.push(`Mitglied der Gruppe „${g.name}“`)
      for (const b of cfg.dect) if (b.handsets.includes(ext.number)) found.push(`Mobilteil an der DECT-Basis „${b.name}“`)
      for (const r of cfg.outbound) if (r.extensions.includes(ext.number)) found.push(`Ausgehende Regel „${r.name}“`)
      for (const e of cfg.extensions) {
        if (e.id !== id && forwardTargets(e).includes(ext.number)) found.push(`Weiterleitung von Nebenstelle ${e.number} (${e.name})`)
      }
    }
  }
  if (kind === 'trunks') {
    for (const r of cfg.outbound) if (r.trunks.includes(id)) found.push(`Ausgehende Regel „${r.name}“`)
    for (const r of cfg.inbound) if (r.trunk === id) found.push(`Eingehende Regel „${r.name || r.number || 'alle Nummern'}“`)
  }
  if (kind === 'appprofiles') {
    for (const e of cfg.extensions) if (e.app_profile === id) found.push(`Nebenstelle ${e.number} (${e.name})`)
  }
  return [...new Set(found)]
}

/** Neue Nummer einer Nebenstelle in Gruppen, Mobilteilen, Regeln und Weiterleitungen eintragen */
export function renumber(cfg: PbxConfig, from: string, to: string): void {
  const map = (n: string): string => (n === from ? to : n)
  for (const g of cfg.groups) g.members = g.members.map(map)
  for (const b of cfg.dect) b.handsets = b.handsets.map(map)
  for (const r of cfg.outbound) r.extensions = r.extensions.map(map)
  for (const e of cfg.extensions) {
    e.forward.busy = map(e.forward.busy)
    e.forward.noanswer = map(e.forward.noanswer)
    for (const r of e.forward.rules) r.target = map(r.target)
  }
}

/** Gelöschte Nebenstelle aus Regeln und Weiterleitungen nehmen (Gruppen/DECT macht der Store) */
export function forget(cfg: PbxConfig, number: string): void {
  for (const r of cfg.outbound) r.extensions = r.extensions.filter((n) => n !== number)
  for (const e of cfg.extensions) {
    if (e.forward.busy === number) e.forward.busy = ''
    if (e.forward.noanswer === number) e.forward.noanswer = ''
    e.forward.rules = e.forward.rules.filter((r) => r.target !== number)
  }
}
