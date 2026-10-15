import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { transcribeAudio, transcriptionSupported } from '@/lib/ai/transcribe'
import { getT } from '@/lib/i18n/translate'

export const maxDuration = 90

const t = getT('Api')

/**
 * POST /api/ai/transcribe-message  { message_id }
 *
 * "Transcrever áudio" shortcut in the inbox: transcribes ONE audio message
 * on demand with the account's assistant provider/key and stores the text
 * on the message (so it is shown from then on). Any member may use it.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount()

    const limit = checkRateLimit(`ai-transcribe:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const messageId = typeof body?.message_id === 'string' ? body.message_id : ''
    if (!messageId) {
      return NextResponse.json({ error: t('common.invalidRequestBody') }, { status: 400 })
    }

    // RLS-scoped read: the caller can only reach messages of their account.
    const { data: msg } = await supabase
      .from('messages')
      .select('id, content_type, content_text, media_url, media_type')
      .eq('id', messageId)
      .maybeSingle()
    if (!msg || msg.content_type !== 'audio' || !msg.media_url) {
      return NextResponse.json({ error: t('ai.transcribeNotAudio') }, { status: 400 })
    }
    if (msg.content_text?.trim()) return NextResponse.json({ text: msg.content_text })

    const db = supabaseAdmin()
    const config = await loadAiConfig(db, accountId, { requireActive: false })
    if (!config?.transcriptionEnabled || !transcriptionSupported(config.provider)) {
      return NextResponse.json({ error: t('ai.transcriptionDisabled') }, { status: 400 })
    }

    let bytes: ArrayBuffer
    let contentType: string | null = null
    try {
      const url = new URL(msg.media_url)
      if (url.protocol !== 'https:') throw new Error('not https')
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      contentType = res.headers.get('content-type')
      bytes = await res.arrayBuffer()
    } catch {
      return NextResponse.json({ error: t('ai.transcribeFetchFailed') }, { status: 502 })
    }

    const text = await transcribeAudio({
      config,
      bytes,
      mimeType: msg.media_type || contentType,
    })
    if (!text) {
      return NextResponse.json({ error: t('ai.transcribeFailed') }, { status: 502 })
    }

    await db.from('messages').update({ content_text: text }).eq('id', msg.id)
    return NextResponse.json({ text })
  } catch (err) {
    return toErrorResponse(err)
  }
}
