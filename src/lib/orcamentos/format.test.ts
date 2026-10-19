import { describe, expect, it } from 'vitest'
import { firstName, formatQuoteNumber, titleCaseName } from './format'

describe('orçamento display formatting', () => {
  it('pads numbers below 1000 with leading zeros', () => {
    expect(formatQuoteNumber('149')).toBe('0149')
    expect(formatQuoteNumber(7)).toBe('0007')
    expect(formatQuoteNumber('1264')).toBe('1264')
  })
  it('capitalises names but keeps de/da/do/das/dos/e lowercase', () => {
    expect(titleCaseName('MARIA DA SILVA')).toBe('Maria da Silva')
    expect(titleCaseName('joão DE oliveira dos santos')).toBe('João de Oliveira dos Santos')
    expect(titleCaseName('  ana   e  paula ')).toBe('Ana e Paula')
  })
  it('keeps the first name only', () => {
    expect(firstName('INGRID SILVA DE JESUS')).toBe('Ingrid')
    expect(firstName(null)).toBe('')
  })
})
