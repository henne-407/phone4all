/**
 * Verpasste Gruppenanrufe gemeinsam abarbeiten: Ruft jemand eine Gruppe an und niemand
 * nimmt ab, steht der Anruf in der Liste aller Mitglieder. Einer übernimmt ihn („ich rufe
 * zurück“), ein Rückruf oder ein späterer angenommener Anruf derselben Nummer hakt ihn ab.
 */

import { loadJson, saveJson } from './files'
import type { PbxConfig } from './model'
import { sameNumber } from './routing'

export interface GroupMissed {
  /** Kennung des Anrufs (Linkedid) und Gruppe */
  id: string
  group: string
  number: string
  name: string
  /** ms */
  time: number
  /** Nebenstelle, die sich kümmert ('' = niemand) */
  claimed_by: string
  claimed_at: number
  /** Erledigt von ('' = offen); „Verwaltung“ aus der Weboberfläche */
  done_by: string
  done_at: number
  /** callback: zurückgerufen · answered: Anrufer kam wieder durch · manual: abgehakt */
  done_how: '' | 'callback' | 'answered' | 'manual'
}

export type MissedAction = 'claim' | 'release' | 'done' | 'reopen'

/** Erledigte Einträge so lange zeigen, offene so lange behalten */
const KEEP_DONE = 7 * 86400000
const KEEP_OPEN = 30 * 86400000
const MAX = 1000

export class MissedList {
  entries: GroupMissed[]
  revision = 1

  constructor(
    private file: string,
    private now: () => number = Date.now,
  ) {
    this.entries = loadJson<GroupMissed[]>(file, []).filter((e) => e && typeof e.id === 'string')
  }

  private save(): void {
    const now = this.now()
    this.entries = this.entries
      .filter((e) => now - e.time < (e.done_by ? KEEP_DONE : KEEP_OPEN))
      .sort((a, b) => b.time - a.time)
      .slice(0, MAX)
    this.revision++
    saveJson(this.file, this.entries)
  }

  /** Verpasster Anruf in Gruppen mit gemeinsamer Liste */
  add(cfg: PbxConfig, call: string, groups: string[], number: string, name: string): void {
    const list = groups.filter((id) => cfg.groups.find((g) => g.id === id)?.missed_list)
    if (!list.length) return
    for (const group of list) {
      if (this.entries.some((e) => e.id === call && e.group === group)) continue
      this.entries.push({ id: call, group, number, name, time: this.now(), claimed_by: '', claimed_at: 0, done_by: '', done_at: 0, done_how: '' })
    }
    this.save()
  }

  /** Rückruf oder angenommener Anruf dieser Nummer: offene Einträge abhaken */
  resolve(cfg: PbxConfig, number: string, by: string, how: 'callback' | 'answered'): void {
    if (!/\d{3,}/.test(number)) return
    let changed = false
    for (const e of this.entries) {
      if (e.done_by || !sameNumber(e.number, number, cfg)) continue
      Object.assign(e, { done_by: by || 'Anlage', done_at: this.now(), done_how: how })
      changed = true
    }
    if (changed) this.save()
  }

  /** Einträge der Gruppen, in denen die Nebenstelle Mitglied ist (leer = alle Gruppen) */
  visible(cfg: PbxConfig, ext = ''): GroupMissed[] {
    const groups = new Set(cfg.groups.filter((g) => g.missed_list && (!ext || g.members.includes(ext))).map((g) => g.id))
    return this.entries.filter((e) => groups.has(e.group))
  }

  open(cfg: PbxConfig, ext: string): number {
    return this.visible(cfg, ext).filter((e) => !e.done_by).length
  }

  /** Übernehmen, freigeben, abhaken, wieder öffnen; gibt false zurück, wenn es den Eintrag nicht gibt */
  act(cfg: PbxConfig, id: string, group: string, action: MissedAction, by: string, ext = ''): boolean {
    const e = this.visible(cfg, ext).find((x) => x.id === id && x.group === group)
    if (!e) return false
    const now = this.now()
    if (action === 'claim') Object.assign(e, { claimed_by: by, claimed_at: now })
    else if (action === 'release') Object.assign(e, { claimed_by: '', claimed_at: 0 })
    else if (action === 'done') Object.assign(e, { done_by: by, done_at: now, done_how: 'manual' })
    else Object.assign(e, { done_by: '', done_at: 0, done_how: '' })
    this.save()
    return true
  }

  /** Neue Nummer einer Nebenstelle */
  renumber(from: string, to: string): void {
    for (const e of this.entries) {
      if (e.claimed_by === from) e.claimed_by = to
      if (e.done_by === from) e.done_by = to
    }
    this.save()
  }
}
