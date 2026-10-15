import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import {
  SsoticaError,
  isValidCnpj,
  normalizeCnpj,
  testSsoticaConnection,
} from '@/lib/ssotica/client'
import { ssoticaErrorMessage } from '@/lib/ssotica/messages'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/ssotica/config
 *
 * Any member may read it so the UI can show "connected". The encrypted
 * key is NEVER returned — only a `has_key` flag.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('ssotica_config')
      .select('cnpj, verified_at, api_key, store_hash')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      console.error('[ssotica/config GET] fetch error:', error)
      return NextResponse.json({ error: t('ssotica.loadFailed') }, { status: 500 })
    }
    if (!data) return NextResponse.json({ configured: false })
    const [{ data: state }, { count }] = await Promise.all([
      supabase
        .from('ssotica_sync_state')
        .select('phase, last_run_at, last_error')
        .eq('account_id', accountId)
        .maybeSingle(),
      supabase
        .from('ssotica_customers')
        .select('ssotica_id', { count: 'exact', head: true })
        .eq('account_id', accountId),
    ])
    return NextResponse.json({
      configured: true,
      cnpj: data.cnpj,
      verified_at: data.verified_at,
      has_key: !!data.api_key,
      store_hash: data.store_hash ?? null,
      sync: {
        phase: state?.phase ?? 'customers',
        last_run_at: state?.last_run_at ?? null,
        last_error: state?.last_error ?? null,
        customers: count ?? 0,
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ssotica/config  (admin+)
 *
 * Upsert the credentials. The server re-runs the connection test before
 * persisting, so a config can only be saved if it works right now — the
 * UI's "save only after a passing test" rule is enforced here too.
 * When `api_key` is omitted the stored key is reused (CNPJ-only edit).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ssotica-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad(t('common.invalidRequestBody'))

    const cnpj = normalizeCnpj(typeof body.cnpj === 'string' ? body.cnpj : '')
    if (!isValidCnpj(cnpj)) return bad(t('ssotica.cnpjInvalid'))

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    const { data: existing } = await supabase
      .from('ssotica_config')
      .select('id, api_key')
      .eq('account_id', accountId)
      .maybeSingle()

    let apiKeyPlain = rawKey
    if (!apiKeyPlain) {
      if (!existing?.api_key) return bad(t('ssotica.apiKeyRequired'))
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return bad(t('ssotica.storedKeyReenter'))
      }
    }

    try {
      await testSsoticaConnection({ apiKey: apiKeyPlain, cnpj })
    } catch (err) {
      if (err instanceof SsoticaError) {
        return NextResponse.json(
          { error: ssoticaErrorMessage(err), code: err.code },
          { status: 400 },
        )
      }
      throw err
    }

    const row: Record<string, unknown> = {
      cnpj,
      verified_at: new Date().toISOString(),
    }
    if (rawKey) row.api_key = encrypt(rawKey)

    if (existing) {
      const { error } = await supabase
        .from('ssotica_config')
        .update(row)
        .eq('account_id', accountId)
      if (error) {
        console.error('[ssotica/config POST] update error:', error)
        return NextResponse.json({ error: t('ssotica.saveFailed') }, { status: 500 })
      }
    } else {
      const { error } = await supabase.from('ssotica_config').insert({
        account_id: accountId,
        created_by: userId,
        ...row,
      })
      if (error) {
        console.error('[ssotica/config POST] insert error:', error)
        return NextResponse.json({ error: t('ssotica.saveFailed') }, { status: 500 })
      }
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/ssotica/config  (admin+) — forget the credentials. */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('ssotica_config')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[ssotica/config DELETE] error:', error)
      return NextResponse.json({ error: t('ssotica.deleteFailed') }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/ssotica/config  (admin+)
 *
 * Saves the store code used in ssOtica web links (see migration 051).
 * Independent of the credentials, so it needs no connection test.
 */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad(t('common.invalidRequestBody'))

    const raw = typeof body.store_hash === 'string' ? body.store_hash.trim() : ''
    if (raw && !/^[A-Za-z0-9]{3,32}$/.test(raw)) return bad(t('ssotica.storeHashInvalid'))

    const { data, error } = await supabase
      .from('ssotica_config')
      .update({ store_hash: raw || null })
      .eq('account_id', accountId)
      .select('account_id')
    if (error || !data?.length) {
      if (error) console.error('[ssotica/config PATCH] error:', error)
      return NextResponse.json({ error: t('ssotica.saveFailed') }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
