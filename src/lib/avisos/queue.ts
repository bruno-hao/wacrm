// ============================================================
// Avisos: background queue for the WhatsApp notices.
//
// The page queues the selected O.S.; a worker (started by the request and
// resumed every minute by /api/cron/avisos-queue) sends them one by one with
// a random 5–15 s pause. Each notice lives in `os_notices`:
//   queued → sending → sent | failed
// The unique (account, O.S., quick reply) index keeps a notice from going
// out twice.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { SendMessageError, sendMessageToConversation } from '@/lib/whatsapp/send-message'
import { fetchOsRange } from './os'

export const MIN_GAP_MS = 5_000
export const MAX_GAP_MS = 15_000
export const MAX_BATCH = 100
/** A notice stuck "sending" this long was interrupted (restart / crash). */
const STALE_SENDING_MS = 3 * 60_000

/** Random pause between two sends, 5–15 s. */
export function randomGapMs(rand: () => number = Math.random): number {
  return MIN_GAP_MS + Math.floor(rand() * (MAX_GAP_MS - MIN_GAP_MS + 1))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export interface QueueItem {
  os_number: string
  os_date: string
}

/** Put the selected O.S. in the queue; notices already sent / in flight are skipped. */
export async function enqueueNotices(
  db: SupabaseClient,
  args: { accountId: string; userId: string; reply: { id: string; title: string }; items: QueueItem[] },
): Promise<{ queued: number; skipped: number }> {
  const { accountId, userId, reply, items } = args
  let queued = 0
  let skipped = 0
  const base = Date.now()

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const { data: prior } = await db
      .from('os_notices')
      .select('id, status, updated_at')
      .eq('account_id', accountId)
      .eq('os_number', it.os_number)
      .eq('quick_reply_id', reply.id)
      .maybeSingle()

    const inFlight =
      prior &&
      (prior.status === 'queued' ||
        (prior.status === 'sending' &&
          Date.now() - new Date(prior.updated_at as string).getTime() < STALE_SENDING_MS))
    if (prior?.status === 'sent' || inFlight) {
      skipped++
      continue
    }

    const stamp = new Date(base + i).toISOString()
    const row = {
      status: 'queued',
      error: null,
      queued_at: stamp,
      updated_at: stamp,
      sent_by: userId,
      os_date: it.os_date,
      quick_reply_title: reply.title,
    }
    if (prior) {
      await db.from('os_notices').update(row).eq('id', prior.id)
      queued++
    } else {
      const { error } = await db.from('os_notices').insert({
        account_id: accountId,
        os_number: it.os_number,
        quick_reply_id: reply.id,
        ...row,
      })
      if (error) skipped++ // lost a race with a concurrent request
      else queued++
    }
  }
  return { queued, skipped }
}

interface NoticeRow {
  id: string
  account_id: string
  os_number: string
  os_date: string | null
  quick_reply_id: string | null
  sent_by: string | null
}

/** Send one queued notice and record the outcome. Never throws. */
export async function deliverNotice(db: SupabaseClient, notice: NoticeRow): Promise<void> {
  const finish = (patch: Record<string, unknown>) =>
    db
      .from('os_notices')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', notice.id)
  const fail = (error: string, extra: Record<string, unknown> = {}) =>
    finish({ status: 'failed', error: error.slice(0, 300), ...extra })

  try {
    const accountId = notice.account_id
    const { data: reply } = notice.quick_reply_id
      ? await db
          .from('quick_replies')
          .select('id, kind, content_text, interactive_payload')
          .eq('id', notice.quick_reply_id)
          .eq('account_id', accountId)
          .maybeSingle()
      : { data: null }
    if (!reply) return void (await fail('quick_reply_not_found'))

    const { data: cfg } = await db
      .from('ssotica_config')
      .select('cnpj, api_key, created_by')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!cfg || !notice.os_date) return void (await fail('not_configured'))

    // The O.S. and its customer, straight from ssOtica.
    let os
    try {
      const list = await fetchOsRange(
        { apiKey: decrypt(cfg.api_key), cnpj: cfg.cnpj },
        addDays(notice.os_date, -1),
        addDays(notice.os_date, 1),
      )
      os = list.find((o) => o.number === notice.os_number)
    } catch {
      return void (await fail('ssotica_unavailable'))
    }
    if (!os) return void (await fail('os_not_found'))
    if (!os.phones.length) return void (await fail('no_phone'))

    // CRM contact by phone (any of the customer's numbers); create if missing.
    let contactId: string | null = null
    for (const phone of os.phones) {
      const found = await findExistingContact(db, accountId, phone)
      if (found) {
        contactId = found.id
        break
      }
    }
    const ownerId = (cfg.created_by as string) ?? notice.sent_by
    if (!contactId) {
      const { data: contact, error } = await db
        .from('contacts')
        .insert({
          account_id: accountId,
          user_id: ownerId,
          phone: os.phones[0],
          name: os.customerName || null,
        })
        .select('id')
        .single()
      if (error || !contact) return void (await fail('contact_failed'))
      contactId = contact.id as string
    }

    // Conversation: the contact's oldest, or a new one.
    const { data: convRows } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1)
    let conversationId = convRows?.[0]?.id as string | undefined
    if (!conversationId) {
      const { data: conv, error } = await db
        .from('conversations')
        .insert({ account_id: accountId, user_id: notice.sent_by ?? ownerId, contact_id: contactId })
        .select('id')
        .single()
      if (error || !conv) return void (await fail('conversation_failed'))
      conversationId = conv.id as string
    }

    try {
      const sent = await sendMessageToConversation(db, accountId, {
        conversationId,
        senderUserId: notice.sent_by,
        skipAgentTag: true,
        ...(reply.kind === 'interactive'
          ? { messageType: 'interactive', interactivePayload: reply.interactive_payload }
          : { messageType: 'text', contentText: reply.content_text }),
      })
      await finish({
        status: 'sent',
        error: null,
        contact_id: contactId,
        conversation_id: conversationId,
        message_id: sent.messageId,
        customer_name: os.customerName,
      })
    } catch (err) {
      await fail(err instanceof SendMessageError ? err.message : 'send_failed', {
        contact_id: contactId,
        conversation_id: conversationId,
        customer_name: os.customerName,
      })
    }
  } catch (err) {
    console.error('[avisos] deliver failed:', err instanceof Error ? err.message : err)
    await fail('send_failed')
  }
}

const active = new Set<string>()

/**
 * Drain the account's queue: oldest first, a random 5–15 s pause between
 * messages. One worker per account per process; a second call returns at
 * once, so the cron can call it every minute without double-sending.
 */
export async function runNoticeWorker(db: SupabaseClient, accountId: string): Promise<void> {
  if (active.has(accountId)) return
  active.add(accountId)
  try {
    // Anything left "sending" by a crash or restart is reported, not re-sent.
    await db
      .from('os_notices')
      .update({ status: 'failed', error: 'interrupted', updated_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('status', 'sending')
      .lt('updated_at', new Date(Date.now() - STALE_SENDING_MS).toISOString())

    let first = true
    for (;;) {
      const { data: next } = await db
        .from('os_notices')
        .select('id')
        .eq('account_id', accountId)
        .eq('status', 'queued')
        .order('queued_at', { ascending: true })
        .limit(1)
      if (!next?.length) break

      if (!first) await sleep(randomGapMs())
      first = false

      // Claim it (a notice can only be picked up once).
      const { data: claimed } = await db
        .from('os_notices')
        .update({ status: 'sending', updated_at: new Date().toISOString() })
        .eq('id', next[0].id)
        .eq('status', 'queued')
        .select('id, account_id, os_number, os_date, quick_reply_id, sent_by')
      if (!claimed?.length) continue
      await deliverNotice(db, claimed[0] as NoticeRow)
    }
  } finally {
    active.delete(accountId)
  }
}
