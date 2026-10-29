/** Zentrales Telefonbuch: Nebenstellen, Gruppen, Konferenzräume, Kontakte und externe Quellen. */

import type { PbxConfig } from './model'

export interface DirectoryEntry {
  /** Stabil je Eintrag, z. B. „ext-x1a2b“ oder „pb-x3c4d“ */
  id: string
  name: string
  company: string
  phone: string
  mobile: string
}

/** Kontakte aus externen Quellen (CardDAV, SQL …); setzt der Abgleich beim Start */
export const external = { entries: (): DirectoryEntry[] => [], revision: (): number => 0 }

/** Einträge in fester Reihenfolge; exclude = ID der eigenen Nebenstelle */
export function directory(cfg: PbxConfig, exclude = ''): DirectoryEntry[] {
  const own = cfg.system.name
  return [
    ...cfg.extensions
      .filter((e) => e.id !== exclude)
      .map((e) => ({ id: `ext-${e.id}`, name: e.name, company: own, phone: e.number, mobile: '' })),
    ...cfg.groups
      .filter((g) => g.number)
      .map((g) => ({ id: `grp-${g.id}`, name: g.name, company: `${own} · Gruppe`, phone: g.number, mobile: '' })),
    ...cfg.conferences.map((c) => ({ id: `conf-${c.id}`, name: c.name || `Konferenz ${c.number}`, company: `${own} · Konferenz`, phone: c.number, mobile: '' })),
    ...cfg.phonebook.map((p) => ({ id: `pb-${p.id}`, name: p.name, company: p.company, phone: p.phone, mobile: p.mobile })),
    ...external.entries(),
  ]
}
