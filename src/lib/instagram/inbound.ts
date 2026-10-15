import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { mirrorInboundMedia } from '@/lib/whatsapp/mirror-inbound-media'
import { reopenClosedConversation } from '@/lib/conversations/reopen'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { getProfile } from './api'
import {
  normalizeInstagramWebhook,
  type IgEvent,
  type IgMessageEvent,
  type IgMessagePart,
  type IgSeenEvent,
} from './events'

interface IgConfigRow {
  account_id: string
  created_by: string | null
  ig_user_id: string
  access_token: string
}

/** Download a public Instagram CDN attachment (no auth header needed). */
async function downloadPlain({ downloadUrl }: { downloadUrl: string; accessToken: string }) {
  const res = await fetch(downloadUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  }
}

async function findOrCreateContact(
  db: SupabaseClient,
  cfg: IgConfigRow,
  token: string,
  igsid: string,
): Promise<{ id: string } | null> {
  const find = async () => {
    const { data } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', cfg.account_id)
      .eq('ig_user_id', igsid)
      .maybeSingle()
    return data as { id: string } | null
  }
  const existing = await find()
  if (existing) return existing

  // First message from this person: fetch the public profile once.
  let name: string | null = null
  let username: string | null = null
  let picture: string | null = null
  try {
    const p = await getProfile(token, igsid)
    name = p.name
    username = p.username
    picture = p.profilePic
  } catch (err) {
    console.warn(
      '[instagram] profile lookup failed:',
      err instanceof Error ? err.message : err,
    )
  }

  const { data, error } = await db
    .from('contacts')
    .insert({
      account_id: cfg.account_id,
      user_id: cfg.created_by,
      // `phone` is NOT NULL in the schema; '' is what BSUID-only contacts
      // use too, and the phone unique index tolerates it.
      phone: '',
      name: name || (username ? `@${username}` : `Instagram ${igsid.slice(-6)}`),
      ig_user_id: igsid,
      wa_username: username,
      avatar_url: picture,
    })
    .select('id')
    .single()
  if (error) {
    if (isUniqueViolation(error)) return find()
    console.error('[instagram] could not create contact:', error.message)
    return null
  }
  return data as { id: string }
}

interface InitialState {
  lastMessageText: string
  lastMessageAt: string
  unreadCount: number
}

/**
 * A brand-new conversation is INSERTed already carrying its preview and
 * unread count. The inbox hydrates a conversation as soon as the INSERT
 * reaches it (realtime); if the preview were only written by a follow-up
 * UPDATE a few milliseconds later, that hydration could read the row in
 * between and the list would keep showing "no messages yet" until the next
 * message.
 */
async function findOrCreateConversation(
  db: SupabaseClient,
  cfg: IgConfigRow,
  contactId: string,
  initial: InitialState,
): Promise<{ conversation: { id: string; status: string }; created: boolean } | null> {
  const select = () =>
    db
      .from('conversations')
      .select('id, status')
      .eq('account_id', cfg.account_id)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1)
  const { data: rows } = await select()
  if (rows?.length) return { conversation: rows[0] as { id: string; status: string }, created: false }

  const { data, error } = await db
    .from('conversations')
    .insert({
      account_id: cfg.account_id,
      user_id: cfg.created_by,
      contact_id: contactId,
      channel: 'instagram',
      last_message_text: initial.lastMessageText,
      last_message_at: initial.lastMessageAt,
      unread_count: initial.unreadCount,
    })
    .select('id, status')
    .single()
  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced } = await select()
      if (raced?.length) return { conversation: raced[0] as { id: string; status: string }, created: false }
    }
    console.error('[instagram] could not create conversation:', error.message)
    return null
  }
  return { conversation: data as { id: string; status: string }, created: true }
}

function previewOf(part: IgMessagePart): string {
  return part.text || `[${part.contentType}]`
}

async function handleMessage(
  db: SupabaseClient,
  cfg: IgConfigRow,
  token: string,
  ev: IgMessageEvent,
) {
  const contact = await findOrCreateContact(db, cfg, token, ev.peerId)
  if (!contact) return
  const createdAt = new Date(ev.timestamp * 1000).toISOString()
  const found = await findOrCreateConversation(db, cfg, contact.id, {
    lastMessageText: previewOf(ev.parts[ev.parts.length - 1]),
    lastMessageAt: createdAt,
    unreadCount: ev.isEcho ? 0 : 1,
  })
  if (!found) return
  const { conversation, created } = found
  let newest: IgMessagePart | null = null
  let insertedAny = false

  for (const part of ev.parts) {
    let mediaUrl = part.mediaUrl
    if (part.mediaUrl) {
      // Instagram CDN links expire: keep our own copy.
      const mirrored = await mirrorInboundMedia({
        storage: db.storage,
        accountId: cfg.account_id,
        mediaId: part.id.replace(/[^A-Za-z0-9_-]/g, '-').slice(-48),
        downloadUrl: part.mediaUrl,
        accessToken: token,
        messageTimestamp: String(ev.timestamp),
        download: downloadPlain,
      })
      mediaUrl = mirrored ?? part.mediaUrl
    }

    // Idempotent on (conversation_id, message_id): webhook retries and the
    // echo of a message the CRM itself sent both collapse into one row.
    const { data: inserted, error } = await db
      .from('messages')
      .upsert(
        {
          conversation_id: conversation.id,
          sender_type: ev.isEcho ? 'agent' : 'customer',
          content_type: part.contentType,
          content_text: part.text,
          media_url: mediaUrl,
          message_id: part.id,
          status: ev.isEcho ? 'sent' : 'delivered',
          created_at: createdAt,
        },
        { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
      )
      .select('id')
    if (error) {
      console.error('[instagram] could not store message:', error.message)
      continue
    }
    if (inserted?.length) {
      insertedAny = true
      newest = part
    }
  }

  if (!insertedAny || !newest) return

  // A conversation created by this very message already carries its
  // preview and unread count (see findOrCreateConversation).
  if (created) return

  if (ev.isEcho) {
    // We sent it (CRM, Instagram app or another tool): no unread bump.
    await db
      .from('conversations')
      .update({
        last_message_text: previewOf(newest),
        last_message_at: createdAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)
    return
  }

  await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversation.id,
    p_last_message_text: previewOf(newest),
  })
  await reopenClosedConversation(db, conversation)
}

async function handleSeen(db: SupabaseClient, cfg: IgConfigRow, ev: IgSeenEvent) {
  const { data: contact } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', cfg.account_id)
    .eq('ig_user_id', ev.peerId)
    .maybeSingle()
  if (!contact) return
  const { data: conv } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', cfg.account_id)
    .eq('contact_id', (contact as { id: string }).id)
    .limit(1)
    .maybeSingle()
  if (!conv) return
  await db
    .from('messages')
    .update({ status: 'read' })
    .eq('conversation_id', (conv as { id: string }).id)
    .in('sender_type', ['agent', 'bot'])
    .neq('status', 'read')
    .lte('created_at', new Date(ev.timestamp * 1000).toISOString())
}

/** Process a verified Instagram webhook body. Never throws. */
export async function processInstagramWebhook(body: unknown): Promise<void> {
  const events: IgEvent[] = normalizeInstagramWebhook(body)
  if (!events.length) return
  const db = supabaseAdmin()

  const configs = new Map<string, { cfg: IgConfigRow; token: string } | null>()
  for (const ev of events) {
    try {
      if (!configs.has(ev.accountIgId)) {
        const { data } = await db
          .from('instagram_config')
          .select('account_id, created_by, ig_user_id, access_token')
          .eq('ig_user_id', ev.accountIgId)
          .eq('status', 'connected')
          .maybeSingle()
        configs.set(
          ev.accountIgId,
          data
            ? { cfg: data as IgConfigRow, token: decrypt((data as IgConfigRow).access_token) }
            : null,
        )
      }
      const entry = configs.get(ev.accountIgId)
      if (!entry) {
        console.warn('[instagram] no connected account for', ev.accountIgId)
        continue
      }
      if (ev.kind === 'message') await handleMessage(db, entry.cfg, entry.token, ev)
      else await handleSeen(db, entry.cfg, ev)
    } catch (err) {
      console.error('[instagram] event failed:', err instanceof Error ? err.message : err)
    }
  }
}
