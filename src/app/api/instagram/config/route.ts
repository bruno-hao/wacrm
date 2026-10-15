import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { instagramEnv, instagramRedirectUri, unsubscribeFromWebhooks } from '@/lib/instagram/api'

/**
 * GET /api/instagram/config — connection status for Settings → Instagram.
 * Never returns the token. Also tells an admin which URLs to paste into
 * the Meta app and whether the server env is ready.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data } = await supabase
      .from('instagram_config')
      .select('username, ig_user_id, token_expires_at, status')
      .eq('account_id', accountId)
      .maybeSingle()
    const env = instagramEnv()
    return NextResponse.json({
      configured: !!data,
      username: data?.username ?? null,
      status: data?.status ?? null,
      token_expires_at: data?.token_expires_at ?? null,
      env_ready: !!(env.appId && env.appSecret && env.verifyToken && env.siteUrl),
      webhook_url: `${env.siteUrl}/api/instagram/webhook`,
      redirect_uri: env.siteUrl ? instagramRedirectUri() : null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/instagram/config (admin+) — disconnect and forget the token. */
export async function DELETE() {
  try {
    const { accountId } = await requireRole('admin')
    const db = supabaseAdmin()
    const { data } = await db
      .from('instagram_config')
      .select('access_token')
      .eq('account_id', accountId)
      .maybeSingle()
    if (data?.access_token) {
      try {
        await unsubscribeFromWebhooks(decrypt(data.access_token))
      } catch {
        // Best effort: the token may already be revoked.
      }
    }
    const { error } = await db.from('instagram_config').delete().eq('account_id', accountId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
