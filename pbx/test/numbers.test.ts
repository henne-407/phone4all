import { describe, expect, it } from 'vitest'
import { cleanNumber, formatFor, isInternalNumber, prefixToE164, toE164 } from '../server/numbers'

describe('Rufnummern', () => {
  it('bereinigt Eingaben', () => {
    expect(cleanNumber(' +49 (30) 123-45/67 ')).toBe('+49301234567')
    expect(cleanNumber('*21 12')).toBe('*2112')
  })

  it('wandelt nach E.164', () => {
    expect(toE164('030 1234567', '49')).toBe('+49301234567')
    expect(toE164('0043 1 234', '49')).toBe('+431234')
    expect(toE164('1234567', '49', '30')).toBe('+49301234567')
    expect(toE164('110', '49', '30')).toBe('110')
    expect(toE164('10', '49', '30')).toBe('10')
  })

  it('formatiert für den Anbieter', () => {
    expect(formatFor('+49301234567', 'e164', '49')).toBe('+49301234567')
    expect(formatFor('+49301234567', 'e164_no_plus', '49')).toBe('49301234567')
    expect(formatFor('+49301234567', 'intl00', '49')).toBe('0049301234567')
    expect(formatFor('+49301234567', 'national', '49')).toBe('0301234567')
    expect(formatFor('+431234', 'national', '49')).toBe('00431234')
  })

  it('erkennt Präfixe und interne Nummern', () => {
    expect(prefixToE164('015', '49')).toBe('+4915')
    expect(prefixToE164('00', '49')).toBe('+')
    expect(isInternalNumber('10')).toBe(true)
    expect(isInternalNumber('0')).toBe(false)
    expect(isInternalNumber('0301')).toBe(false)
  })
})
