// ============================================================
// Instagram API with Instagram Login (Meta) — thin REST client.
// https://developers.facebook.com/docs/instagram-platform/
//
// Tokens are per Instagram professional account: a short-lived token from
// the OAuth code is exchanged for a 60-day token, which must be refreshed
// before it expires (see /api/cron/instagram-refresh).
// ============================================================

export const IG_GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_VERSION || 'v23.0'
const GRAPH = `https://graph.instagram.com/${IG_GRAPH_VERSION}`

export class InstagramApiError extends Error {
  readonly status: number
  readonly code: number | null
  constructor(message: string, status: number, code: number | null = null) {
    super(message)
    this.name = 'InstagramApiError'
    this.status = status
    this.code = code
  }
}

async function igFetch<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 20_000, ...rest } = init
  let res: Response
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    throw new InstagramApiError(
      err instanceof Error ? err.message : 'Instagram API unreachable',
      0,
    )
  }
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: { message?: string; code?: number } })
    | null
  if (!res.ok || data?.error) {
    throw new InstagramApiError(
      data?.error?.message ?? `HTTP ${res.status}`,
      res.status,
      data?.error?.code ?? null,
    )
  }
  return data as T
}

export function instagramEnv() {
  return {
    appId: process.env.INSTAGRAM_APP_ID?.trim() || '',
    appSecret: process.env.INSTAGRAM_APP_SECRET?.trim() || '',
    verifyToken: process.env.INSTAGRAM_VERIFY_TOKEN?.trim() || '',
    siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, ''),
  }
}

/** Where Meta redirects after the user authorises the app. */
export function instagramRedirectUri(): string {
  return `${instagramEnv().siteUrl}/api/instagram/oauth/callback`
}

export function buildAuthorizeUrl(state: string): string {
  const { appId } = instagramEnv()
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: instagramRedirectUri(),
    response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_manage_messages',
    state,
  })
  return `https://www.instagram.com/oauth/authorize?${params}`
}

/** code → short-lived token → 60-day token. */
export async function exchangeCodeForLongLivedToken(code: string): Promise<{
  accessToken: string
  expiresAt: string
  igUserId: string
}> {
  const { appId, appSecret } = instagramEnv()
  const form = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: 'authorization_code',
    redirect_uri: instagramRedirectUri(),
    code: code.replace(/#_$/, ''),
  })
  const short = await igFetch<{ access_token: string; user_id: number | string }>(
    'https://api.instagram.com/oauth/access_token',
    { method: 'POST', body: form },
  )
  const longParams = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: appSecret,
    access_token: short.access_token,
  })
  const long = await igFetch<{ access_token: string; expires_in: number }>(
    `https://graph.instagram.com/access_token?${longParams}`,
  )
  return {
    accessToken: long.access_token,
    expiresAt: new Date(Date.now() + long.expires_in * 1000).toISOString(),
    igUserId: String(short.user_id),
  }
}

export async function refreshLongLivedToken(
  token: string,
): Promise<{ accessToken: string; expiresAt: string }> {
  const params = new URLSearchParams({
    grant_type: 'ig_refresh_token',
    access_token: token,
  })
  const r = await igFetch<{ access_token: string; expires_in: number }>(
    `https://graph.instagram.com/refresh_access_token?${params}`,
  )
  return {
    accessToken: r.access_token,
    expiresAt: new Date(Date.now() + r.expires_in * 1000).toISOString(),
  }
}

/** The connected account: `user_id` is the id used in webhook `entry.id`. */
export async function getMe(token: string): Promise<{ igUserId: string; username: string | null }> {
  const r = await igFetch<{ user_id?: string; id?: string; username?: string }>(
    `${GRAPH}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`,
  )
  return { igUserId: String(r.user_id ?? r.id), username: r.username ?? null }
}

/** Subscribe the account to the webhook fields we handle. */
export async function subscribeToWebhooks(token: string): Promise<void> {
  await igFetch(
    `${GRAPH}/me/subscribed_apps?subscribed_fields=messages,messaging_seen&access_token=${encodeURIComponent(token)}`,
    { method: 'POST' },
  )
}

export async function unsubscribeFromWebhooks(token: string): Promise<void> {
  await igFetch(`${GRAPH}/me/subscribed_apps?access_token=${encodeURIComponent(token)}`, {
    method: 'DELETE',
  })
}

export interface InstagramProfile {
  name: string | null
  username: string | null
  profilePic: string | null
}

export async function getProfile(token: string, igsid: string): Promise<InstagramProfile> {
  const r = await igFetch<{ name?: string; username?: string; profile_pic?: string }>(
    `${GRAPH}/${encodeURIComponent(igsid)}?fields=name,username,profile_pic&access_token=${encodeURIComponent(token)}`,
  )
  return {
    name: r.name ?? null,
    username: r.username ?? null,
    profilePic: r.profile_pic ?? null,
  }
}

export type InstagramAttachmentType = 'image' | 'video' | 'audio' | 'file'

export async function sendInstagramMessage(args: {
  token: string
  recipientId: string
  text?: string
  attachment?: { type: InstagramAttachmentType; url: string }
  /** Outside the 24 h window (up to 7 days) a human-agent tag is required. */
  humanAgentTag?: boolean
}): Promise<{ messageId: string }> {
  const body: Record<string, unknown> = {
    recipient: { id: args.recipientId },
    message: args.attachment
      ? { attachment: { type: args.attachment.type, payload: { url: args.attachment.url } } }
      : { text: args.text },
  }
  if (args.humanAgentTag) {
    body.messaging_type = 'MESSAGE_TAG'
    body.tag = 'HUMAN_AGENT'
  }
  const r = await igFetch<{ message_id: string }>(`${GRAPH}/me/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    timeoutMs: 30_000,
  })
  return { messageId: r.message_id }
}
