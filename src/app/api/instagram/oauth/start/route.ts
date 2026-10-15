import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { buildAuthorizeUrl, instagramEnv } from '@/lib/instagram/api'
import { signOAuthState } from '@/lib/instagram/security'

/** GET /api/instagram/oauth/start (admin+) → { url } to open Instagram's consent screen. */
export async function GET() {
  try {
    const { accountId, userId } = await requireRole('admin')
    const env = instagramEnv()
    if (!env.appId || !env.appSecret || !env.siteUrl) {
      return NextResponse.json({ error: 'instagram_not_configured' }, { status: 400 })
    }
    return NextResponse.json({ url: buildAuthorizeUrl(signOAuthState(accountId, userId)) })
  } catch (err) {
    return toErrorResponse(err)
  }
}
