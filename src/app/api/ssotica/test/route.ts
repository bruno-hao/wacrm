import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  SsoticaError,
  isValidCnpj,
  normalizeCnpj,
  testSsoticaConnection,
} from '@/lib/ssotica/client'
import { ssoticaErrorMessage } from '@/lib/ssotica/messages'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * POST /api/ssotica/test  (admin+)
 *
 * "Test key" button: checks a candidate key + CNPJ against the ssOtica
 * API WITHOUT saving. When `api_key` is omitted the stored key is used.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ssotica-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: t('common.invalidRequestBody') }, { status: 400 })
    }

    const cnpj = normalizeCnpj(typeof body.cnpj === 'string' ? body.cnpj : '')
    if (!isValidCnpj(cnpj)) {
      return NextResponse.json({ error: t('ssotica.cnpjInvalid') }, { status: 400 })
    }

    let apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    if (!apiKey) {
      const { data } = await supabase
        .from('ssotica_config')
        .select('api_key')
        .eq('account_id', accountId)
        .maybeSingle()
      if (!data?.api_key) {
        return NextResponse.json({ error: t('ssotica.apiKeyRequired') }, { status: 400 })
      }
      try {
        apiKey = decrypt(data.api_key)
      } catch {
        return NextResponse.json({ error: t('ssotica.storedKeyReenter') }, { status: 400 })
      }
    }

    try {
      await testSsoticaConnection({ apiKey, cnpj })
    } catch (err) {
      if (err instanceof SsoticaError) {
        return NextResponse.json(
          { error: ssoticaErrorMessage(err), code: err.code },
          { status: 400 },
        )
      }
      throw err
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
