import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_API = 'https://mybusiness.googleapis.com/v4'

type Config = { client_id: string; client_secret: string; refresh_token: string; account_name: string; location_name: string; business_name: string }

async function config(accountId: string): Promise<Config> {
  const { data } = await supabaseAdmin().from('google_business_profile_config').select('*').eq('account_id', accountId).maybeSingle()
  if (!data) throw new Error('Configure o acesso ao Google Meu Negócio em Configurações → Chaves de API.')
  try {
    return { ...data, client_id: decrypt(data.client_id), client_secret: decrypt(data.client_secret), refresh_token: decrypt(data.refresh_token) }
  } catch { throw new Error('As credenciais do Google não puderam ser descriptografadas. Salve-as novamente.') }
}

async function accessToken(accountId: string) {
  const c = await config(accountId)
  const body = new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: 'refresh_token' })
  const response = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || typeof payload.access_token !== 'string') throw new Error('O refresh token do Google não é válido ou foi revogado.')
  return { token: payload.access_token as string, config: c }
}

export async function listGoogleReviews(accountId: string) {
  const { token, config: c } = await accessToken(accountId)
  const reviews: unknown[] = []
  let pageToken = ''
  let summary: Record<string, unknown> = {}
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc' })
    if (pageToken) query.set('pageToken', pageToken)
    const response = await fetch(`${GOOGLE_API}/${c.account_name}/locations/${c.location_name}/reviews?${query.toString()}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) throw new Error(typeof (payload.error as Record<string, unknown> | undefined)?.message === 'string' ? String((payload.error as Record<string, unknown>).message) : 'Não foi possível carregar as avaliações do Google.')
    if (!page) summary = payload
    if (Array.isArray(payload.reviews)) reviews.push(...payload.reviews)
    pageToken = typeof payload.nextPageToken === 'string' ? payload.nextPageToken : ''
    if (!pageToken) break
  }
  return { ...summary, reviews, businessName: c.business_name }
}

export async function updateGoogleReply(accountId: string, reviewId: string, comment: string) {
  const { token, config: c } = await accessToken(accountId)
  const name = `${c.account_name}/locations/${c.location_name}/reviews/${encodeURIComponent(reviewId)}`
  const response = await fetch(`${GOOGLE_API}/${name}/reply`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ comment }), cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof payload.error?.message === 'string' ? payload.error.message : 'Não foi possível salvar a réplica no Google.')
  return payload
}

export async function saveGoogleConfig(accountId: string, userId: string, input: { clientId: string; clientSecret: string; refreshToken: string; accountName: string; locationName: string; businessName?: string }) {
  const row = { account_id: accountId, client_id: encrypt(input.clientId), client_secret: encrypt(input.clientSecret), refresh_token: encrypt(input.refreshToken), account_name: input.accountName.replace(/^\/+|\/+$/g, ''), location_name: input.locationName.replace(/^\/+|\/+$/g, ''), business_name: input.businessName?.trim() || 'M Vision Ótica Especializada', created_by: userId, verified_at: new Date().toISOString() }
  const { error } = await supabaseAdmin().from('google_business_profile_config').upsert(row, { onConflict: 'account_id' })
  if (error) throw error
}
