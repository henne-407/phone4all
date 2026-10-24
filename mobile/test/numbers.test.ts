import { describe, expect, it } from 'vitest'
import { cleanNumber, findName, formatDuration, matchKey, numberFromUri } from '../src/numbers'

describe('Rufnummern', () => {
  it('bereinigt Eingaben zum Wählen', () => {
    expect(cleanNumber(' (030) 123-45 67 ')).toBe('0301234567')
    expect(cleanNumber('+49 30 1234+5')).toBe('+493012345')
    expect(cleanNumber('*21#')).toBe('*21#')
    expect(cleanNumber('tel:+4930')).toBe('+4930')
  })

  it('liest die Nummer aus SIP-Adressen', () => {
    expect(numberFromUri('sip:0301234@telefon.example.de')).toBe('0301234')
    expect(numberFromUri('sip:%2B4930@x;transport=ws')).toBe('+4930')
  })

  it('ordnet Namen über verschiedene Schreibweisen zu', () => {
    const book = [
      { name: 'Anna', numbers: ['11'] },
      { name: 'Praxis', numbers: ['+49 30 1234567'] },
    ]
    expect(matchKey('030/1234567')).toBe(matchKey('+49301234567'))
    expect(findName('030 1234567', book)).toBe('Praxis')
    expect(findName('0049301234567', book)).toBe('Praxis')
    expect(findName('11', book)).toBe('Anna')
    expect(findName('111', book)).toBe('')
  })

  it('formatiert die Dauer', () => {
    expect(formatDuration(5)).toBe('0:05')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3725)).toBe('1:02:05')
  })
})
