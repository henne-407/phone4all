/**
 * Besetztanzeige für die Apps: Zustand jeder Nebenstelle (frei, klingelt, spricht,
 * nicht erreichbar) aus den Hints von Asterisk und geparkte Gespräche. Die Apps fragen
 * den Stand unter /provision/<token>/presence ab; `revision` ändert sich bei jeder
 * Änderung, damit eine Abfrage ohne Änderung nur wenige Bytes kostet.
 */

import { EventEmitter } from 'node:events'
import type { AmiMessage } from './ami'
import type { PbxConfig } from './model'
import { activeForward, isLocalNumber, type RuntimeState } from './routing'

/** Zustand für die Anzeige; dnd und forward kommen aus der Anlage dazu */
export type LineState = 'idle' | 'ringing' | 'busy' | 'offline'

export interface TeamMember {
  number: string
  name: string
  state: LineState
  dnd: boolean
  /** Umleitung aktiv: interne Nummer oder „extern“, leer = keine */
  forward: string
}

export interface ParkedCall {
  /** Parkplatz, zum Zurückholen wählen */
  slot: string
  number: string
  name: string
  /** Nebenstelle, die geparkt hat */
  by: string
  /** Geparkt seit (ms) */
  since: number
  /** Klingelt wieder beim Parkenden um (ms) */
  until: number
}

export interface PresenceView {
  revision: string
  extensions: TeamMember[]
  parked: ParkedCall[]
}

/** Status der Hints (ExtensionStatus) → Anzeige. Bitmaske: 1 in Benutzung, 2 besetzt, 4 nicht erreichbar, 8 klingelt, 16 gehalten */
export function lineState(status: number): LineState {
  if (status < 0 || status & 4) return 'offline'
  if (status & (1 | 2 | 16)) return 'busy'
  if (status & 8) return 'ringing'
  return 'idle'
}

export class Presence extends EventEmitter {
  private states = new Map<string, number>()
  private parkedCalls = new Map<string, ParkedCall>()
  private seq = 0

  constructor(private now: () => number = Date.now) {
    super()
  }

  private changed(): void {
    this.seq++
    this.emit('changed')
  }

  /** Ereignisse von Asterisk (ExtensionStatus, ParkedCall …) */
  onAmi(e: AmiMessage): void {
    switch (e.Event) {
      case 'ExtensionStatus': {
        if (e.Context !== 'p4a-local' || !e.Exten) return
        const status = Number(e.Status)
        if (this.states.get(e.Exten) === status) return
        this.states.set(e.Exten, status)
        this.changed()
        return
      }
      case 'ParkedCall': {
        const slot = e.ParkingSpace ?? ''
        if (!slot) return
        const duration = Number(e.ParkingDuration) || 0
        const timeout = Number(e.ParkingTimeout) || 0
        const since = this.now() - duration * 1000
        this.parkedCalls.set(slot, {
          slot,
          number: clean(e.ParkeeCallerIDNum),
          name: clean(e.ParkeeCallerIDName),
          // Rückruf-Adresse des Parkenden, z. B. „PJSIP/10“ oder „PJSIP/10-app“
          by: /^PJSIP\/(\d+)/.exec(e.ParkerDialString ?? '')?.[1] ?? '',
          since,
          until: since + timeout * 1000,
        })
        this.changed()
        return
      }
      case 'UnParkedCall':
      case 'ParkedCallTimeOut':
      case 'ParkedCallGiveUp':
      case 'ParkedCallSwap': {
        const slot = e.ParkingSpace ?? ''
        if (!slot || !this.parkedCalls.delete(slot)) return
        this.changed()
        return
      }
    }
  }

  /** Nach dem (Neu-)Verbinden mit Asterisk: alles neu einlesen */
  load(states: AmiMessage[], parked: AmiMessage[]): void {
    this.states.clear()
    this.parkedCalls.clear()
    for (const s of states) if (s.Context === 'p4a-local' && s.Exten) this.states.set(s.Exten, Number(s.Status))
    for (const p of parked) this.onAmi({ ...p, Event: 'ParkedCall' })
    this.changed()
  }

  /** Verbindung zu Asterisk verloren: nichts ist mehr bekannt */
  reset(): void {
    if (!this.states.size && !this.parkedCalls.size) return
    this.states.clear()
    this.parkedCalls.clear()
    this.changed()
  }

  /** Stand für die Apps; Nicht stören und Umleitungen kommen aus der Anlage */
  view(cfg: PbxConfig, state: RuntimeState): PresenceView {
    const extensions = cfg.extensions
      .map((e): TeamMember => {
        // Externe Ziele (z. B. private Handynummern) sehen die Kollegen nicht
        const fwd = activeForward(cfg, state, e.number)
        return {
          number: e.number,
          name: e.name,
          state: lineState(this.states.get(e.number) ?? -1),
          dnd: Boolean(state.dnd[e.number]),
          forward: fwd && !isLocalNumber(cfg, fwd) ? 'extern' : fwd,
        }
      })
      .sort((a, b) => a.number.localeCompare(b.number, 'de', { numeric: true }))
    const parked = [...this.parkedCalls.values()].sort((a, b) => a.slot.localeCompare(b.slot, 'de', { numeric: true }))
    // DND und Umleitungen ändern sich ohne Ereignis von Asterisk: in die Revision einrechnen
    const extra = extensions.map((e) => `${e.number}${e.dnd ? 'd' : ''}${e.forward}`).join(',')
    return { revision: `${this.seq}-${hash(extra)}`, extensions, parked }
  }
}

function clean(v: string | undefined): string {
  const s = (v ?? '').trim()
  return s === '<unknown>' || s === '<Unknown>' ? '' : s
}

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
