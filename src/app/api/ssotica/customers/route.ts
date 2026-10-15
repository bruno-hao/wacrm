import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { canonicalPhone } from '@/lib/ssotica/sync'

/**
 * POST /api/ssotica/customers  { phones: string[] }
 *
 * Batch "is this a ssOtica customer?" for the conversation list. Returns
 * `{ status: { [phone as sent]: 'customer' | 'new' } }`; phones that cannot
 * be decided are left out, and the whole answer is `unavailable` until the
 * first sync has finished (see /api/ssotica/customer).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const body = await request.json().catch(() => null)
    const raw: unknown[] = Array.isArray(body?.phones) ? body.phones.slice(0, 300) : []

    const byCanonical = new Map<string, string[]>()
    for (const p of raw) {
      if (typeof p !== 'string') continue
      const c = canonicalPhone(p)
      if (!c) continue
      byCanonical.set(c, [...(byCanonical.get(c) ?? []), p])
    }
    if (!byCanonical.size) return NextResponse.json({ status: {} })

    const { data: state } = await supabase
      .from('ssotica_sync_state')
      .select('phase')
      .eq('account_id', accountId)
      .maybeSingle()
    if (state?.phase !== 'live') return NextResponse.json({ status: {} })

    const { data: rows, error } = await supabase
      .from('ssotica_customers')
      .select('phones')
      .eq('account_id', accountId)
      .overlaps('phones', [...byCanonical.keys()])
    if (error) return NextResponse.json({ status: {} })

    const known = new Set<string>((rows ?? []).flatMap((r) => r.phones as string[]))
    const status: Record<string, 'customer' | 'new'> = {}
    for (const [canon, originals] of byCanonical) {
      for (const o of originals) status[o] = known.has(canon) ? 'customer' : 'new'
    }
    return NextResponse.json({ status })
  } catch (err) {
    return toErrorResponse(err)
  }
}
