import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { loginSsotica } from '@/lib/ssotica/web'
import { webLoginErrorMessage } from '@/lib/ssotica/messages'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * POST /api/ssotica/web-login/test  (admin+)
 * Tries the web login WITHOUT saving it. Few attempts per minute: repeated
 * wrong passwords could lock the ssOtica user.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ssotica-web-login:${userId}`, { limit: 5, windowMs: 60_000 })
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const login = typeof body?.login === 'string' ? body.login.trim() : ''
    let password = typeof body?.password === 'string' ? body.password : ''
    if (!login) return NextResponse.json({ error: t('ssotica.webLoginRequired') }, { status: 400 })
    if (!password) {
      const { data } = await supabase
        .from('ssotica_config')
        .select('web_password')
        .eq('account_id', accountId)
        .maybeSingle()
      if (!data?.web_password) {
        return NextResponse.json({ error: t('ssotica.webLoginRequired') }, { status: 400 })
      }
      try {
        password = decrypt(data.web_password)
      } catch {
        return NextResponse.json({ error: t('ssotica.storedKeyReenter') }, { status: 400 })
      }
    }
    try {
      await loginSsotica(login, password)
    } catch (err) {
      return NextResponse.json({ error: webLoginErrorMessage(err) }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
