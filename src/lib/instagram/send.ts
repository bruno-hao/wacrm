import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  InstagramApiError,
  sendInstagramMessage as igSend,
  type InstagramAttachmentType,
} from './api'
import { sendWindow } from './events'

const MEDIA_TYPE: Record<string, InstagramAttachmentType> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'file',
}

export class InstagramSendError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'InstagramSendError'
    this.code = code
    this.status = status
  }
}

/**
 * Reply to an Instagram conversation and persist the message. Instagram
 * only allows replying (never starting a conversation), as text or one
 * media attachment; templates and buttons do not exist there.
 */
export async function sendInstagramReply(args: {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contact: { ig_user_id?: string | null }
  messageType: string
  contentText?: string | null
  mediaUrl?: string | null
}): Promise<{ messageId: string; instagramMessageId: string }> {
  const { db, accountId, conversationId, contact, messageType, contentText, mediaUrl } = args

  if (messageType !== 'text' && !MEDIA_TYPE[messageType]) {
    throw new InstagramSendError(
      'unsupported',
      'Instagram supports text and media messages only',
      400,
    )
  }
  if (!contact.ig_user_id) {
    throw new InstagramSendError('bad_request', 'Contact has no Instagram ID', 400)
  }

  const admin = supabaseAdmin()
  const { data: cfg } = await admin
    .from('instagram_config')
    .select('access_token, status')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!cfg || cfg.status !== 'connected') {
    throw new InstagramSendError('not_configured', 'Instagram is not connected', 400)
  }
  let token: string
  try {
    token = decrypt(cfg.access_token)
  } catch {
    throw new InstagramSendError('not_configured', 'Stored Instagram token is unreadable', 400)
  }

  const { data: last } = await admin
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const window = sendWindow((last as { created_at: string } | null)?.created_at ?? null)
  if (window === 'closed') {
    throw new InstagramSendError(
      'window_closed',
      'The 7-day Instagram reply window has closed',
      400,
    )
  }

  let mid: string
  try {
    const r = await igSend({
      token,
      recipientId: contact.ig_user_id,
      humanAgentTag: window === 'human_agent',
      ...(messageType === 'text'
        ? { text: contentText ?? '' }
        : { attachment: { type: MEDIA_TYPE[messageType], url: mediaUrl ?? '' } }),
    })
    mid = r.messageId
  } catch (err) {
    const msg = err instanceof InstagramApiError ? err.message : 'Instagram send failed'
    console.error('[instagram] send failed:', msg)
    throw new InstagramSendError('instagram_error', `Instagram API error: ${msg}`, 502)
  }

  const now = new Date().toISOString()
  // Idempotent: the webhook echo of this very message may land first.
  await db
    .from('messages')
    .upsert(
      {
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: messageType,
        content_text: contentText ?? null,
        media_url: mediaUrl ?? null,
        message_id: mid,
        status: 'sent',
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
  const { data: row } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('message_id', mid)
    .limit(1)
    .single()

  await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${messageType}]`,
      last_message_at: now,
      updated_at: now,
    })
    .eq('id', conversationId)

  return { messageId: (row as { id: string }).id, instagramMessageId: mid }
}
