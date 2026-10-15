import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  STANDARD_CATEGORIES,
  listStandardMessages,
  type StandardCategory,
} from '@/lib/avisos/standard-messages'

const isCategory = (v: unknown): v is StandardCategory =>
  (STANDARD_CATEGORIES as unknown[]).includes(v)

/** GET /api/standard-messages[?category=] — the account's standard messages (seeds the mocks once). */
export async function GET(request: Request) {
  try {
    const { accountId } = await getCurrentAccount()
    const raw = new URL(request.url).searchParams.get('category')
    const messages = await listStandardMessages(
      supabaseAdmin(),
      accountId,
      isCategory(raw) ? raw : undefined,
    )
    return NextResponse.json({ messages })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST /api/standard-messages  { category, title, content_text }  (admin+) */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const text = typeof body?.content_text === 'string' ? body.content_text.trim() : ''
    if (!isCategory(body?.category) || !title || !text) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin()
      .from('standard_messages')
      .insert({
        account_id: accountId,
        category: body.category,
        title,
        content_text: text,
        position: 100,
      })
      .select('id, category, title, content_text, position')
      .single()
    if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 })
    return NextResponse.json({ message: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
