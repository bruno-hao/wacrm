import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import {
  allowedPrivateHosts,
  normalizeOpenAiCompatibleBaseUrl,
} from '@/lib/ai/providers/openai-compatible'
import { aiRequestTimeoutMs } from './defaults'
import type { AiConfig } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAiConfig } from './config'

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

/** Best-effort transcription for a stored inbound audio message. */
export async function transcribeStoredAudio(args: {
  db: SupabaseClient
  accountId: string
  messageId: string
}): Promise<string | null> {
  const { db, accountId, messageId } = args
  try {
    const { data: msg } = await db
      .from('messages')
      .select('id, content_type, content_text, media_url, media_type')
      .eq('id', messageId)
      .maybeSingle()
    if (!msg || msg.content_type !== 'audio' || !msg.media_url || msg.content_text?.trim()) {
      return msg?.content_text?.trim() || null
    }
    const config = await loadAiConfig(db, accountId)
    if (!config?.transcriptionEnabled || !transcriptionSupported(config.provider)) return null
    const url = new URL(msg.media_url)
    if (url.protocol !== 'https:') return null
    if (!(await isDeliverableUrl(url.toString(), { allowPrivateHosts: new Set() }))) return null
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return null
    const text = await transcribeAudio({
      config,
      bytes: await res.arrayBuffer(),
      mimeType: msg.media_type || res.headers.get('content-type'),
    })
    if (!text) return null
    await db.from('messages').update({ content_text: text }).eq('id', messageId)
    return text
  } catch (err) {
    console.error('[transcribe] stored audio failed:', err instanceof Error ? err.message : err)
    return null
  }
}
