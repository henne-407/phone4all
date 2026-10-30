import { describe, expect, it } from 'vitest'
import { groupCalls, parseCsvLine } from '../server/cdr'

describe('Anrufliste', () => {
  it('liest CSV mit Anführungszeichen', () => {
    expect(parseCsvLine('"a","b,c","d ""e"""')).toEqual(['a', 'b,c', 'd "e"'])
    expect(parseCsvLine('"x",,"y"')).toEqual(['x', '', 'y'])
  })
})

type Row = Parameters<typeof groupCalls>[0][number]

const row = (patch: Partial<Row>): Row => ({
  start: '2026-10-24 21:12:00',
  answer: '',
  end: '',
  duration: '5',
  billsec: '5',
  disposition: 'ANSWERED',
  src: '14',
  clid: '"OG Junior" <14>',
  dst: '',
  dcontext: 'p4a-internal',
  channel: 'PJSIP/14-00000001',
  dstchannel: '',
  uniqueid: '1.1',
  linkedid: '1.1',
  userfield: '',
  recordingfile: '',
  lastapp: 'Dial',
  p4a_to: '',
  ...patch,
})

describe('Anrufliste aus cdr.csv', () => {
  it('zeigt statt „s“ die Nebenstelle, die abgenommen hat', () => {
    const [c] = groupCalls([row({ dst: 's', dstchannel: 'PJSIP/12-00000002' })], [])
    expect(c.to).toBe('12')
    expect(c.answeredBy).toBe('12')
  })

  it('lässt das Ziel leer, wenn bei „s“ niemand abnimmt', () => {
    const [c] = groupCalls([row({ dst: 's', disposition: 'NO ANSWER', billsec: '0' })], [])
    expect(c.to).toBe('')
  })

  it('merkt sich bei Anrufen nach außen die Nebenstelle', () => {
    const [c] = groupCalls([row({ src: '02568527355', channel: 'PJSIP/15-00000003', dst: '0259123150161', userfield: 'out', dstchannel: 'PJSIP/trunk-t1-00000004' })], [])
    expect(c.direction).toBe('out')
    expect(c.from).toBe('02568527355')
    expect(c.ext).toBe('15')
  })
})
