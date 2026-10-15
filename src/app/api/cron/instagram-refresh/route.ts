import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { refreshLongLivedToken } from '@/lib/instagram/api'

/**
 * GET /api/cron/instagram-refresh — run daily with `x-cron-secret`.
 * Instagram tokens last 60 days; refresh every token that expires within
 * 15 days (a token must be at least 24 h old to be refreshable).
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
  const horizon = new Date(Date.now() + 15 * 86_400_000).toISOString()
  const { data: rows, error } = await db
    .from('instagram_config')
    .select('account_id, access_token')
    .eq('status', 'connected')
    .lt('token_expires_at', horizon)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let refreshed = 0
  let failed = 0
  for (const row of rows ?? []) {
    try {
      const r = await refreshLongLivedToken(decrypt(row.access_token))
      await db
        .from('instagram_config')
        .update({ access_token: encrypt(r.accessToken), token_expires_at: r.expiresAt })
        .eq('account_id', row.account_id)
      refreshed++
    } catch (err) {
      failed++
      console.error('[instagram-refresh] failed:', err instanceof Error ? err.message : err)
      // An expired token cannot be recovered: mark it so the UI asks to reconnect.
      await db
        .from('instagram_config')
        .update({ status: 'disconnected' })
        .eq('account_id', row.account_id)
        .lt('token_expires_at', new Date().toISOString())
    }
  }
  return NextResponse.json({ ok: true, refreshed, failed })
}
