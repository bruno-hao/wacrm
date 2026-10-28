import { describe, expect, it } from 'vitest'
import { isCorreiosApiToken } from './auth'

describe('isCorreiosApiToken', () => {
  it('recognizes CWS API access keys', () => {
    expect(isCorreiosApiToken('cws-ch1_example')).toBe(true)
    expect(isCorreiosApiToken('portal-password')).toBe(false)
  })
})
