import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { fetchOsRange, sortOs } from '@/lib/avisos/os'
import { SsoticaError } from '@/lib/ssotica/client'

function day(value: string | null, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  try {
    const { accountId } = await getCurrentAccount()
    const params = new URL(request.url).searchParams
    const today = new Date().toISOString().slice(0, 10)
    const to = day(params.get('to'), today)
    const from = day(params.get('from'), addDays(to, -90))
    if (from > to || Date.parse(to) - Date.parse(from) > 366 * 86_400_000) {
      return NextResponse.json({ error: 'invalid_range' }, { status: 400 })
    }
    const db = supabaseAdmin()
    const { data: cfg } = await db.from('ssotica_config').select('cnpj, api_key').eq('account_id', accountId).maybeSingle()
    if (!cfg) return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    try {
      const items = sortOs(await fetchOsRange({ apiKey: decrypt(cfg.api_key), cnpj: cfg.cnpj }, from, to))
      return NextResponse.json({ items: items.map((item) => ({
        date: item.date,
        number: item.number,
        customerName: item.customerName,
        value: 0,
        customerId: item.customerId,
        hasPhone: item.phones.length > 0,
      })) })
    } catch (error) {
      return NextResponse.json({ error: error instanceof SsoticaError ? error.code : 'ssotica_error' }, { status: 502 })
    }
  } catch (error) {
    return toErrorResponse(error)
  }
}
