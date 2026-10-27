import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { encrypt } from '@/lib/whatsapp/encryption'
import { getCorreiosAccessToken, CorreiosAuthError } from '@/lib/correios/auth'

export async function GET() {
  try {
    const { accountId } = await getCurrentAccount()
    const { data, error } = await supabaseAdmin().from('correios_credentials').select('username, token_expires_at, updated_at').eq('account_id', accountId).maybeSingle()
    if (error) return NextResponse.json({ error: 'load_failed' }, { status: 500 })
    return NextResponse.json({ configured: Boolean(data), has_username: Boolean(data?.username), token_expires_at: data?.token_expires_at ?? null, updated_at: data?.updated_at ?? null })
  } catch (error) { return toErrorResponse(error) }
}

export async function PUT(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!username || !password) return NextResponse.json({ error: 'required', message: 'Informe o usuário e a senha do Meu Correios.' }, { status: 400 })
    const db = supabaseAdmin()
    const { error } = await db.from('correios_credentials').upsert({ account_id: accountId, username: encrypt(username), password: encrypt(password), access_token: null, token_expires_at: null, last_error: null, created_by: userId }, { onConflict: 'account_id' })
    if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 })
    try {
      await getCorreiosAccessToken(accountId)
    } catch (error) {
      return NextResponse.json({ error: error instanceof CorreiosAuthError ? error.code : 'auth_error', message: error instanceof Error ? error.message : 'Não foi possível autenticar nos Correios.' }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  } catch (error) { return toErrorResponse(error) }
}

export async function DELETE() {
  try {
    const { accountId } = await requireRole('admin')
    const { error } = await supabaseAdmin().from('correios_credentials').delete().eq('account_id', accountId)
    if (error) return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (error) { return toErrorResponse(error) }
}
