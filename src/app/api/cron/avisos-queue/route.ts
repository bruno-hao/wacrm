import { timingSafeEqual } from 'node:crypto'
import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runNoticeWorker } from '@/lib/avisos/queue'

export const maxDuration = 300

/**
 * GET /api/cron/avisos-queue — every minute with `x-cron-secret`.
 * Resumes any queue the process lost (a deploy or restart in the middle of a
 * batch). A worker already running for an account makes this a no-op.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '')
  const want = Buffer.from(expected)
  if (supplied.length !== want.length || !timingSafeEqual(supplied, want)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()
  const { data } = await db
    .from('os_notices')
    .select('account_id')
    .in('status', ['queued', 'sending'])
    .limit(500)
  const accounts = [...new Set((data ?? []).map((r) => r.account_id as string))]
  for (const accountId of accounts) after(() => runNoticeWorker(db, accountId))
  return NextResponse.json({ ok: true, accounts: accounts.length })
}
