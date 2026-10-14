import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import {
  encodeWahaCreds,
  parseWahaCreds,
  wahaEnsureSession,
  wahaGetQrDataUrl,
  wahaGetSession,
  wahaLogoutSession,
  wahaPhoneNumberId,
  type WahaCreds,
} from '@/lib/whatsapp/waha-api'

/**
 * WAHA provider settings.
 *
 *   GET    ?qr=1  → status of the configured WAHA session (+ QR when pairing)
 *   POST          → save credentials, register our webhook, start the session
 *   DELETE        → log the session out and remove the WAHA configuration
 *
 * Credentials may be left blank to use the server-wide defaults
 * (WAHA_DEFAULT_BASE_URL / WAHA_DEFAULT_API_KEY) so the API key never has
 * to be pasted into the browser.
 */

const MIN_DELAY_MS = 1500
const MAX_DELAY_MS = 120_000

function webhookUrlFor(secret: string): string {
  const base = (
    process.env.WAHA_WEBHOOK_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    ''
  ).replace(/\/+$/, '')
  return `${base}/api/whatsapp/waha/webhook?s=${secret}`
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const wantQr = new URL(request.url).searchParams.get('qr') === '1'

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select(
        'provider, access_token, status, waha_base_url, waha_session, waha_send_delay_ms',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    const defaults = {
      has_server_defaults: !!(
        process.env.WAHA_DEFAULT_BASE_URL && process.env.WAHA_DEFAULT_API_KEY
      ),
    }

    if (!config || config.provider !== 'waha') {
      return NextResponse.json({ configured: false, ...defaults })
    }

    let creds: WahaCreds
    try {
      creds = parseWahaCreds(decrypt(config.access_token))
    } catch {
      return NextResponse.json({
        configured: true,
        reachable: false,
        error: 'Stored WAHA credentials could not be read. Save them again.',
        ...defaults,
      })
    }

    try {
      const session = await wahaGetSession(creds)
      const status = session?.status ?? 'NOT_CREATED'
      let qr: string | null = null
      if (wantQr && status === 'SCAN_QR_CODE') {
        qr = await wahaGetQrDataUrl(creds)
      }
      return NextResponse.json({
        configured: true,
        reachable: true,
        base_url: creds.baseUrl,
        session: creds.session,
        status,
        me: session?.me ?? null,
        send_delay_ms: config.waha_send_delay_ms,
        qr,
        ...defaults,
      })
    } catch (err) {
      return NextResponse.json({
        configured: true,
        reachable: false,
        base_url: creds.baseUrl,
        session: creds.session,
        send_delay_ms: config.waha_send_delay_ms,
        error: err instanceof Error ? err.message : 'WAHA unreachable',
        ...defaults,
      })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const body = (await request.json().catch(() => ({}))) as {
      base_url?: string
      api_key?: string
      session?: string
      send_delay_ms?: number
    }

    // Existing WAHA row → blank fields keep what is stored.
    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id, provider, access_token, waha_webhook_secret')
      .eq('account_id', accountId)
      .maybeSingle()

    let stored: WahaCreds | null = null
    if (existing?.provider === 'waha') {
      try {
        stored = parseWahaCreds(decrypt(existing.access_token))
      } catch {
        stored = null
      }
    }

    const baseUrl = (
      body.base_url?.trim() ||
      stored?.baseUrl ||
      process.env.WAHA_DEFAULT_BASE_URL ||
      ''
    ).replace(/\/+$/, '')
    const apiKey =
      body.api_key?.trim() || stored?.apiKey || process.env.WAHA_DEFAULT_API_KEY || ''
    // WAHA Core supports a single session, which must be named "default".
    const session = body.session?.trim() || stored?.session || 'default'

    if (!/^https?:\/\//i.test(baseUrl)) {
      return NextResponse.json(
        { error: 'Informe a URL do WAHA (http:// ou https://).' },
        { status: 400 },
      )
    }
    if (!apiKey) {
      return NextResponse.json({ error: 'Informe a API key do WAHA.' }, { status: 400 })
    }
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(session)) {
      return NextResponse.json({ error: 'Nome de sessão inválido.' }, { status: 400 })
    }

    const delay = Math.min(
      MAX_DELAY_MS,
      Math.max(MIN_DELAY_MS, Math.round(Number(body.send_delay_ms) || 4000)),
    )

    const secret = existing?.waha_webhook_secret || randomBytes(24).toString('hex')
    const creds: WahaCreds = { baseUrl, apiKey, session }

    // Register the webhook + start the session BEFORE persisting, so a bad
    // URL or key is reported instead of saved.
    let sessionInfo
    try {
      sessionInfo = await wahaEnsureSession({ creds, webhookUrl: webhookUrlFor(secret) })
    } catch (err) {
      return NextResponse.json(
        {
          error: `Não foi possível configurar o WAHA: ${
            err instanceof Error ? err.message : 'erro desconhecido'
          }`,
        },
        { status: 502 },
      )
    }

    const row = {
      provider: 'waha',
      phone_number_id: wahaPhoneNumberId(accountId),
      waba_id: null,
      access_token: encrypt(encodeWahaCreds(creds)),
      verify_token: null,
      waha_base_url: baseUrl,
      waha_session: session,
      waha_webhook_secret: secret,
      waha_send_delay_ms: delay,
      status: sessionInfo.status === 'WORKING' ? 'connected' : 'disconnected',
      connected_at: sessionInfo.status === 'WORKING' ? new Date().toISOString() : null,
      registered_at: null,
      subscribed_apps_at: null,
      last_registration_error: null,
      updated_at: new Date().toISOString(),
    }

    const { error } = existing
      ? await supabase.from('whatsapp_config').update(row).eq('account_id', accountId)
      : await supabase
          .from('whatsapp_config')
          .insert({ account_id: accountId, user_id: userId, ...row })

    if (error) {
      console.error('[waha/config POST] save failed:', error)
      return NextResponse.json({ error: 'Não foi possível salvar a configuração.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, status: sessionInfo.status })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('provider, access_token')
      .eq('account_id', accountId)
      .maybeSingle()

    if (config?.provider === 'waha') {
      try {
        await wahaLogoutSession(parseWahaCreds(decrypt(config.access_token)))
      } catch (err) {
        // A WAHA that is down must not trap the account on this provider.
        console.warn('[waha/config DELETE] logout failed:', err)
      }
      const { error } = await supabase
        .from('whatsapp_config')
        .delete()
        .eq('account_id', accountId)
        .eq('provider', 'waha')
      if (error) {
        return NextResponse.json({ error: 'Não foi possível remover a configuração.' }, { status: 500 })
      }
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
