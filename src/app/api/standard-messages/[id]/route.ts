import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/** PATCH /api/standard-messages/:id  { title?, content_text? }  (admin+) */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { accountId } = await requireRole('admin')
    const { id } = await params
    const body = await request.json().catch(() => null)
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body?.title === 'string') {
      if (!body.title.trim()) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
      update.title = body.title.trim()
    }
    if (typeof body?.content_text === 'string') {
      if (!body.content_text.trim()) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
      update.content_text = body.content_text.trim()
    }
    const { data, error } = await supabaseAdmin()
      .from('standard_messages')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, category, title, content_text, position')
      .maybeSingle()
    if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ message: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/standard-messages/:id  (admin+) */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { accountId } = await requireRole('admin')
    const { id } = await params
    const { error } = await supabaseAdmin()
      .from('standard_messages')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
