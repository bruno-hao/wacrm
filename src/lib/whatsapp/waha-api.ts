/**
 * WAHA (WhatsApp HTTP API) helpers — the second WhatsApp provider.
 *
 * The rest of the app was written against the Meta Cloud API helpers in
 * `meta-api.ts`, which all take `{ phoneNumberId, accessToken, to, … }`.
 * Rather than thread a provider switch through every caller (send-message,
 * flows, automations, AI auto-reply, broadcasts, reactions), a WAHA account
 * encodes itself into those two values:
 *
 *   phoneNumberId = "waha:<account_id>"                  (see isWahaTarget)
 *   accessToken   = JSON {"u": baseUrl, "k": apiKey, "s": session}
 *
 * and the `meta-api.ts` send helpers delegate here when they see it.
 */

import { normalizePhone } from './phone-utils'

export const WAHA_TARGET_PREFIX = 'waha:'

export interface WahaCreds {
  baseUrl: string
  apiKey: string
  session: string
}

export interface WahaSendResult {
  messageId: string
}

export function wahaPhoneNumberId(accountId: string): string {
  return `${WAHA_TARGET_PREFIX}${accountId}`
}

export function isWahaTarget(phoneNumberId: string | null | undefined): boolean {
  return !!phoneNumberId && phoneNumberId.startsWith(WAHA_TARGET_PREFIX)
}

export function encodeWahaCreds(c: WahaCreds): string {
  return JSON.stringify({ u: c.baseUrl, k: c.apiKey, s: c.session })
}

export function parseWahaCreds(accessToken: string): WahaCreds {
  try {
    const o = JSON.parse(accessToken) as { u?: string; k?: string; s?: string }
    if (o.u && o.k) {
      return {
        baseUrl: o.u.replace(/\/+$/, ''),
        apiKey: o.k,
        session: o.s || 'default',
      }
    }
  } catch {
    // fallthrough
  }
  throw new Error('WAHA credentials are missing or malformed.')
}

export class WahaApiError extends Error {
  readonly httpStatus: number
  constructor(message: string, httpStatus: number) {
    super(message)
    this.name = 'WahaApiError'
    this.httpStatus = httpStatus
  }
}

async function wahaFetch(
  creds: WahaCreds,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<Response> {
  const res = await fetch(`${creds.baseUrl}${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': creds.apiKey,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    cache: 'no-store',
  })
  return res
}

async function wahaJson<T = unknown>(
  creds: WahaCreds,
  path: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<T> {
  const res = await wahaFetch(creds, path, init)
  const text = await res.text()
  if (!res.ok) {
    let msg = `WAHA error ${res.status}`
    try {
      const j = JSON.parse(text) as { message?: string | string[]; error?: string }
      const m = Array.isArray(j.message) ? j.message.join('; ') : j.message
      msg = m || j.error || msg
    } catch {
      if (text) msg = `${msg}: ${text.slice(0, 200)}`
    }
    throw new WahaApiError(msg, res.status)
  }
  return (text ? JSON.parse(text) : {}) as T
}

// ------------------------------------------------------------
// Addressing
// ------------------------------------------------------------

/** "5571999999999" | "+55 71 99999-9999" | "5571…@c.us" → "5571…@c.us". */
export function chatIdFromPhone(to: string): string {
  if (to.includes('@')) return to
  const digits = normalizePhone(to)
  if (!digits) {
    throw new Error('WAHA needs a phone number; this contact has none.')
  }
  return `${digits}@c.us`
}

/**
 * Resolve the real WhatsApp chat id for a phone number. Brazilian mobile
 * numbers in particular exist with or without the ninth digit; WAHA's
 * check-exists answers with the JID WhatsApp actually knows. Falls back
 * to the plain `<digits>@c.us` if the lookup itself is unavailable.
 */
export async function resolveChatId(creds: WahaCreds, to: string): Promise<string> {
  if (to.includes('@')) return to
  const digits = normalizePhone(to)
  if (!digits) throw new Error('WAHA needs a phone number; this contact has none.')
  try {
    const r = await wahaJson<{ numberExists?: boolean; chatId?: string }>(
      creds,
      `/api/contacts/check-exists?phone=${digits}&session=${encodeURIComponent(creds.session)}`,
      { timeoutMs: 15_000 },
    )
    if (r.numberExists === false) {
      throw new WahaApiError('This number is not registered on WhatsApp.', 422)
    }
    if (r.chatId) return r.chatId
  } catch (err) {
    if (err instanceof WahaApiError && err.httpStatus === 422) throw err
    // lookup unavailable — try the plain id
  }
  return `${digits}@c.us`
}

/** The id WAHA returns for a sent message, across response shapes. */
function extractMessageId(data: unknown): string {
  const d = data as Record<string, unknown> | null
  if (d) {
    const id = d.id
    if (typeof id === 'string') return id
    if (id && typeof id === 'object') {
      const ser = (id as Record<string, unknown>)._serialized
      if (typeof ser === 'string') return ser
    }
    const key = d.key as Record<string, unknown> | undefined
    if (key && typeof key.id === 'string') return key.id
  }
  throw new Error('WAHA did not return a message id.')
}

// ------------------------------------------------------------
// Pacing
// ------------------------------------------------------------

/**
 * Pause between two outbound sends of a bulk run. WhatsApp bans numbers
 * that blast messages at machine speed, so WAHA broadcasts wait
 * `baseMs` ±30% (a fixed cadence is itself a bot signature).
 */
export function wahaPause(baseMs: number): Promise<void> {
  const jitter = 0.7 + Math.random() * 0.6
  return new Promise((resolve) => setTimeout(resolve, Math.round(baseMs * jitter)))
}

// ------------------------------------------------------------
// Sending
// ------------------------------------------------------------

export async function wahaSendText(args: {
  creds: WahaCreds
  to: string
  text: string
  replyToMessageId?: string
}): Promise<WahaSendResult> {
  const { creds, to, text, replyToMessageId } = args
  const chatId = await resolveChatId(creds, to)
  const data = await wahaJson(creds, '/api/sendText', {
    body: {
      session: creds.session,
      chatId,
      text,
      ...(replyToMessageId ? { reply_to: replyToMessageId } : {}),
    },
  })
  return { messageId: extractMessageId(data) }
}

export type WahaMediaKind = 'image' | 'video' | 'document' | 'audio'

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg; codecs=opus',
  opus: 'audio/ogg; codecs=opus',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
}

const KIND_DEFAULT_MIME: Record<WahaMediaKind, string> = {
  image: 'image/jpeg',
  video: 'video/mp4',
  audio: 'audio/ogg; codecs=opus',
  document: 'application/octet-stream',
}

function fileNameFromUrl(url: string): string {
  try {
    const p = new URL(url).pathname
    const last = decodeURIComponent(p.substring(p.lastIndexOf('/') + 1))
    return last || 'file'
  } catch {
    return 'file'
  }
}

function guessMime(kind: WahaMediaKind, filename: string): string {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : ''
  return EXT_MIME[ext] ?? KIND_DEFAULT_MIME[kind]
}

export async function wahaSendMedia(args: {
  creds: WahaCreds
  to: string
  kind: WahaMediaKind
  link: string
  caption?: string
  filename?: string
  replyToMessageId?: string
}): Promise<WahaSendResult> {
  const { creds, to, kind, link, caption, filename, replyToMessageId } = args
  const chatId = await resolveChatId(creds, to)
  const name = filename || fileNameFromUrl(link)
  const file = { url: link, mimetype: guessMime(kind, name), filename: name }
  const base = {
    session: creds.session,
    chatId,
    file,
    ...(caption && kind !== 'audio' ? { caption } : {}),
    ...(replyToMessageId ? { reply_to: replyToMessageId } : {}),
  }

  // WAHA Core ships text + image + file; video and voice are richer
  // endpoints that may be Plus-only. Try the specific endpoint, and fall
  // back to sending the file as an attachment so the customer still
  // receives it.
  const specific: Record<WahaMediaKind, string> = {
    image: '/api/sendImage',
    video: '/api/sendVideo',
    audio: '/api/sendVoice',
    document: '/api/sendFile',
  }
  try {
    const data = await wahaJson(creds, specific[kind], {
      body: kind === 'audio' ? { ...base, convert: true } : base,
      timeoutMs: 60_000,
    })
    return { messageId: extractMessageId(data) }
  } catch (err) {
    if (kind === 'image' || kind === 'document') throw err
    if (err instanceof WahaApiError && err.httpStatus >= 500) throw err
    const data = await wahaJson(creds, '/api/sendFile', { body: base, timeoutMs: 60_000 })
    return { messageId: extractMessageId(data) }
  }
}

export async function wahaSendReaction(args: {
  creds: WahaCreds
  targetMessageId: string
  emoji: string
}): Promise<WahaSendResult> {
  const { creds, targetMessageId, emoji } = args
  await wahaJson(creds, '/api/reaction', {
    method: 'PUT',
    body: { session: creds.session, messageId: targetMessageId, reaction: emoji },
  })
  return { messageId: `reaction:${targetMessageId}` }
}

/** Mark the chat read and show "typing…". Best-effort for callers. */
export async function wahaMarkReadAndType(args: {
  creds: WahaCreds
  inboundMessageId: string
}): Promise<void> {
  const { creds, inboundMessageId } = args
  // "false_<chat>_<id>" → chat id sits between the first and last "_".
  const parts = inboundMessageId.split('_')
  const chatId = parts.length >= 3 ? parts.slice(1, -1).join('_') : ''
  if (!chatId) return
  await wahaJson(creds, '/api/sendSeen', {
    body: { session: creds.session, chatId },
    timeoutMs: 10_000,
  })
  await wahaJson(creds, '/api/startTyping', {
    body: { session: creds.session, chatId },
    timeoutMs: 10_000,
  })
}

/** Plain-text rendering of Meta interactive messages (WAHA Core has no buttons). */
export function renderInteractiveAsText(args: {
  bodyText: string
  headerText?: string
  footerText?: string
  options: { title: string; description?: string }[]
}): string {
  const lines: string[] = []
  if (args.headerText) lines.push(`*${args.headerText}*`, '')
  lines.push(args.bodyText, '')
  args.options.forEach((o, i) => {
    lines.push(`${i + 1}. ${o.title}${o.description ? ` — ${o.description}` : ''}`)
  })
  if (args.footerText) lines.push('', `_${args.footerText}_`)
  return lines.join('\n')
}

// ------------------------------------------------------------
// Session management (settings screen)
// ------------------------------------------------------------

export interface WahaSessionInfo {
  name: string
  status: 'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED' | string
  me?: { id?: string; pushName?: string } | null
}

export async function wahaGetSession(creds: WahaCreds): Promise<WahaSessionInfo | null> {
  try {
    return await wahaJson<WahaSessionInfo>(
      creds,
      `/api/sessions/${encodeURIComponent(creds.session)}`,
      { timeoutMs: 10_000 },
    )
  } catch (err) {
    if (err instanceof WahaApiError && err.httpStatus === 404) return null
    throw err
  }
}

export async function wahaEnsureSession(args: {
  creds: WahaCreds
  webhookUrl: string
}): Promise<WahaSessionInfo> {
  const { creds, webhookUrl } = args
  const config = {
    webhooks: [
      {
        url: webhookUrl,
        // `engine.event` is only used to see read receipts for customer messages
        // read on another device (NOWEB emits no message.ack for them).
        // `message.any` also carries messages WE sent from other devices
        // (phone, WhatsApp Web); plain `message` is inbound-only.
        events: ['message', 'message.any', 'message.ack', 'message.reaction', 'session.status', 'engine.event'],
        retries: { policy: 'constant', delaySeconds: 2, attempts: 5 },
      },
    ],
  }
  const existing = await wahaGetSession(creds)
  if (!existing) {
    await wahaJson(creds, '/api/sessions', {
      body: { name: creds.session, start: true, config },
    })
  } else {
    await wahaJson(creds, `/api/sessions/${encodeURIComponent(creds.session)}`, {
      method: 'PUT',
      body: { name: creds.session, config },
    })
    if (existing.status === 'STOPPED' || existing.status === 'FAILED') {
      await wahaJson(creds, `/api/sessions/${encodeURIComponent(creds.session)}/start`, {
        method: 'POST',
        body: {},
      })
    }
  }
  return (await wahaGetSession(creds)) ?? { name: creds.session, status: 'STARTING' }
}

/** QR code as a data URL (PNG), or null when there is nothing to scan. */
export async function wahaGetQrDataUrl(creds: WahaCreds): Promise<string | null> {
  const res = await wahaFetch(
    creds,
    `/api/${encodeURIComponent(creds.session)}/auth/qr?format=image`,
    { timeoutMs: 15_000 },
  )
  if (!res.ok) return null
  const type = res.headers.get('content-type') || ''
  if (type.includes('application/json')) {
    const j = (await res.json()) as { mimetype?: string; data?: string }
    return j.data ? `data:${j.mimetype || 'image/png'};base64,${j.data}` : null
  }
  const buf = Buffer.from(await res.arrayBuffer())
  return `data:${type || 'image/png'};base64,${buf.toString('base64')}`
}

export async function wahaLogoutSession(creds: WahaCreds): Promise<void> {
  const name = encodeURIComponent(creds.session)
  try {
    await wahaJson(creds, `/api/sessions/${name}/logout`, { method: 'POST', body: {} })
  } catch (err) {
    if (!(err instanceof WahaApiError) || err.httpStatus !== 404) throw err
  }
}

/**
 * Resolve a "@lid" id (WhatsApp's privacy id) to the real phone number,
 * when WAHA can. Returns digits or null.
 */
export async function wahaLidToPhone(
  creds: WahaCreds,
  lid: string,
): Promise<string | null> {
  try {
    const r = await wahaJson<{ lid?: string; pn?: string }>(
      creds,
      `/api/${encodeURIComponent(creds.session)}/lids/${encodeURIComponent(lid)}`,
      { timeoutMs: 10_000 },
    )
    const digits = r.pn ? normalizePhone(r.pn) : ''
    return digits || null
  } catch {
    return null
  }
}

/** Authenticated download of a media URL that WAHA attached to a message. */
export async function wahaDownloadMedia(
  creds: WahaCreds,
  url: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  // The URL WAHA reports is built from its own public base URL; rewrite
  // the origin to the internal one we are configured with.
  let target = url
  try {
    const u = new URL(url)
    target = `${creds.baseUrl}${u.pathname}${u.search}`
  } catch {
    // relative path — use as is
    target = url.startsWith('/') ? `${creds.baseUrl}${url}` : url
  }
  try {
    const res = await fetch(target, {
      headers: { 'X-Api-Key': creds.apiKey },
      signal: AbortSignal.timeout(60_000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mimeType: res.headers.get('content-type') || 'application/octet-stream',
    }
  } catch {
    return null
  }
}

/** URL of a contact's WhatsApp profile photo, or null if none / hidden. */
export async function wahaGetProfilePictureUrl(
  creds: WahaCreds,
  phone: string,
): Promise<string | null> {
  const digits = normalizePhone(phone)
  if (!digits) return null
  try {
    // Ask WhatsApp for the real id first: a Brazilian number may be
    // registered with or without the ninth digit, and only the registered
    // form has a photo.
    const chatId = await resolveChatId(creds, digits).catch(() => null)
    if (!chatId) return null
    const r = await wahaJson<{ profilePictureURL?: string | null }>(
      creds,
      `/api/contacts/profile-picture?contactId=${encodeURIComponent(
        chatId,
      )}&session=${encodeURIComponent(creds.session)}`,
      { timeoutMs: 15_000 },
    )
    return r.profilePictureURL || null
  } catch {
    return null
  }
}
