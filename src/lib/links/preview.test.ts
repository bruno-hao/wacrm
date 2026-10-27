import { describe, expect, it } from 'vitest'
import { extractFirstUrl, parseOpenGraph } from './preview'

describe('link preview helpers', () => {
  it('extracts the first http(s) URL from message text', () => {
    expect(extractFirstUrl('Veja https://example.com/oferta agora')).toBe('https://example.com/oferta')
    expect(extractFirstUrl('sem link')).toBeNull()
  })

  it('reads basic Open Graph metadata without requiring a DOM', () => {
    expect(parseOpenGraph('<meta property="og:title" content="Oferta M Vision"><meta property="og:image" content="https://cdn.test/thumb.jpg">')).toEqual({ title: 'Oferta M Vision', image: 'https://cdn.test/thumb.jpg' })
  })
})
