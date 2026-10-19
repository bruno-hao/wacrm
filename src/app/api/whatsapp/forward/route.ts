import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { SendMessageError, sendMessageToConversation } from '@/lib/whatsapp/send-message'

const MAX_MESSAGES = 30
const MAX_TARGETS = 10

/**
 * POST /api/whatsapp/forward  { message_ids: string[], conversation_ids: string[] }  (agent+)
 *
 * Forwards the text of the selected messages (oldest first) to every chosen
 * conversation, through the normal send path. Messages without text
 * (inbound media is only reachable through Meta's authenticated proxy) are
 * skipped and counted.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`forward:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const messageIds: string[] = Array.isArray(body?.message_ids)
      ? [...new Set<string>(body.message_ids.map(String))]
      : []
    const targetIds: string[] = Array.isArray(body?.conversation_ids)
      ? [...new Set<string>(body.conversation_ids.map(String))]
      : []
    if (!messageIds.length || !targetIds.length) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    }
    if (messageIds.length > MAX_MESSAGES || targetIds.length > MAX_TARGETS) {
      return NextResponse.json({ error: 'too_many' }, { status: 400 })
    }

    // RLS scopes both reads to the caller's account; the explicit account
    // filter on conversations keeps it airtight.
    const { data: messages } = await supabase
      .from('messages')
      .select('id, content_type, content_text, created_at')
      .in('id', messageIds)
      .order('created_at', { ascending: true })
    const { data: targets } = await supabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .in('id', targetIds)

    const texts = (messages ?? [])
      .map((m) => (typeof m.content_text === 'string' ? m.content_text.trim() : ''))
      .filter(Boolean)
    const skipped = (messages ?? []).length - texts.length

    let sent = 0
    let failed = 0
    for (const target of targets ?? []) {
      for (const text of texts) {
        try {
          await sendMessageToConversation(supabase, accountId, {
            conversationId: target.id as string,
            messageType: 'text',
            contentText: text,
            senderUserId: userId,
          })
          sent++
        } catch (err) {
          failed++
          if (!(err instanceof SendMessageError)) {
            console.error('[forward] send failed:', err instanceof Error ? err.message : err)
          }
        }
      }
    }
    return NextResponse.json({ sent, failed, skipped })
  } catch (err) {
    return toErrorResponse(err)
  }
}
