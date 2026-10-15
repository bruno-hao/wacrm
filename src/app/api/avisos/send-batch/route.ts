import { NextResponse, after } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { MAX_BATCH, enqueueNotices, runNoticeWorker, type NoticeModule } from '@/lib/avisos/queue'

export const maxDuration = 300

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MODULES: NoticeModule[] = ['avisos', 'posvenda', 'receitas', 'aniversario']

/**
 * POST /api/avisos/send-batch  (agent+)
 *   { module?, quick_reply_id | standard_message_id, items: [{ os_number, os_date }] }
 * `avisos` sends a quick reply; the other modules send a standard message.
 * For `aniversario`, os_number is "<customer id>-<year>".
 *
 * Queues the message for every selected row; a background worker sends
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
    const mod: NoticeModule = MODULES.includes(body?.module) ? body.module : 'avisos'
    const isStandard = mod !== 'avisos'
    const replyId = String(isStandard ? (body?.standard_message_id ?? '') : (body?.quick_reply_id ?? ''))
    const refPattern = mod === 'aniversario' ? /^\d+-\d{4}$/ : /^\d+$/
    const rawItems: unknown[] = Array.isArray(body?.items) ? body.items : []
    const items = rawItems
      .map((i) => i as { os_number?: unknown; os_date?: unknown })
      .filter((i) => refPattern.test(String(i.os_number ?? '')) && DAY.test(String(i.os_date ?? '')))
      .map((i) => ({ os_number: String(i.os_number), os_date: String(i.os_date) }))
    if (!replyId || !items.length) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    }
    if (items.length > MAX_BATCH) {
      return NextResponse.json({ error: 'too_many' }, { status: 400 })
    }

    const { data: reply } = await supabase
      .from(isStandard ? 'standard_messages' : 'quick_replies')
      .select('id, title')
      .eq('id', replyId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!reply) return NextResponse.json({ error: 'quick_reply_not_found' }, { status: 404 })

    const db = supabaseAdmin()
    const result = await enqueueNotices(db, {
      accountId,
      userId,
      module: mod,
      reply: {
        id: reply.id as string,
        title: reply.title as string,
        source: isStandard ? 'standard' : 'quick',
      },
      items,
    })
    if (result.queued > 0) after(() => runNoticeWorker(db, accountId))
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
