/** Ziele im Wählplan: Ein Ziel wird zu „Kontext^Extension“ (Priorität immer 1). */

import type { Destination, PbxConfig } from './model'
import { cleanNumber } from './numbers'

export const HANGUP_TARGET = 'p4a-hangup^s'

export function destTarget(cfg: PbxConfig, dest: Destination | undefined): string {
  if (!dest) return HANGUP_TARGET
  const t = dest.target
  switch (dest.type) {
    case 'extension': {
      const ext = cfg.extensions.find((e) => e.id === t)
      return ext ? `p4a-local^${ext.number}` : HANGUP_TARGET
    }
    case 'voicemail': {
      const ext = cfg.extensions.find((e) => e.id === t)
      return ext?.voicemail.enabled ? `p4a-vmu^${ext.number}` : HANGUP_TARGET
    }
    case 'group':
      return cfg.groups.some((g) => g.id === t) ? `p4a-group^${t}` : HANGUP_TARGET
    case 'ivr':
      return cfg.ivrs.some((i) => i.id === t) ? `p4a-ivr-${t}^s` : HANGUP_TARGET
    case 'timecondition':
      return cfg.timeconditions.some((c) => c.id === t) ? `p4a-tc^${t}` : HANGUP_TARGET
    case 'conference': {
      const conf = cfg.conferences.find((c) => c.id === t)
      return conf ? `p4a-conf^${conf.number}` : HANGUP_TARGET
    }
    case 'announcement':
      return cfg.announcements.some((a) => a.id === t) ? `p4a-ann-${t}^s` : HANGUP_TARGET
    case 'fax':
      return cfg.faxes.some((f) => f.id === t) ? `p4a-fax^${t}` : HANGUP_TARGET
    case 'external': {
      const n = cleanNumber(t)
      return n ? `p4a-fwd^${n}` : HANGUP_TARGET
    }
    default:
      return HANGUP_TARGET
  }
}

/** Ziel als Goto-Argumente für den Wählplan */
export function gotoArgs(target: string): string {
  const [ctx, exten] = target.split('^')
  return `${ctx},${exten},1`
}
