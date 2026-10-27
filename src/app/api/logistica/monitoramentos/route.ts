import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { fetchOsRange } from '@/lib/avisos/os'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { SsoticaError } from '@/lib/ssotica/client'
import { CorreiosTrackingError, isTrackingCode, normalizeTrackingCode, trackCorreiosObject } from '@/lib/correios/rastro'

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

export async function GET() {
  try {
    const { accountId } = await getCurrentAccount()
    const { data, error } = await supabaseAdmin()
      .from('correios_shipments')
      .select('id, tracking_code, os_date, os_number, customer_name, order_value, contact_id, last_status_code, last_status_text, last_event_at, last_checked_at, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: 'database_error' }, { status: 500 })
    return NextResponse.json({ items: data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent')
    const body = await request.json().catch(() => null)
    const trackingCode = normalizeTrackingCode(body?.tracking_code)
    const osNumber = String(body?.os_number ?? '').trim()
    const osDate = String(body?.os_date ?? '').trim()
    if (!isTrackingCode(trackingCode) || !/^\d{4}-\d{2}-\d{2}$/.test(osDate) || !osNumber) {
      return NextResponse.json({ error: 'bad_request', message: 'Informe o código e uma O.S. válida.' }, { status: 400 })
    }
    let tracking
    try {
      tracking = await trackCorreiosObject(trackingCode, accountId)
    } catch (error) {
      if (error instanceof CorreiosTrackingError) {
        return NextResponse.json({ error: error.code, message: error.message }, { status: error.status })
      }
      throw error
    }
    const db = supabaseAdmin()
    const { data: cfg } = await db.from('ssotica_config').select('cnpj, api_key').eq('account_id', accountId).maybeSingle()
    if (!cfg) return NextResponse.json({ error: 'not_configured' }, { status: 400 })
    let os
    try {
      const rows = await fetchOsRange({ apiKey: decrypt(cfg.api_key), cnpj: cfg.cnpj }, addDays(osDate, -2), addDays(osDate, 2))
      os = rows.find((item) => item.number === osNumber)
    } catch (error) {
      return NextResponse.json({ error: error instanceof SsoticaError ? error.code : 'ssotica_error' }, { status: 502 })
    }
    if (!os) return NextResponse.json({ error: 'os_not_found', message: 'A O.S. não foi encontrada no ssOtica.' }, { status: 404 })
    const contact = os.phones.map((phone) => findExistingContact(db, accountId, phone))
    const contacts = await Promise.all(contact)
    const linked = contacts.find(Boolean) ?? null
    const { data, error } = await db.from('correios_shipments').insert({
      account_id: accountId,
      tracking_code: trackingCode,
      os_date: os.date,
      os_number: os.number,
      customer_name: os.customerName,
      order_value: Number(body?.order_value) || 0,
      contact_id: linked?.id ?? null,
      last_status_code: tracking.statusCode,
      last_status_text: tracking.status,
      last_event_at: tracking.lastEventAt,
      last_checked_at: new Date().toISOString(),
      last_notified_fingerprint: tracking.fingerprint,
      created_by: userId,
    }).select('id, tracking_code, os_date, os_number, customer_name, order_value, contact_id, last_status_code, last_status_text, last_event_at, last_checked_at, created_at').single()
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'duplicate', message: 'Este código já está monitorado.' }, { status: 409 })
      return NextResponse.json({ error: 'database_error' }, { status: 500 })
    }
    return NextResponse.json({ item: data, linked: Boolean(linked) }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const { accountId } = await requireRole('agent')
    const body = await request.json().catch(() => null)
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown): id is string => typeof id === 'string') : []
    if (!ids.length || ids.length > 100) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    const { error } = await supabaseAdmin().from('correios_shipments').delete().eq('account_id', accountId).in('id', ids)
    if (error) return NextResponse.json({ error: 'database_error' }, { status: 500 })
    return NextResponse.json({ deleted: ids.length })
  } catch (error) {
    return toErrorResponse(error)
  }
}
