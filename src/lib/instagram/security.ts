import crypto from 'node:crypto'
import { parseAppSecrets } from '@/lib/whatsapp/webhook-signature'

/**
 * Verify the `x-hub-signature-256` header Meta puts on Instagram webhook
 * POSTs. Candidate secrets: `INSTAGRAM_APP_SECRET` (the Instagram app
 * secret shown under the Instagram product) and `META_APP_SECRET` (the
 * app-level secret, may list several) — Meta signs with the app secret,
 * and which one applies depends on how the app is set up, so either is
 * accepted. Fails closed when none is configured.
 */
export function verifyInstagramSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secrets = [
    ...parseAppSecrets(process.env.INSTAGRAM_APP_SECRET),
    ...parseAppSecrets(process.env.META_APP_SECRET),
  ]
  if (secrets.length === 0 || !signatureHeader?.startsWith('sha256=')) return false

  let ok = false
  for (const secret of secrets) {
    const expected =
      'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    const a = Buffer.from(signatureHeader)
    const b = Buffer.from(expected)
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) ok = true
  }
  return ok
}

// ------------------------------------------------------------
// OAuth `state`: binds the callback to the admin + account that started
// the flow and expires after 10 minutes (CSRF protection).
// ------------------------------------------------------------

const STATE_TTL_MS = 10 * 60_000

function stateKey(): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY is not set')
  return key
}

export function signOAuthState(accountId: string, userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ a: accountId, u: userId, t: now })).toString(
    'base64url',
  )
  const sig = crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyOAuthState(
  state: string | null,
  now = Date.now(),
): { accountId: string; userId: string } | null {
  if (!state) return null
  const [payload, sig] = state.split('.')
  if (!payload || !sig) return null
  const expected = crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const { a: accountId, u: userId, t } = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { a: string; u: string; t: number }
    if (!accountId || !userId || now - t > STATE_TTL_MS || t > now + 60_000) return null
    return { accountId, userId }
  } catch {
    return null
  }
}
