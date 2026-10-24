/**
 * Laufende Gespräche lesbar machen: Wer ruft wen an? Asterisk liefert je Gespräch
 * mehrere Kanäle; Rufnummern stehen je nach Richtung an verschiedenen Stellen, und
 * fehlende Angaben kommen als „<unknown>“.
 */

import type { AmiMessage } from './ami'

export interface CallParties {
  from: string
  fromName: string
  to: string
  toName: string
}

/** Leere und „<unknown>“-Angaben von Asterisk → '' */
export function clean(value: string | undefined): string {
  const v = (value ?? '').trim()
  return v === '<unknown>' || v === '<Unknown>' ? '' : v
}

/** PJSIP/10-00000001 → 10, PJSIP/trunk-t1-0000000a → trunk-t1 */
function endpoint(channel: string): string {
  return /^PJSIP\/(.+)-[0-9a-f]+$/.exec(channel)?.[1] ?? ''
}

const isTrunk = (ch: AmiMessage): boolean => endpoint(ch.Channel ?? '').startsWith('trunk-')

/** Gewählte Nummer aus Dial(PJSIP/<nummer>@trunk-…) */
function dialedNumber(ch: AmiMessage): string {
  return /PJSIP\/([^@&,]+)@trunk-/.exec(ch.ApplicationData ?? '')?.[1] ?? ''
}

export function callParties(channels: AmiMessage[]): CallParties {
  const origin = channels.find((c) => c.Uniqueid && c.Uniqueid === c.Linkedid) ?? channels[0]
  const others = channels.filter((c) => c !== origin)

  let from = ''
  let fromName = ''
  if (isTrunk(origin)) {
    // Von außen: die Anlage hat die Nummer des Anrufers bereits aufbereitet
    from = clean(origin.CallerIDNum)
    fromName = clean(origin.CallerIDName)
  } else {
    // Intern: die Nebenstelle steht im Kanalnamen (die Rufnummer kann schon auf die
    // ausgehende Nummer der Firma umgestellt sein)
    from = endpoint(origin.Channel ?? '') || clean(origin.CallerIDNum)
  }

  const targets: { num: string; name: string }[] = []
  for (const c of others) {
    if (isTrunk(c)) {
      targets.push({ num: dialedNumber(origin) || clean(c.CallerIDNum) || clean(c.ConnectedLineNum), name: '' })
    } else {
      const ep = endpoint(c.Channel ?? '')
      if (ep) targets.push({ num: ep, name: '' })
    }
  }
  if (!targets.length) {
    // Noch niemand verbunden: gewählte Nummer aus dem Wählplan
    const num = dialedNumber(origin) || (/^[+\d*#]+$/.test(origin.Exten ?? '') ? origin.Exten! : '') || clean(origin.ConnectedLineNum)
    if (num) targets.push({ num, name: clean(origin.ConnectedLineName) })
  }
  const seen = new Set<string>()
  const unique = targets.filter((t) => t.num && !seen.has(t.num) && seen.add(t.num))
  return {
    from,
    fromName,
    to: unique.map((t) => t.num).join(', '),
    toName: unique.length === 1 ? unique[0].name : '',
  }
}
