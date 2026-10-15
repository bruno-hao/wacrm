import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { fetchOsRange } from '@/lib/avisos/os'
import { SendMessageError, sendMessageToConversation } from '@/lib/whatsapp/send-message'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const RETRY_AFTER_MS = 2 * 60_000

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * POST /api/avisos/send  { os_number, os_date, quick_reply_id }  (agent+)
 *
 * Sends one quick reply to the customer of an O.S. over WhatsApp and records
 * it in `os_notices`, so the same notice is never sent twice. The customer's
 * phone is read from ssOtica (never from the request), matched to a CRM
 * contact (created when missing) and its conversation.
 *
 * Replies `{ status: 'sent' | 'failed' | 'sending', error? }`.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`avisos-send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const osNumber = String(body?.os_number ?? '').trim()
    const osDate = String(body?.os_date ?? '')
    const quickReplyId = String(body?.quick_reply_id ?? '')
    if (!/^\d+$/.test(osNumber) || !DAY.test(osDate) || !quickReplyId) {
      return NextResponse.json({ status: 'failed', error: 'bad_request' }, { status: 400 })
    }

    const db = supabaseAdmin()

    // The quick reply (tenant-scoped through RLS) and the notice's history.
    const { data: reply } = await supabase
      .from('quick_replies')
      .select('id, title, kind, content_text, interactive_payload')
      .eq('id', quickReplyId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!reply) {
      return NextResponse.json({ status: 'failed', error: 'quick_reply_not_found' }, { status: 404 })
    }

    const { data: prior } = await db
      .from('os_notices')
      .select('id, status, updated_at')
      .eq('account_id', accountId)
      .eq('os_number', osNumber)
      .eq('quick_reply_id', quickReplyId)
      .maybeSingle()
    if (prior?.status === 'sent') {
      return NextResponse.json({ status: 'sent', error: 'already_sent' }, { status: 409 })
    }
    if (
      prior?.status === 'sending' &&
      Date.now() - new Date(prior.updated_at as string).getTime() < RETRY_AFTER_MS
    ) {
      return NextResponse.json({ status: 'sending', error: 'in_progress' }, { status: 409 })
    }

    // Reserve the notice BEFORE sending: the unique index stops a double click
    // or a second tab from sending the same message twice.
    const now = new Date().toISOString()
    let noticeId = prior?.id as string | undefined
    if (noticeId) {
      await db
        .from('os_notices')
        .update({ status: 'sending', error: null, updated_at: now, sent_by: userId })
        .eq('id', noticeId)
    } else {
      const { data: created, error: insErr } = await db
        .from('os_notices')
        .insert({
          account_id: accountId,
          os_number: osNumber,
          os_date: osDate,
          quick_reply_id: reply.id,
          quick_reply_title: reply.title,
          status: 'sending',
          sent_by: userId,
        })
        .select('id')
        .single()
      if (insErr || !created) {
        // Lost the race to a concurrent request.
        return NextResponse.json({ status: 'sending', error: 'in_progress' }, { status: 409 })
      }
      noticeId = created.id as string
    }

    const fail = async (error: string, extra: Record<string, unknown> = {}, http = 200) => {
      await db
        .from('os_notices')
        .update({ status: 'failed', error: error.slice(0, 300), updated_at: new Date().toISOString(), ...extra })
        .eq('id', noticeId!)
      return NextResponse.json({ status: 'failed', error }, { status: http })
    }

    // The O.S. and its customer, straight from ssOtica.
    const { data: cfg } = await db
      .from('ssotica_config')
      .select('cnpj, api_key')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!cfg) return fail('not_configured')
    let os
    try {
      const list = await fetchOsRange(
        { apiKey: decrypt(cfg.api_key), cnpj: cfg.cnpj },
        addDays(osDate, -1),
        addDays(osDate, 1),
      )
      os = list.find((o) => o.number === osNumber)
    } catch {
      return fail('ssotica_unavailable')
    }
    if (!os) return fail('os_not_found')
    if (!os.phones.length) return fail('no_phone')

    // CRM contact by phone (any of the customer's numbers); create if missing.
    let contactId: string | null = null
    for (const phone of os.phones) {
      const found = await findExistingContact(db, accountId, phone)
      if (found) {
        contactId = found.id
        break
      }
    }
    if (!contactId) {
      const { data: owner } = await db
        .from('ssotica_config')
        .select('created_by')
        .eq('account_id', accountId)
        .maybeSingle()
      const { data: contact, error: cErr } = await db
        .from('contacts')
        .insert({
          account_id: accountId,
          user_id: (owner?.created_by as string) ?? userId,
          phone: os.phones[0],
          name: os.customerName || null,
        })
        .select('id')
        .single()
      if (cErr || !contact) return fail('contact_failed')
      contactId = contact.id as string
    }

    // Conversation (oldest of the contact, or a new one).
    const { data: convRows } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1)
    let conversationId = convRows?.[0]?.id as string | undefined
    if (!conversationId) {
      const { data: conv, error: vErr } = await db
        .from('conversations')
        .insert({ account_id: accountId, user_id: userId, contact_id: contactId })
        .select('id')
        .single()
      if (vErr || !conv) return fail('conversation_failed')
      conversationId = conv.id as string
    }

    try {
      const sent = await sendMessageToConversation(db, accountId, {
        conversationId,
        senderUserId: userId,
        ...(reply.kind === 'interactive'
          ? { messageType: 'interactive', interactivePayload: reply.interactive_payload }
          : { messageType: 'text', contentText: reply.content_text }),
      })
      await db
        .from('os_notices')
        .update({
          status: 'sent',
          error: null,
          contact_id: contactId,
          conversation_id: conversationId,
          message_id: sent.messageId,
          customer_name: os.customerName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', noticeId)
      return NextResponse.json({ status: 'sent' })
    } catch (err) {
      const msg = err instanceof SendMessageError ? err.message : 'send_failed'
      return fail(msg, { contact_id: contactId, conversation_id: conversationId, customer_name: os.customerName })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
