import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { runSsoticaSync } from '@/lib/ssotica/sync'
import { getT } from '@/lib/i18n/translate'

export const maxDuration = 120

const t = getT('Api')

/** POST /api/ssotica/sync (admin+) — "Sync now": one budgeted sync run. */
export async function POST() {
  try {
    const { accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ssotica-sync:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const db = supabaseAdmin()
    const { data: cfg } = await db
      .from('ssotica_config')
      .select('cnpj, api_key')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!cfg) {
      return NextResponse.json({ error: t('ssotica.notConfigured') }, { status: 400 })
    }
    const result = await runSsoticaSync(db, accountId, {
      apiKey: decrypt(cfg.api_key),
      cnpj: cfg.cnpj,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return toErrorResponse(err)
  }
}
