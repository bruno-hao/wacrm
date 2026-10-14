import { afterEach, describe, expect, it, vi } from 'vitest'
import { transcribeAudio, transcriptionEndpoint, transcriptionSupported } from './transcribe'

vi.mock('@/lib/webhooks/ssrf', () => ({
  isDeliverableUrl: vi.fn().mockResolvedValue(true),
}))

const base = {
  apiKey: 'k',
  transcriptionModel: 'whisper-large-v3-turbo',
}

afterEach(() => vi.unstubAllGlobals())

describe('transcriptionEndpoint', () => {
  it('derives the audio endpoint from an OpenAI-compatible base URL', () => {
    expect(
      transcriptionEndpoint({
        provider: 'openai_compatible',
        baseUrl: 'https://api.groq.com/openai/v1',
      }),
    ).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect(
      transcriptionEndpoint({
        provider: 'openai_compatible',
        baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
      }),
    ).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
  })

  it('uses OpenAI for the openai provider and nothing for anthropic', () => {
    expect(transcriptionEndpoint({ provider: 'openai', baseUrl: null })).toBe(
      'https://api.openai.com/v1/audio/transcriptions',
    )
    expect(transcriptionEndpoint({ provider: 'anthropic', baseUrl: null })).toBeNull()
    expect(transcriptionSupported('anthropic')).toBe(false)
  })
})

describe('transcribeAudio', () => {
  const config = {
    ...base,
    provider: 'openai_compatible' as const,
    baseUrl: 'https://api.groq.com/openai/v1',
  }

  it('posts the file + model and returns the trimmed text', async () => {
    const fn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ text: '  olá, tudo bem?  ' })))
    vi.stubGlobal('fetch', fn)

    const out = await transcribeAudio({
      config,
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/ogg; codecs=opus',
    })

    expect(out).toBe('olá, tudo bem?')
    const [url, init] = fn.mock.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect(init.headers.Authorization).toBe('Bearer k')
    expect((init.body as FormData).get('model')).toBe('whisper-large-v3-turbo')
  })

  it('returns null (never throws) on HTTP errors, network errors and empty text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 401 })))
    expect(await transcribeAudio({ config, bytes: new Uint8Array([1]) })).toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    expect(await transcribeAudio({ config, bytes: new Uint8Array([1]) })).toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"text":"  "}')))
    expect(await transcribeAudio({ config, bytes: new Uint8Array([1]) })).toBeNull()
  })

  it('does nothing for providers without audio support', async () => {
    const fn = vi.fn()
    vi.stubGlobal('fetch', fn)
    const out = await transcribeAudio({
      config: { ...base, provider: 'anthropic', baseUrl: null },
      bytes: new Uint8Array([1]),
    })
    expect(out).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })
})
