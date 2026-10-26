import { AiError, type AiConfig, type AiUsage } from './types'
import { MAX_OUTPUT_TOKENS, aiRequestTimeoutMs } from './defaults'
import { normalizeOpenAiCompatibleBaseUrl, allowedPrivateHosts } from './providers/openai-compatible'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import { normalizeUsage, providerHttpError, toNetworkError } from './providers/shared'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export async function generatePrescriptionReading(args: {
  config: Pick<AiConfig, 'provider' | 'baseUrl' | 'apiKey'>
  model: string
  prompt: string
  bytes: ArrayBuffer | Uint8Array
  mimeType?: string | null
}): Promise<{ text: string; usage: AiUsage | null }> {
  if (args.bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new AiError('Prescription image is too large', { code: 'image_too_large', status: 413 })
  }
  const mime = (args.mimeType || 'image/jpeg').split(';')[0].trim()
  const bytes = args.bytes instanceof ArrayBuffer ? new Uint8Array(args.bytes) : args.bytes
  const base64 = Buffer.from(bytes).toString('base64')
  const dataUrl = `data:${mime};base64,${base64}`
  const timeoutMs = aiRequestTimeoutMs()
  try {
    if (args.config.provider === 'anthropic') {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': args.config.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: args.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: 'Leia a imagem com segurança. Não faça diagnóstico nem recomendação clínica.',
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
            { type: 'text', text: args.prompt },
          ] }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) throw await providerHttpError('Anthropic', res)
      const data = (await res.json()) as { content?: { type?: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }
      const text = data.content?.filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim()
      if (!text) throw new AiError('Empty prescription reading', { code: 'empty_response' })
      return { text, usage: normalizeUsage({ prompt: data.usage?.input_tokens, completion: data.usage?.output_tokens }) }
    }
    const endpoint = args.config.provider === 'openai'
      ? OPENAI_URL
      : normalizeOpenAiCompatibleBaseUrl(args.config.baseUrl ?? '')
    if (args.config.provider === 'openai_compatible' && !(await isDeliverableUrl(endpoint, { allowPrivateHosts: allowedPrivateHosts() }))) {
      throw new AiError('Provider URL blocked', { code: 'blocked_url', status: 400 })
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${args.config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: args.model,
        messages: [{ role: 'system', content: 'Leia a imagem com segurança. Não faça diagnóstico nem recomendação clínica.' }, {
          role: 'user', content: [{ type: 'text', text: args.prompt }, { type: 'image_url', image_url: { url: dataUrl } }],
        }],
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw await providerHttpError(args.config.provider === 'openai' ? 'OpenAI' : 'OpenAI-compatible provider', res)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }
    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) throw new AiError('Empty prescription reading', { code: 'empty_response' })
    return { text, usage: normalizeUsage({ prompt: data.usage?.prompt_tokens, completion: data.usage?.completion_tokens, total: data.usage?.total_tokens }) }
  } catch (err) {
    if (err instanceof AiError) throw err
    throw toNetworkError(err)
  }
}
