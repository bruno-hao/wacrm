import { afterEach, describe, expect, it, vi } from 'vitest'
import { generatePrescriptionReading } from './prescription'

vi.mock('@/lib/webhooks/ssrf', () => ({ isDeliverableUrl: vi.fn().mockResolvedValue(true) }))

afterEach(() => vi.unstubAllGlobals())

describe('generatePrescriptionReading', () => {
  it('sends image content to an OpenAI-compatible vision model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'Paciente: Maria' } }],
      usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await generatePrescriptionReading({
      config: { provider: 'openai_compatible', baseUrl: 'https://api.example.com/v1', apiKey: 'k' },
      model: 'vision-model', prompt: 'Leia a receita', bytes: new Uint8Array([1, 2]), mimeType: 'image/jpeg',
    })
    expect(result.text).toBe('Paciente: Maria')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.model).toBe('vision-model')
    expect(body.messages[1].content[1].type).toBe('image_url')
  })

  it('rejects oversized images before calling the provider', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(generatePrescriptionReading({
      config: { provider: 'openai', baseUrl: null, apiKey: 'k' },
      model: 'vision-model', prompt: 'Leia', bytes: new Uint8Array(8 * 1024 * 1024 + 1),
    })).rejects.toMatchObject({ code: 'image_too_large' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
