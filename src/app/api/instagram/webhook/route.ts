import { NextResponse, after } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { instagramEnv } from '@/lib/instagram/api'
import { verifyInstagramSignature } from '@/lib/instagram/security'
import { processInstagramWebhook } from '@/lib/instagram/inbound'

export const maxDuration = 60

/** GET — Meta's webhook verification handshake (INSTAGRAM_VERIFY_TOKEN). */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams
  const expected = instagramEnv().verifyToken
  const supplied = sp.get('hub.verify_token') ?? ''
  const challenge = sp.get('hub.challenge')
  if (
    sp.get('hub.mode') !== 'subscribe' ||
    !challenge ||
    !expected ||
    supplied.length !== expected.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return new Response(challenge, { status: 200 })
}

/** POST — signed event deliveries. Acknowledge fast, process after. */
export async function POST(request: Request) {
  const raw = await request.text()
  if (!verifyInstagramSignature(raw, request.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  after(async () => {
    await processInstagramWebhook(body)
  })
  return NextResponse.json({ status: 'received' })
}
