import { describe, expect, it } from 'vitest'
import { canonicalPhone, customerPhones, isNewer } from './sync'

describe('canonicalPhone', () => {
  it('adds country code and the ninth digit', () => {
    expect(canonicalPhone('(73) 9.8239-5770')).toBe('5573982395770')
    expect(canonicalPhone('(73) 8239-5770')).toBe('5573982395770')
    expect(canonicalPhone('557382395770')).toBe('5573982395770')
    expect(canonicalPhone('+55 (73) 98239-5770')).toBe('5573982395770')
  })
  it('keeps landlines and ignores numbers with no DDD', () => {
    expect(canonicalPhone('(73) 3216-1234')).toBe('557332161234')
    expect(canonicalPhone('98239-5770')).toBeNull()
    expect(canonicalPhone('')).toBeNull()
  })
})

describe('customerPhones', () => {
  it('reads string and object phones, de-duplicated', () => {
    expect(
      customerPhones({
        id: 1,
        telefones: ['(73) 9.8239-5770', { numero: '(73) 8239-5770' }, { numero: null }],
      }),
    ).toEqual(['5573982395770'])
  })
})

describe('isNewer', () => {
  it('prefers the later date, then the higher number', () => {
    expect(isNewer(null, null, '2026-01-01', '1')).toBe(true)
    expect(isNewer('2026-02-01', '5', '2026-01-01', '9')).toBe(false)
    expect(isNewer('2026-01-01', '5', '2026-01-01', '6')).toBe(true)
    expect(isNewer('2026-01-01', '5', null, '6')).toBe(false)
  })
})
