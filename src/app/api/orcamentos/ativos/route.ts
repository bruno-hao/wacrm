import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { listActiveQuotes } from '@/lib/ssotica/active-quotes'
import { SsoticaWebError } from '@/lib/ssotica/web'

export const maxDuration = 120

/** GET /api/orcamentos/ativos — active ssOtica budgets, newest first. */
export async function GET() {
  try {
    const { accountId } = await getCurrentAccount()
    const items = await listActiveQuotes(supabaseAdmin(), accountId)
    return NextResponse.json({ items })
  } catch (err) {
    if (err instanceof Error && err.message === 'not_configured') {
      return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    }
    if (err instanceof SsoticaWebError) {
      return NextResponse.json({ error: err.code }, { status: 502 })
    }
    return toErrorResponse(err)
  }
}
