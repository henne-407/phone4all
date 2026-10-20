import { describe, expect, it } from 'vitest'
import { parseCsvLine } from '../server/cdr'

describe('Anrufliste', () => {
  it('liest CSV mit Anführungszeichen', () => {
    expect(parseCsvLine('"a","b,c","d ""e"""')).toEqual(['a', 'b,c', 'd "e"'])
    expect(parseCsvLine('"x",,"y"')).toEqual(['x', '', 'y'])
  })
})
