import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  parseWahaCreds,
  wahaLidToPhone,
  wahaPhoneNumberId,
} from '@/lib/whatsapp/waha-api'
import {
  processWebhook,
  type WhatsAppMessage,
  type WhatsAppWebhookEntry,
} from '@/lib/whatsapp/inbound-processor'

/**
 * POST /api/whatsapp/waha/webhook?s=<per-account secret>
 *
 * Receiver for events from a WAHA server. WAHA has no Meta-style app
 * signature, so each account's webhook URL carries a random secret
 * (whatsapp_config.waha_webhook_secret). The event is translated into the
 * Meta webhook shape and handed to the same processor the Meta webhook
 * uses, so contacts, conversations, automations, flows, AI replies and the
 * media mirror behave identically for both providers.
 */
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function supabaseAdmin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Loose = any

function digits(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\D/g, '') : ''
}

/** Phone digits for a WAHA contact id, resolving "@lid" ids when possible. */
async function senderPhone(
  from: string,
  data: Loose,
  creds: ReturnType<typeof parseWahaCreds>,
): Promise<string | null> {
  if (from.endsWith('@c.us') || from.endsWith('@s.whatsapp.net')) {
    return digits(from.split('@')[0]) || null
  }
  if (from.endsWith('@lid')) {
    const alt =
      data?.key?.remoteJidAlt ||
      data?.key?.participantAlt ||
      data?.senderPn ||
      data?.key?.senderPn
    if (typeof alt === 'string' && alt.includes('@')) {
      const d = digits(alt.split('@')[0])
      if (d) return d
    }
    return wahaLidToPhone(creds, from)
  }
  return null
}

function mediaKind(mime: string, data: Loose): WhatsAppMessage['type'] {
  const m = (mime || '').toLowerCase()
  if (data?.message?.stickerMessage) return 'sticker'
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  return 'document'
}

async function translateMessage(
  event: Loose,
  creds: ReturnType<typeof parseWahaCreds>,
): Promise<{ message: WhatsAppMessage; name?: string; wa_id: string } | null> {
  const p = event.payload
  if (!p || p.fromMe) return null
  const from: string = p.from || ''
  // Only 1:1 chats — no groups, status updates or broadcast lists.
  if (!from || from.endsWith('@g.us') || from.includes('status@broadcast')) return null

  const phone = await senderPhone(from, p._data, creds)
  if (!phone) {
    console.warn('[waha-webhook] could not resolve a phone number for', from)
    return null
  }

  const base: WhatsAppMessage = {
    id: String(p.id),
    from: phone,
    timestamp: String(p.timestamp || Math.floor(Date.now() / 1000)),
    type: 'text',
  }
  if (p.replyTo?.id) base.context = { id: String(p.replyTo.id) }

  const name: string | undefined =
    p._data?.pushName || p._data?.notifyName || undefined

  if (p.hasMedia && p.media?.url) {
    const mime: string = p.media.mimetype || ''
    const kind = mediaKind(mime, p._data)
    const synthetic = String(p.id)
    base.type = kind
    base.waha_media = {
      url: p.media.url,
      mimetype: mime || undefined,
      filename: p.media.filename || undefined,
    }
    const caption = typeof p.body === 'string' && p.body ? p.body : undefined
    if (kind === 'image') base.image = { id: synthetic, mime_type: mime, caption }
    else if (kind === 'video') base.video = { id: synthetic, mime_type: mime, caption }
    else if (kind === 'audio') base.audio = { id: synthetic, mime_type: mime }
    else if (kind === 'sticker') base.sticker = { id: synthetic, mime_type: mime }
    else
      base.document = {
        id: synthetic,
        mime_type: mime,
        filename: p.media.filename || undefined,
        caption,
      }
    return { message: base, name, wa_id: phone }
  }

  if (p.location?.latitude != null) {
    base.type = 'location'
    base.location = {
      latitude: Number(p.location.latitude),
      longitude: Number(p.location.longitude),
      name: p.location.name || undefined,
      address: p.location.address || undefined,
    }
    return { message: base, name, wa_id: phone }
  }

  const text = typeof p.body === 'string' ? p.body : ''
  if (!text) return null // empty / protocol messages
  base.text = { body: text }
  return { message: base, name, wa_id: phone }
}

const ACK_TO_STATUS: Record<string, string> = {
  SERVER: 'sent',
  DEVICE: 'delivered',
  READ: 'read',
  PLAYED: 'read',
  ERROR: 'failed',
}

export async function POST(request: Request) {
  const secret = new URL(request.url).searchParams.get('s')
  if (!secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: config, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('id, account_id, access_token, provider')
    .eq('waha_webhook_secret', secret)
    .eq('provider', 'waha')
    .maybeSingle()
  if (error || !config) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let event: Loose
  try {
    event = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  after(async () => {
    try {
      const creds = parseWahaCreds(decrypt(config.access_token))
      const phoneNumberId = wahaPhoneNumberId(config.account_id)
      const metadata = { display_phone_number: '', phone_number_id: phoneNumberId }

      switch (event.event) {
        case 'message': {
          const tr = await translateMessage(event, creds)
          if (!tr) return
          const entry: WhatsAppWebhookEntry = {
            id: phoneNumberId,
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata,
                  contacts: [
                    { profile: { name: tr.name }, wa_id: tr.wa_id },
                  ],
                  messages: [tr.message],
                },
              },
            ],
          }
          await processWebhook({ entry: [entry] })
          return
        }

        case 'message.reaction': {
          const p = event.payload
          if (!p || p.fromMe || !p.reaction?.messageId) return
          const phone = await senderPhone(p.from || '', p._data, creds)
          if (!phone) return
          const message: WhatsAppMessage = {
            id: String(p.id),
            from: phone,
            timestamp: String(p.timestamp || Math.floor(Date.now() / 1000)),
            type: 'reaction',
            reaction: {
              message_id: String(p.reaction.messageId),
              emoji: p.reaction.text || '',
            },
          }
          await processWebhook({
            entry: [
              {
                id: phoneNumberId,
                changes: [
                  {
                    field: 'messages',
                    value: {
                      messaging_product: 'whatsapp',
                      metadata,
                      contacts: [{ profile: {}, wa_id: phone }],
                      messages: [message],
                    },
                  },
                ],
              },
            ],
          })
          return
        }

        case 'message.ack': {
          const p = event.payload
          if (!p?.fromMe) return
          const status = ACK_TO_STATUS[String(p.ackName || '').toUpperCase()]
          if (!status) return
          await processWebhook({
            entry: [
              {
                id: phoneNumberId,
                changes: [
                  {
                    field: 'messages',
                    value: {
                      messaging_product: 'whatsapp',
                      metadata,
                      statuses: [
                        {
                          id: String(p.id),
                          status,
                          timestamp: String(Math.floor(Date.now() / 1000)),
                          recipient_id: digits(p.to || p.from),
                          ...(status === 'failed'
                            ? {
                                errors: [
                                  { code: 0, title: 'WhatsApp could not deliver this message' },
                                ],
                              }
                            : {}),
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          })
          return
        }

        case 'session.status': {
          const status = event.payload?.status
          await supabaseAdmin()
            .from('whatsapp_config')
            .update({
              status: status === 'WORKING' ? 'connected' : 'disconnected',
              ...(status === 'WORKING'
                ? { connected_at: new Date().toISOString() }
                : {}),
            })
            .eq('id', config.id)
          return
        }
      }
    } catch (err) {
      console.error('[waha-webhook] processing failed:', err)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}
