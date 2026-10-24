import { describe, expect, it } from 'vitest'
import { callParties, clean } from '../server/calls'

const ch = (fields: Record<string, string>): Record<string, string> => ({ Event: 'CoreShowChannel', ...fields })

describe('Laufende Gespräche', () => {
  it('ersetzt <unknown>', () => {
    expect(clean('<unknown>')).toBe('')
    expect(clean(' 030123 ')).toBe('030123')
  })

  it('zeigt bei ausgehenden Anrufen die gewählte Nummer', () => {
    // Die Anlage stellt die Rufnummer der Nebenstelle auf die Firmennummer um,
    // der Anbieter liefert keine verbundene Nummer zurück
    const origin = ch({
      Channel: 'PJSIP/10-00000001',
      Uniqueid: '1.1',
      Linkedid: '1.1',
      CallerIDNum: '+49301234567',
      ConnectedLineNum: '<unknown>',
      Application: 'Dial',
      ApplicationData: 'PJSIP/01701234567@trunk-t1,,Tt',
      Exten: 's',
    })
    const trunk = ch({ Channel: 'PJSIP/trunk-t1-00000002', Uniqueid: '1.2', Linkedid: '1.1', CallerIDNum: '<unknown>', ConnectedLineNum: '10' })
    expect(callParties([origin, trunk])).toEqual({ from: '10', fromName: '', to: '01701234567', toName: '' })
    // Klingelt noch: nur der Kanal der Nebenstelle
    expect(callParties([origin]).to).toBe('01701234567')
  })

  it('zeigt bei eingehenden Anrufen den Anrufer und die Nebenstellen', () => {
    const origin = ch({ Channel: 'PJSIP/trunk-t1-00000003', Uniqueid: '2.1', Linkedid: '2.1', CallerIDNum: '01701234567', CallerIDName: 'Max Muster', Exten: 's' })
    const a = ch({ Channel: 'PJSIP/10-00000004', Uniqueid: '2.2', Linkedid: '2.1', CallerIDNum: '01701234567' })
    const b = ch({ Channel: 'PJSIP/11-00000005', Uniqueid: '2.3', Linkedid: '2.1', CallerIDNum: '01701234567' })
    expect(callParties([a, origin, b])).toEqual({ from: '01701234567', fromName: 'Max Muster', to: '10, 11', toName: '' })
    expect(callParties([origin]).to).toBe('')
  })

  it('zeigt interne Gespräche mit Nebenstellen', () => {
    const origin = ch({ Channel: 'PJSIP/10-00000006', Uniqueid: '3.1', Linkedid: '3.1', CallerIDNum: '10', Exten: '11' })
    expect(callParties([origin]).to).toBe('11')
    const callee = ch({ Channel: 'PJSIP/11-00000007', Uniqueid: '3.2', Linkedid: '3.1', CallerIDNum: '10' })
    expect(callParties([origin, callee])).toMatchObject({ from: '10', to: '11' })
  })
})
