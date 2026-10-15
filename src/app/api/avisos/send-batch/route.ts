import { NextResponse, after } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { MAX_BATCH, enqueueNotices, runNoticeWorker } from '@/lib/avisos/queue'

export const maxDuration = 300

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * POST /api/avisos/send-batch  { quick_reply_id, items: [{ os_number, os_date }] }  (agent+)
 *
 * Queues one quick reply for every selected O.S.; a background worker sends
 * them one by one with a random 5–15 s pause. Replies at once with
 * `{ queued, skipped }` (skipped = already sent or already in the queue); the
 * page then follows each notice's status.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`avisos-batch:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const replyId = String(body?.quick_reply_id ?? '')
    const rawItems: unknown[] = Array.isArray(body?.items) ? body.items : []
    const items = rawItems
      .map((i) => i as { os_number?: unknown; os_date?: unknown })
      .filter((i) => /^\d+$/.test(String(i.os_number ?? '')) && DAY.test(String(i.os_date ?? '')))
      .map((i) => ({ os_number: String(i.os_number), os_date: String(i.os_date) }))
    if (!replyId || !items.length) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    }
    if (items.length > MAX_BATCH) {
      return NextResponse.json({ error: 'too_many' }, { status: 400 })
    }

    const { data: reply } = await supabase
      .from('quick_replies')
      .select('id, title')
      .eq('id', replyId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!reply) return NextResponse.json({ error: 'quick_reply_not_found' }, { status: 404 })

    const db = supabaseAdmin()
    const result = await enqueueNotices(db, {
      accountId,
      userId,
      reply: { id: reply.id as string, title: reply.title as string },
      items,
    })
    if (result.queued > 0) after(() => runNoticeWorker(db, accountId))
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
