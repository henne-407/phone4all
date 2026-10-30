import { describe, expect, it } from 'vitest'
import { callLegs, joinActions, joinRoom } from '../server/join'

const ch = (Channel: string, BridgeId: string, Uniqueid: string) => ({ Event: 'CoreShowChannel', Channel, BridgeId, Uniqueid })

describe('Rückfrage zusammenführen', () => {
  const channels = [
    ch('PJSIP/trunk-x1-00000001', 'b1', '1700000000.1'),
    ch('PJSIP/10-00000002', 'b1', '1700000000.2'),
    ch('PJSIP/10-app-00000004', 'b2', '1700000010.4'),
    ch('PJSIP/11-00000003', 'b2', '1700000010.3'),
    ch('PJSIP/100-00000005', 'b3', '1700000020.5'),
    ch('PJSIP/12-00000006', 'b3', '1700000020.6'),
  ]

  it('findet die Gespräche der Nebenstelle (Telefon und App), nicht die von 100', () => {
    expect(callLegs(channels, '10')).toEqual([
      { own: 'PJSIP/10-00000002', peer: 'PJSIP/trunk-x1-00000001' },
      { own: 'PJSIP/10-app-00000004', peer: 'PJSIP/11-00000003' },
    ])
  })

  it('verbindet die Gegenüber oder holt alle in eine Konferenz', () => {
    const legs = callLegs(channels, '10')
    expect(joinActions('transfer', legs, 'r')).toEqual([{ Action: 'Bridge', Channel1: 'PJSIP/trunk-x1-00000001', Channel2: 'PJSIP/11-00000003', Tone: 'no' }])
    const conf = joinActions('conference', legs, '100123')
    expect(conf[0]).toMatchObject({ Action: 'Redirect', Channel: 'PJSIP/trunk-x1-00000001', ExtraChannel: 'PJSIP/10-00000002', Exten: '100123' })
    expect(conf[1]).toMatchObject({ Action: 'Redirect', Channel: 'PJSIP/11-00000003' })
    expect(conf[2]).toEqual({ Action: 'Hangup', Channel: 'PJSIP/10-app-00000004' })
    expect(() => joinActions('conference', legs.slice(0, 1), 'r')).toThrow(/zwei Gespräche/)
    expect(joinRoom('10', 1234567890123)).toMatch(/^100\d+$/)
  })
})
