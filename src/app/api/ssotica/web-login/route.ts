import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { loginSsotica } from '@/lib/ssotica/web'
import { webLoginErrorMessage } from '@/lib/ssotica/messages'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * PUT /api/ssotica/web-login  (admin+)
 * Saves the ssOtica web login used ONLY to read budgets. The server logs in
 * again first (a login can only be saved if it works right now), stores the
 * password and the session cookies encrypted, and never returns either.
 */
export async function PUT(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ssotica-web-login:${userId}`, { limit: 5, windowMs: 60_000 })
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const login = typeof body?.login === 'string' ? body.login.trim() : ''
    let password = typeof body?.password === 'string' ? body.password : ''
    if (!login) return NextResponse.json({ error: t('ssotica.webLoginRequired') }, { status: 400 })

    const { data: existing } = await supabase
      .from('ssotica_config')
      .select('account_id, web_password')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!existing) {
      return NextResponse.json({ error: t('ssotica.notConfigured') }, { status: 400 })
    }
    if (!password) {
      if (!existing.web_password) {
        return NextResponse.json({ error: t('ssotica.webLoginRequired') }, { status: 400 })
      }
      try {
        password = decrypt(existing.web_password)
      } catch {
        return NextResponse.json({ error: t('ssotica.storedKeyReenter') }, { status: 400 })
      }
    }

    let jar
    try {
      jar = await loginSsotica(login, password)
    } catch (err) {
      return NextResponse.json({ error: webLoginErrorMessage(err) }, { status: 400 })
    }

    const { error } = await supabase
      .from('ssotica_config')
      .update({
        web_login: login,
        web_password: encrypt(password),
        web_session: encrypt(JSON.stringify(jar)),
        web_verified_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
    if (error) {
      console.error('[ssotica/web-login PUT] error:', error.message)
      return NextResponse.json({ error: t('ssotica.saveFailed') }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/ssotica/web-login (admin+) — forget the web login and its session. */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('ssotica_config')
      .update({ web_login: null, web_password: null, web_session: null, web_verified_at: null })
      .eq('account_id', accountId)
    if (error) return NextResponse.json({ error: t('ssotica.deleteFailed') }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
