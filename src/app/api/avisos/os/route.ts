import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { SsoticaError } from '@/lib/ssotica/client'
import {
  SITUATIONS,
  fetchOsRange,
  filterOs,
  paginate,
  sortOs,
  type Situation,
  type SoldFilter,
} from '@/lib/avisos/os'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_SPAN_DAYS = 400

/** Today in the store's timezone (America/Bahia, UTC-3) as yyyy-mm-dd. */
function today(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
}
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * GET /api/avisos/os — the Avisos para Clientes list.
 *   from, to    yyyy-mm-dd (default: 60 days back → today, server date)
 *   q           customer name, O.S. number, seller or laboratory
 *   situations  comma list of nao_entregue,entregue,cancelada,perda
 *   sold        comma list of sold,not_sold
 *   page        10 O.S. per page
 * Each row carries the notices already sent for it.
 */
export async function GET(request: Request) {
  try {
    const { accountId } = await getCurrentAccount()
    const sp = new URL(request.url).searchParams

    const to = DAY.test(sp.get('to') ?? '') ? sp.get('to')! : today()
    const from = DAY.test(sp.get('from') ?? '') ? sp.get('from')! : addDays(to, -60)
    if (from > to) return NextResponse.json({ error: 'invalid_range' }, { status: 400 })
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_SPAN_DAYS) {
      return NextResponse.json({ error: 'range_too_long' }, { status: 400 })
    }

    const situations = (sp.get('situations') ?? '')
      .split(',')
      .filter((s): s is Situation => (SITUATIONS as string[]).includes(s))
    const sold = (sp.get('sold') ?? '')
      .split(',')
      .filter((s): s is SoldFilter => s === 'sold' || s === 'not_sold')

    const db = supabaseAdmin()
    const { data: cfg } = await db
      .from('ssotica_config')
      .select('cnpj, api_key')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!cfg) return NextResponse.json({ error: 'not_configured' }, { status: 400 })

    let all
    try {
      all = await fetchOsRange({ apiKey: decrypt(cfg.api_key), cnpj: cfg.cnpj }, from, to)
    } catch (err) {
      const code = err instanceof SsoticaError ? err.code : 'unexpected'
      return NextResponse.json({ error: code }, { status: 502 })
    }

    const filtered = sortOs(filterOs(all, { q: sp.get('q') ?? '', situations, sold }))
    const pageInfo = paginate(filtered, Number(sp.get('page')) || 1, 10)

    const numbers = pageInfo.items.map((o) => o.number)
    const { data: notices } = numbers.length
      ? await db
          .from('os_notices')
          .select('os_number, quick_reply_id, status')
          .eq('account_id', accountId)
          .in('os_number', numbers)
      : { data: [] }
    const byOs = new Map<string, { quick_reply_id: string; status: string }[]>()
    for (const n of notices ?? []) {
      const list = byOs.get(n.os_number as string) ?? []
      list.push({ quick_reply_id: n.quick_reply_id as string, status: n.status as string })
      byOs.set(n.os_number as string, list)
    }

    return NextResponse.json({
      from,
      to,
      total: pageInfo.total,
      page: pageInfo.page,
      pages: pageInfo.pages,
      items: pageInfo.items.map((o) => ({
        number: o.number,
        date: o.date,
        customer_name: o.customerName,
        seller: o.seller,
        lab: o.lab,
        status: o.status,
        situation: o.situation,
        sold: o.sold,
        has_phone: o.phones.length > 0,
        notices: byOs.get(o.number) ?? [],
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
