import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { generatePrescriptionReading } from '@/lib/ai/prescription'
import { getT } from '@/lib/i18n/translate'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

export const maxDuration = 90
const t = getT('Api')

async function readMessageId(request: Request): Promise<string> {
  const body = await request.json().catch(() => null)
  return typeof body?.message_id === 'string' ? body.message_id : ''
}

export async function GET(request: Request) {
  try {
    const { supabase } = await requireRole('agent')
    const id = new URL(request.url).searchParams.get('message_id') || ''
    if (!id) return NextResponse.json({ error: t('common.invalidRequestBody') }, { status: 400 })
    const { data, error } = await supabase
      .from('ai_prescription_reads')
      .select('id, status, result_text, error_code, model, updated_at')
      .eq('message_id', id)
      .maybeSingle()
    if (error) return NextResponse.json({ error: t('ai.prescriptionReaderFailed') }, { status: 500 })
    return NextResponse.json({ read: data ?? null })
  } catch (err) { return toErrorResponse(err) }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`ai-prescription:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const messageId = await readMessageId(request)
    if (!messageId) return NextResponse.json({ error: t('common.invalidRequestBody') }, { status: 400 })
    const { data: msg } = await supabase
      .from('messages')
      .select('id, conversation_id, sender_type, content_type, media_url, media_type')
      .eq('id', messageId)
      .maybeSingle()
    if (!msg || msg.sender_type !== 'customer' || msg.content_type !== 'image' || !msg.media_url) {
      return NextResponse.json({ error: t('ai.prescriptionReaderNotImage') }, { status: 400 })
    }
    const db = supabaseAdmin()
    const config = await loadAiConfig(db, accountId, { requireActive: false })
    if (!config?.prescriptionReaderEnabled || !config.prescriptionReaderModel) {
      return NextResponse.json({ error: t('ai.prescriptionReaderDisabled') }, { status: 400 })
    }
    const model = config.prescriptionReaderModel
    const prompt = config.prescriptionReaderPrompt || 'Leia apenas o texto legível da receita. Indique campos ausentes ou incertos. Não faça diagnóstico nem recomende lentes.'
    const { data: existing } = await db.from('ai_prescription_reads').select('*').eq('message_id', messageId).maybeSingle()
    if (existing?.status === 'completed') return NextResponse.json({ read: existing })
    if (existing?.status === 'processing') return NextResponse.json({ read: existing })
    const { data: row, error: upsertError } = await db.from('ai_prescription_reads').upsert({
      id: existing?.id,
      account_id: accountId,
      conversation_id: msg.conversation_id,
      message_id: messageId,
      status: 'processing',
      result_text: null,
      error_code: null,
      model,
      created_by: userId,
    }, { onConflict: 'message_id' }).select('*').single()
    if (upsertError || !row) return NextResponse.json({ error: t('ai.prescriptionReaderFailed') }, { status: 500 })
    try {
      const url = new URL(msg.media_url)
      if (url.protocol !== 'https:') throw new Error('media url blocked')
      if (!(await isDeliverableUrl(url.toString(), { allowPrivateHosts: new Set() }))) throw new Error('media url blocked')
      const media = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
      if (!media.ok) throw new Error(`media ${media.status}`)
      const result = await generatePrescriptionReading({
        config,
        model,
        prompt,
        bytes: await media.arrayBuffer(),
        mimeType: msg.media_type || media.headers.get('content-type'),
      })
      const { data: completed } = await db.from('ai_prescription_reads').update({ status: 'completed', result_text: result.text, error_code: null }).eq('id', row.id).select('*').single()
      return NextResponse.json({ read: completed ?? { ...row, status: 'completed', result_text: result.text } })
    } catch (err) {
      console.error('[ai/prescription-read] failed:', err)
      await db.from('ai_prescription_reads').update({ status: 'failed', error_code: err instanceof Error ? err.message.slice(0, 120) : 'reader_failed' }).eq('id', row.id)
      return NextResponse.json({ error: t('ai.prescriptionReaderFailed') }, { status: 502 })
    }
  } catch (err) { return toErrorResponse(err) }
}
