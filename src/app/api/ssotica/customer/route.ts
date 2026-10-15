import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { canonicalPhone } from '@/lib/ssotica/sync'
import { saleUrl } from '@/lib/ssotica/links'

/**
 * GET /api/ssotica/customer?phone=<digits>
 *
 * Is this phone a ssOtica customer? Answered from the local index (see
 * /api/cron/ssotica-sync). Phones compare in their canonical form
 * (Brazilian mobiles always with the ninth digit), so 5573 8239-5770 and
 * 5573 98239-5770 are the same customer.
 *
 *   status "unavailable" — ssOtica not configured or the first sync is
 *                          still running (we must not call everyone "new")
 *   status "customer"    — found, with last OS / sale / prescription date
 *   status "new"         — synced index has no such phone
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const phone = canonicalPhone(new URL(request.url).searchParams.get('phone'))
    if (!phone) return NextResponse.json({ status: 'unavailable' })

    const { data: state } = await supabase
      .from('ssotica_sync_state')
      .select('phase')
      .eq('account_id', accountId)
      .maybeSingle()
    if (state?.phase !== 'live') return NextResponse.json({ status: 'unavailable' })

    const { data: rows, error } = await supabase
      .from('ssotica_customers')
      .select(
        'name, last_os_number, last_os_date, last_os_status, last_os_etapa, last_os_sold, last_receita_date, last_sale_number, last_sale_date, last_sale_value',
      )
      .eq('account_id', accountId)
      .contains('phones', [phone])
      .limit(5)
    if (error) {
      console.error('[ssotica/customer] lookup error:', error)
      return NextResponse.json({ status: 'unavailable' })
    }
    if (!rows?.length) return NextResponse.json({ status: 'new' })

    // Same phone on several customer records (family): show the one with
    // the most recent sale.
    const best = [...rows].sort((a, b) =>
      String(b.last_sale_date ?? '').localeCompare(String(a.last_sale_date ?? '')),
    )[0]
    const { data: cfg } = await supabase
      .from('ssotica_config')
      .select('store_hash')
      .eq('account_id', accountId)
      .maybeSingle()
    return NextResponse.json({
      status: 'customer',
      name: best.name,
      os_number: best.last_os_number,
      os_date: best.last_os_date,
      os_status: best.last_os_status,
      // Stage is only processed once the OS is sold (and still alive).
      os_stage:
        best.last_os_sold &&
        best.last_os_status !== 'CANCELADO' &&
        best.last_os_status !== 'PERDA'
          ? best.last_os_etapa
          : null,
      os_sold: best.last_os_sold,
      receita_date: best.last_receita_date,
      sale_number: best.last_sale_number,
      sale_date: best.last_sale_date,
      sale_value: best.last_sale_value,
      sale_url: saleUrl(cfg?.store_hash, best.last_sale_number),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
