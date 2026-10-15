import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { syncQuotes } from '@/lib/ssotica/quotes'

export const maxDuration = 120

/**
 * POST /api/ssotica/quotes/sync (agent+) — the "Sincronizar ssOtica" button
 * on the Pipelines page: one manual pass over the ssOtica budgets.
 */
export async function POST() {
  try {
    const { accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`ssotica-quotes:${userId}`, { limit: 6, windowMs: 60_000 })
    if (!limit.success) return rateLimitResponse(limit)
    const result = await syncQuotes(supabaseAdmin(), accountId)
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
