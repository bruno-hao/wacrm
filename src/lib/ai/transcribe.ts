import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import {
  allowedPrivateHosts,
  normalizeOpenAiCompatibleBaseUrl,
} from '@/lib/ai/providers/openai-compatible'
import { aiRequestTimeoutMs } from './defaults'
import type { AiConfig } from './types'

export const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo'

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions'

/** Audio transcription needs an OpenAI-style `/audio/transcriptions` API. */
export function transcriptionSupported(provider: AiConfig['provider']): boolean {
  return provider === 'openai' || provider === 'openai_compatible'
}

/**
 * Endpoint for the account's provider: the assistant's own base URL
 * (`…/chat/completions` → `…/audio/transcriptions`) or OpenAI's.
 * Returns null when the provider has no transcription API.
 */
export function transcriptionEndpoint(config: Pick<AiConfig, 'provider' | 'baseUrl'>): string | null {
  if (config.provider === 'openai') return OPENAI_TRANSCRIPTIONS_URL
  if (config.provider === 'openai_compatible') {
    return normalizeOpenAiCompatibleBaseUrl(config.baseUrl ?? '').replace(
      /\/chat\/completions$/,
      '/audio/transcriptions',
    )
  }
  return null
}

/**
 * Transcribe one audio file with the assistant's own provider and key.
 * Never throws: any failure (unsupported provider, blocked URL, HTTP
 * error, timeout, empty result) logs and returns null so a bad
 * transcription can never break message ingestion.
 */
export async function transcribeAudio(args: {
  config: Pick<AiConfig, 'provider' | 'baseUrl' | 'apiKey' | 'transcriptionModel'>
  bytes: ArrayBuffer | Uint8Array
  mimeType?: string | null
  fileName?: string | null
}): Promise<string | null> {
  const { config, bytes, mimeType, fileName } = args
  try {
    const endpoint = transcriptionEndpoint(config)
    if (!endpoint) return null

    if (
      config.provider === 'openai_compatible' &&
      !(await isDeliverableUrl(endpoint, { allowPrivateHosts: allowedPrivateHosts() }))
    ) {
      console.error('[transcribe] provider URL blocked')
      return null
    }

    const type = (mimeType || 'audio/ogg').split(';')[0].trim() || 'audio/ogg'
    const form = new FormData()
    form.append(
      'file',
      new Blob([bytes as BlobPart], { type }),
      fileName || `audio.${type.split('/')[1] || 'ogg'}`,
    )
    form.append('model', config.transcriptionModel || DEFAULT_TRANSCRIPTION_MODEL)
    form.append('response_format', 'json')

    const res = await fetch(endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(Math.max(aiRequestTimeoutMs(), 60_000)),
    })
    if (!res.ok) {
      console.error('[transcribe] provider returned', res.status)
      return null
    }
    const data = (await res.json().catch(() => null)) as { text?: unknown } | null
    const text = typeof data?.text === 'string' ? data.text.trim() : ''
    return text || null
  } catch (err) {
    console.error('[transcribe] failed:', err instanceof Error ? err.message : err)
    return null
  }
}
