import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import {
  exchangeCodeForLongLivedToken,
  getMe,
  instagramEnv,
  subscribeToWebhooks,
} from '@/lib/instagram/api'
import { verifyOAuthState } from '@/lib/instagram/security'

/**
 * GET /api/instagram/oauth/callback?code=…&state=…
 *
 * Instagram redirects the admin's browser here after consent. The state
 * must be one we signed for THIS admin and account (CSRF), the code is
 * exchanged for a 60-day token, the account is subscribed to our webhook
 * fields and the encrypted token is saved. Always ends in a redirect back
 * to Settings → Instagram with `ig=connected` or `ig=<error>`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const back = (flag: string) =>
    NextResponse.redirect(
      new URL(`/settings?tab=instagram&ig=${flag}`, instagramEnv().siteUrl || url.origin),
    )

  try {
    const { accountId, userId } = await requireRole('admin')
    const state = verifyOAuthState(url.searchParams.get('state'))
    if (!state || state.accountId !== accountId || state.userId !== userId) return back('invalid_state')
    const code = url.searchParams.get('code')
    if (!code) return back(url.searchParams.get('error') ? 'denied' : 'missing_code')

    const { accessToken, expiresAt } = await exchangeCodeForLongLivedToken(code)
    const me = await getMe(accessToken)
    await subscribeToWebhooks(accessToken)

    const db = supabaseAdmin()
    const { error } = await db.from('instagram_config').upsert(
      {
        account_id: accountId,
        created_by: userId,
        ig_user_id: me.igUserId,
        username: me.username,
        access_token: encrypt(accessToken),
        token_expires_at: expiresAt,
        status: 'connected',
      },
      { onConflict: 'account_id' },
    )
    if (error) {
      console.error('[instagram/oauth] save failed:', error.message)
      return back('save_failed')
    }
    return back('connected')
  } catch (err) {
    console.error('[instagram/oauth] failed:', err instanceof Error ? err.message : err)
    return back('failed')
  }
}
