// ============================================================
// Pure normalisation of Instagram webhook payloads (no I/O).
//
//   { object: 'instagram',
//     entry: [{ id: <our IG id>, messaging: [
//       { sender:{id}, recipient:{id}, timestamp(ms),
//         message:{ mid, text?, attachments?:[{type,payload:{url}}], is_echo? } }
//       | { sender, recipient, timestamp, read:{ mid } } ] }] }
//
// `is_echo` marks messages the ACCOUNT sent (from this CRM, the Instagram
// app, or another tool); for those the peer is `recipient.id`.
// ============================================================

export type IgContentType = 'text' | 'image' | 'video' | 'audio' | 'document'

export interface IgMessagePart {
  /** Stable per-part id: the `mid`, or `<mid>:a<n>` for extra attachments. */
  id: string
  contentType: IgContentType
  text: string | null
  mediaUrl: string | null
}

export interface IgMessageEvent {
  kind: 'message'
  /** Our Instagram account (webhook `entry.id`). */
  accountIgId: string
  /** The other side of the conversation (IGSID). */
  peerId: string
  isEcho: boolean
  /** Event time in seconds. */
  timestamp: number
  parts: IgMessagePart[]
}

export interface IgSeenEvent {
  kind: 'seen'
  accountIgId: string
  peerId: string
  timestamp: number
}

export type IgEvent = IgMessageEvent | IgSeenEvent

const ATTACHMENT_TYPE: Record<string, IgContentType> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  file: 'document',
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeInstagramWebhook(body: any): IgEvent[] {
  if (!body || body.object !== 'instagram' || !Array.isArray(body.entry)) return []
  const out: IgEvent[] = []

  for (const entry of body.entry) {
    const accountIgId = String(entry?.id ?? '')
    if (!accountIgId) continue
    for (const ev of entry.messaging ?? []) {
      const senderId = String(ev?.sender?.id ?? '')
      const recipientId = String(ev?.recipient?.id ?? '')
      if (!senderId || !recipientId) continue
      const timestamp = Math.floor(Number(ev.timestamp ?? Date.now()) / 1000)

      if (ev.message?.mid) {
        const isEcho = ev.message.is_echo === true || senderId === accountIgId
        const peerId = isEcho ? recipientId : senderId
        const mid = String(ev.message.mid)
        const parts: IgMessagePart[] = []
        const text =
          typeof ev.message.text === 'string' && ev.message.text.trim()
            ? ev.message.text
            : null
        if (text) parts.push({ id: mid, contentType: 'text', text, mediaUrl: null })

        const attachments: any[] = Array.isArray(ev.message.attachments)
          ? ev.message.attachments
          : []
        attachments.forEach((a, i) => {
          const url = typeof a?.payload?.url === 'string' ? a.payload.url : null
          const type = ATTACHMENT_TYPE[String(a?.type)]
          const id = !text && i === 0 ? mid : `${mid}:a${i}`
          if (type && url) {
            parts.push({ id, contentType: type, text: null, mediaUrl: url })
          } else {
            // share / story_mention / reel / unsupported: keep what we can
            // so the agent sees something happened.
            const label = `[${String(a?.type ?? 'attachment')}]`
            parts.push({ id, contentType: 'text', text: url ? `${label} ${url}` : label, mediaUrl: null })
          }
        })
        if (parts.length) {
          out.push({ kind: 'message', accountIgId, peerId, isEcho, timestamp, parts })
        }
      } else if (ev.read) {
        // The customer opened our messages. `sender` is the customer.
        out.push({ kind: 'seen', accountIgId, peerId: senderId, timestamp })
      }
    }
  }
  return out
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type SendWindow = 'open' | 'human_agent' | 'closed'

/**
 * Instagram lets you reply freely for 24 h after the customer's last
 * message, and up to 7 days with the HUMAN_AGENT tag. A conversation with
 * no customer message at all is closed (we never open conversations).
 */
export function sendWindow(lastCustomerAt: string | Date | null, now = Date.now()): SendWindow {
  if (!lastCustomerAt) return 'closed'
  const hours = (now - new Date(lastCustomerAt).getTime()) / 3_600_000
  if (hours < 24) return 'open'
  if (hours < 24 * 7) return 'human_agent'
  return 'closed'
}
