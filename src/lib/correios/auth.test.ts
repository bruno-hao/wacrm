import { describe, expect, it } from 'vitest'
import { extractCorreiosApiToken, isCorreiosApiToken } from './auth'

describe('isCorreiosApiToken', () => {
  it('recognizes CWS API access keys', () => {
    expect(isCorreiosApiToken('cws-ch1_example')).toBe(true)
    expect(isCorreiosApiToken('portal-password')).toBe(false)
  })

  it('recovers a CWS key stored in either legacy credential field', () => {
    expect(extractCorreiosApiToken('legacy-user', 'cws-ch1_example')).toBe('cws-ch1_example')
  })
})
