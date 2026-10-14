import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { parseWahaCreds } from '@/lib/whatsapp/waha-api'
import { syncContactPhoto } from '@/lib/whatsapp/contact-photo'

/**
 * GET /api/cron/contact-photos?limit=10
 *
 * Backfills WhatsApp profile photos for contacts that were never synced
 * (e.g. a freshly imported address book). Each call handles up to `limit`
 * contacts per WAHA account and paces itself, so a scheduler can simply
 * call it every minute until `remaining` is 0. Protected by the same
 * shared secret as the other cron endpoints (`x-cron-secret`).
 */
export const maxDuration = 120

const PAUSE_MS = 1500

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '')
  const want = Buffer.from(expected)
  if (supplied.length !== want.length || !timingSafeEqual(supplied, want)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limit = Math.min(
    50,
    Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 10),
  )
  const db = supabaseAdmin()

  const { data: configs, error } = await db
    .from('whatsapp_config')
    .select('account_id, access_token, status')
    .eq('provider', 'waha')
    .eq('status', 'connected')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const totals = { updated: 0, no_photo: 0, failed: 0, remaining: 0 }

  for (const cfg of configs ?? []) {
    let creds
    try {
      creds = parseWahaCreds(decrypt(cfg.access_token))
    } catch {
      continue
    }

    const { data: batch } = await db
      .from('contacts')
      .select('id, phone')
      .eq('account_id', cfg.account_id)
      .is('avatar_synced_at', null)
      .not('phone', 'is', null)
      .order('id')
      .limit(limit)

    for (const c of batch ?? []) {
      const result = await syncContactPhoto({
        db,
        creds,
        accountId: cfg.account_id,
        contactId: c.id,
        phone: c.phone,
      })
      totals[result]++
      if (result === 'failed') {
        // Leave it unsynced for a retry, but don't spin on it this call.
        await db
          .from('contacts')
          .update({ avatar_synced_at: new Date(Date.now() - 29 * 86_400_000).toISOString() })
          .eq('id', c.id)
      }
      await new Promise((r) => setTimeout(r, PAUSE_MS))
    }

    const { count } = await db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', cfg.account_id)
      .is('avatar_synced_at', null)
      .not('phone', 'is', null)
    totals.remaining += count ?? 0
  }

  return NextResponse.json(totals)
}
