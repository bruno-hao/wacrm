import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { paginate } from '@/lib/avisos/os'

/** Today in the store's timezone (America/Bahia, UTC-3) as yyyy-mm-dd. */
function today(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * GET /api/avisos/birthdays — customers (from the ssOtica index) whose
 * birthday is in the current month, ordered by day.
 *   q     name / last O.S. number / seller
 *   page  10 per page
 * Rows carry `ref` = "<customer id>-<year>", so each customer is greeted once a year.
 */
export async function GET(request: Request) {
  try {
    const { accountId } = await getCurrentAccount()
    const sp = new URL(request.url).searchParams
    const now = today()
    const month = now.slice(5, 7)
    const year = now.slice(0, 4)
    const db = supabaseAdmin()

    const { data: phase } = await db
      .from('ssotica_sync_state')
      .select('phase')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!phase) return NextResponse.json({ error: 'not_configured' }, { status: 400 })

    // Birth dates of the whole account (1000 rows per read).
    type Cust = {
      ssotica_id: number
      name: string | null
      phones: string[] | null
      last_os_number: string | null
      last_os_date: string | null
      last_seller: string | null
      birth_date: string
      registered_at: string | null
    }
    const all: Cust[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from('ssotica_customers')
        .select('ssotica_id, name, phones, last_os_number, last_os_date, last_seller, birth_date, registered_at')
        .eq('account_id', accountId)
        .not('birth_date', 'is', null)
        .order('ssotica_id')
        .range(from, from + 999)
      if (error) return NextResponse.json({ error: 'unexpected' }, { status: 500 })
      all.push(...((data ?? []) as Cust[]))
      if ((data?.length ?? 0) < 1000) break
    }

    const q = fold(sp.get('q') ?? '')
    const filtered = all
      .filter((c) => c.birth_date.slice(5, 7) === month)
      .filter(
        (c) =>
          !q ||
          fold(c.name ?? '').includes(q) ||
          (c.last_os_number ?? '').includes(q.replace(/\D/g, '') || '\u0000') ||
          fold(c.last_seller ?? '').includes(q),
      )
      .sort((a, b) => a.birth_date.slice(8, 10).localeCompare(b.birth_date.slice(8, 10)) || (a.name ?? '').localeCompare(b.name ?? ''))

    const pageInfo = paginate(filtered, Number(sp.get('page')) || 1, 10)
    const refs = pageInfo.items.map((c) => `${c.ssotica_id}-${year}`)
    const { data: notices } = refs.length
      ? await db
          .from('os_notices')
          .select('os_number, quick_reply_id, standard_message_id, status, updated_at, error')
          .eq('account_id', accountId)
          .eq('module', 'aniversario')
          .in('os_number', refs)
      : { data: [] }
    const byRef = new Map<string, unknown[]>()
    for (const n of notices ?? []) {
      const list = byRef.get(n.os_number as string) ?? []
      list.push({
        quick_reply_id: (n.standard_message_id ?? n.quick_reply_id) as string,
        status: n.status,
        updated_at: n.updated_at,
        error: n.error ?? null,
      })
      byRef.set(n.os_number as string, list)
    }

    return NextResponse.json({
      total: pageInfo.total,
      page: pageInfo.page,
      pages: pageInfo.pages,
      items: pageInfo.items.map((c) => {
        const ref = `${c.ssotica_id}-${year}`
        return {
          ref,
          extra: c.birth_date,
          since: c.registered_at,
          number: c.last_os_number ?? '',
          date: c.last_os_date ?? now,
          customer_name: c.name ?? '',
          seller: c.last_seller ?? '',
          lab: '',
          has_phone: (c.phones?.length ?? 0) > 0,
          notices: byRef.get(ref) ?? [],
        }
      }),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
