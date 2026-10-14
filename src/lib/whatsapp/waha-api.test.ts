import { describe, expect, it } from 'vitest'
import {
  chatIdFromPhone,
  encodeWahaCreds,
  isWahaTarget,
  parseWahaCreds,
  renderInteractiveAsText,
  wahaPhoneNumberId,
} from './waha-api'

describe('waha-api addressing', () => {
  it('tags WAHA accounts through the synthetic phone_number_id', () => {
    expect(isWahaTarget(wahaPhoneNumberId('abc'))).toBe(true)
    expect(isWahaTarget('123456789012345')).toBe(false)
    expect(isWahaTarget(null)).toBe(false)
  })

  it('round-trips credentials and trims the trailing slash', () => {
    const enc = encodeWahaCreds({
      baseUrl: 'http://waha-crm:3000/',
      apiKey: 'k',
      session: 'default',
    })
    expect(parseWahaCreds(enc)).toEqual({
      baseUrl: 'http://waha-crm:3000',
      apiKey: 'k',
      session: 'default',
    })
  })

  it('rejects malformed credentials', () => {
    expect(() => parseWahaCreds('not json')).toThrow()
    expect(() => parseWahaCreds('{"u":"http://x"}')).toThrow()
  })

  it('builds a chat id from a formatted phone number', () => {
    expect(chatIdFromPhone('+55 71 99999-0000')).toBe('5571999990000@c.us')
    expect(chatIdFromPhone('5571999990000@c.us')).toBe('5571999990000@c.us')
    expect(() => chatIdFromPhone('abc')).toThrow()
  })
})

describe('renderInteractiveAsText', () => {
  it('numbers the options so the customer can answer with a digit', () => {
    const text = renderInteractiveAsText({
      bodyText: 'Como posso ajudar?',
      headerText: 'Menu',
      footerText: 'Responda com o número',
      options: [{ title: 'Vendas' }, { title: 'Suporte', description: '24h' }],
    })
    expect(text).toContain('1. Vendas')
    expect(text).toContain('2. Suporte — 24h')
    expect(text.startsWith('*Menu*')).toBe(true)
  })
})
