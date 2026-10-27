import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { saveGoogleConfig } from '@/lib/google/business-profile'

export async function GET() {
  try {
    const { accountId } = await getCurrentAccount()
    const { data, error } = await supabaseAdmin().from('google_business_profile_config').select('client_id, account_name, location_name, business_name, verified_at').eq('account_id', accountId).maybeSingle()
    if (error) return NextResponse.json({ error: 'load_failed' }, { status: 500 })
    return NextResponse.json({ configured: Boolean(data), has_client_secret: Boolean(data?.client_id), account_name: data?.account_name ?? '', location_name: data?.location_name ?? '', business_name: data?.business_name ?? '', verified_at: data?.verified_at ?? null })
  } catch (error) { return toErrorResponse(error) }
}

export async function PUT(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const values = { clientId: String(body?.client_id ?? '').trim(), clientSecret: String(body?.client_secret ?? '').trim(), refreshToken: String(body?.refresh_token ?? '').trim(), accountName: String(body?.account_name ?? '').trim(), locationName: String(body?.location_name ?? '').trim(), businessName: String(body?.business_name ?? '').trim() }
    if (!values.clientId || !values.clientSecret || !values.refreshToken || !values.accountName || !values.locationName) return NextResponse.json({ error: 'required', message: 'Informe client ID, client secret, refresh token, conta e local do Google.' }, { status: 400 })
    await saveGoogleConfig(accountId, userId, values)
    return NextResponse.json({ success: true })
  } catch (error) { return toErrorResponse(error) }
}

export async function DELETE() {
  try { const { accountId } = await requireRole('admin'); const { error } = await supabaseAdmin().from('google_business_profile_config').delete().eq('account_id', accountId); if (error) return NextResponse.json({ error: 'delete_failed' }, { status: 500 }); return NextResponse.json({ success: true }) } catch (error) { return toErrorResponse(error) }
}
