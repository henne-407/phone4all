/**
 * Rückfrage abschließen: Eine Nebenstelle hat zwei Gespräche (eines davon meist gehalten).
 * „transfer“ verbindet die beiden Gegenüber miteinander (die Nebenstelle ist danach frei),
 * „conference“ holt alle drei in eine Konferenz. Das macht die Anlage über das AMI, damit
 * es mit jedem Telefon und jeder App gleich funktioniert.
 */

import type { AmiMessage } from './ami'

export interface CallLeg {
  /** Kanal der Nebenstelle (PJSIP/10-00000012 oder PJSIP/10-app-…) */
  own: string
  /** Kanal des Gegenübers in derselben Brücke */
  peer: string
}

export class JoinError extends Error {}

/** Gespräche der Nebenstelle aus CoreShowChannels: eigener Kanal und Gegenüber, ältestes zuerst */
export function callLegs(channels: AmiMessage[], ext: string): CallLeg[] {
  const mine = new RegExp(`^PJSIP/${ext}(-app)?-[0-9a-f]{8}$`)
  const legs: { leg: CallLeg; id: string }[] = []
  for (const c of channels) {
    if (!mine.test(c.Channel ?? '') || !c.BridgeId) continue
    const peer = channels.find((p) => p.BridgeId === c.BridgeId && p.Channel !== c.Channel)
    if (peer) legs.push({ leg: { own: c.Channel, peer: peer.Channel }, id: c.Uniqueid ?? '' })
  }
  return legs.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })).map((l) => l.leg)
}

/** Konferenzraum für die Dreierkonferenz (nur Ziffern, damit er im Wählplan passt) */
export function joinRoom(ext: string, now = Date.now()): string {
  return `${ext}0${now % 1e8}`
}

/** AMI-Aktionen für das Zusammenführen */
export function joinActions(mode: 'transfer' | 'conference', legs: CallLeg[], room: string): Record<string, string>[] {
  if (legs.length !== 2) throw new JoinError(legs.length < 2 ? 'Dafür braucht es zwei Gespräche (Rückfrage).' : 'Es laufen mehr als zwei Gespräche.')
  const [a, b] = legs
  if (mode === 'transfer') return [{ Action: 'Bridge', Channel1: a.peer, Channel2: b.peer, Tone: 'no' }]
  return [
    // Erstes Gespräch samt eigenem Kanal, dann das zweite Gegenüber; der zweite eigene Kanal legt danach auf
    { Action: 'Redirect', Channel: a.peer, ExtraChannel: a.own, Context: 'p4a-join', Exten: room, Priority: '1', ExtraContext: 'p4a-join', ExtraExten: room, ExtraPriority: '1' },
    { Action: 'Redirect', Channel: b.peer, Context: 'p4a-join', Exten: room, Priority: '1' },
    { Action: 'Hangup', Channel: b.own },
  ]
}
