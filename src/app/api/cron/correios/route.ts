import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { trackCorreiosObject } from '@/lib/correios/rastro'
import { sendMessageToConversation } from '@/lib/whatsapp/send-message'

export const maxDuration = 300

function authorized(request: Request): boolean {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) return false
  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '')
  const want = Buffer.from(expected)
  return supplied.length === want.length && timingSafeEqual(supplied, want)
}

async function notify(db: ReturnType<typeof supabaseAdmin>, row: Record<string, unknown>, text: string): Promise<boolean> {
  const contactId = row.contact_id as string | null
  if (!contactId) return true
  const accountId = row.account_id as string
  const { data: contact } = await db.from('contacts').select('id, user_id').eq('id', contactId).eq('account_id', accountId).maybeSingle()
  if (!contact) return true
  let { data: conversation } = await db.from('conversations').select('id').eq('account_id', accountId).eq('contact_id', contactId).order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!conversation) {
    const created = await db.from('conversations').insert({ account_id: accountId, user_id: contact.user_id, contact_id: contactId }).select('id').single()
    conversation = created.data
  }
  if (!conversation?.id) return false
  try {
    await sendMessageToConversation(db, accountId, { conversationId: conversation.id, messageType: 'text', contentText: text, senderUserId: null, skipAgentTag: true })
    return true
  } catch (error) {
    console.error('[correios-cron] notification failed:', error instanceof Error ? error.message : error)
    return false
  }
}

export async function GET(request: Request) {
  if (!process.env.AUTOMATION_CRON_SECRET) return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = supabaseAdmin()
  const { data: rows, error } = await db.from('correios_shipments').select('*').limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const result = { checked: 0, changed: 0, notified: 0, failed: 0 }
  for (const row of rows ?? []) {
    try {
      const tracking = await trackCorreiosObject(row.tracking_code, row.account_id)
      const changed = row.last_notified_fingerprint && row.last_notified_fingerprint !== tracking.fingerprint
      let notified = true
      if (changed) {
        const event = tracking.events[0]
        const message = `Atualização da encomenda ${row.tracking_code}: ${tracking.status}${event?.location ? ` — ${event.location}` : ''}${event?.date ? ` (${event.date})` : ''}.`
        notified = await notify(db, row, message)
        if (notified) result.notified++
        result.changed++
      }
      const patch: Record<string, unknown> = {
        last_status_code: tracking.statusCode,
        last_status_text: tracking.status,
        last_event_at: tracking.lastEventAt,
        last_checked_at: new Date().toISOString(),
      }
      if (!changed || notified) patch.last_notified_fingerprint = tracking.fingerprint
      await db.from('correios_shipments').update(patch).eq('id', row.id).eq('account_id', row.account_id)
      result.checked++
    } catch (error) {
      result.failed++
      console.error('[correios-cron] tracking failed:', error instanceof Error ? error.message : error)
      await db.from('correios_shipments').update({ last_checked_at: new Date().toISOString() }).eq('id', row.id).eq('account_id', row.account_id)
    }
  }
  return NextResponse.json({ ok: true, ...result })
}
