import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { runSsoticaSync } from '@/lib/ssotica/sync'
import { syncQuotes } from '@/lib/ssotica/quotes'

/**
 * GET /api/cron/ssotica-sync
 *
 * Refreshes the local ssOtica customer index for every account that has
 * ssOtica configured. Hit it every 10 minutes from the host cron, with the
 * shared `x-cron-secret` (same secret as the other cron endpoints). A run
 * stays inside ssOtica's 60-calls/minute limit by capping its API calls;
 * the first backfill simply spans several runs.
 */
export const maxDuration = 300

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '')
  const want = Buffer.from(expected)
  if (supplied.length !== want.length || !timingSafeEqual(supplied, want)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()
  const { data: configs, error } = await db
    .from('ssotica_config')
    .select('account_id, cnpj, api_key')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: Record<string, unknown>[] = []
  for (const cfg of configs ?? []) {
    try {
      const out = await runSsoticaSync(db, cfg.account_id, {
        apiKey: decrypt(cfg.api_key),
        cnpj: cfg.cnpj,
      })
      // Budgets → pipeline deals (needs the optional web login; skipped when absent).
      const quotes = await syncQuotes(db, cfg.account_id).catch(() => null)
      results.push({ account: cfg.account_id, ...out, quotes })
    } catch (err) {
      console.error('[ssotica-sync] account failed:', err)
      results.push({ account: cfg.account_id, stopped: 'error' })
    }
  }
  return NextResponse.json({ ok: true, results })
}
