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

    const canons = [...byCanonical.keys()]
    const tails = [...new Set(canons.map((c) => c.slice(-8)))]
    const { data: rows, error } = await supabase
      .from('ssotica_customers')
      .select('name, phones, phone_tails, last_sale_date')
      .eq('account_id', accountId)
      .or(`phones.ov.{${canons.join(',')}},phone_tails.ov.{${tails.join(',')}}`)
    if (error) return NextResponse.json({ status: {} })

    // Exact phone first; otherwise the last 8 digits (other DDD / ninth digit).
    // When several customers share a number, the most recent buyer wins.
    const recent = [...(rows ?? [])].sort((a, b) =>
      String(b.last_sale_date ?? '').localeCompare(String(a.last_sale_date ?? '')),
    )
    const status: Record<string, 'customer' | 'new'> = {}
    const names: Record<string, string> = {}
    for (const [canon, originals] of byCanonical) {
      const hit =
        recent.find((r) => (r.phones as string[]).includes(canon)) ??
        recent.find((r) => ((r.phone_tails as string[]) ?? []).includes(canon.slice(-8)))
      for (const o of originals) {
        status[o] = hit ? 'customer' : 'new'
        if (hit?.name) names[o] = hit.name as string
      }
    }
    return NextResponse.json({ status, names })
  } catch (err) {
    return toErrorResponse(err)
  }
}
