import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'

export class CorreiosAuthError extends Error {
  readonly code = 'auth_error'
  constructor(message: string) {
    super(message)
    this.name = 'CorreiosAuthError'
  }
}

export function isCorreiosApiToken(value: unknown): value is string {
  return typeof value === 'string' && /^cws-[A-Za-z0-9_-]+$/.test(value.trim())
}

export function extractCorreiosApiToken(username: unknown, password: unknown): string | null {
  const values = [username, password]
  for (const value of values) {
    if (isCorreiosApiToken(value)) return value.trim()
  }
  return null
}

type CredentialRow = {
  account_id: string
  username: string
  password: string
  access_token: string | null
  token_expires_at: string | null
}

function apiBase() {
  return (process.env.CORREIOS_API_BASE_URL || 'https://api.correios.com.br').replace(/\/$/, '')
}

function parseExpiry(value: unknown): string | null {
  const date = new Date(String(value ?? ''))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function requestToken(row: CredentialRow): Promise<{ token: string; expiresAt: string | null }> {
  let username: string
  let password: string
  try {
    username = decrypt(row.username)
    password = decrypt(row.password)
  } catch {
    throw new CorreiosAuthError('Não foi possível descriptografar as credenciais dos Correios.')
  }
  const basic = Buffer.from(`${username}:${password}`).toString('base64')
  let response: Response
  try {
    response = await fetch(`${apiBase()}/token/v1/autentica`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Basic ${basic}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new CorreiosAuthError('Não foi possível acessar a autenticação dos Correios.')
  }
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) throw new CorreiosAuthError('Usuário ou senha do Meu Correios inválidos.')
  const token = typeof payload?.token === 'string' ? payload.token : typeof payload?.access_token === 'string' ? payload.access_token : ''
  if (!token) throw new CorreiosAuthError('A resposta dos Correios não trouxe um token válido.')
  return { token, expiresAt: parseExpiry(payload?.expiraEm ?? payload?.expiresAt ?? payload?.expires_in) }
}

export async function getCorreiosAccessToken(accountId: string): Promise<string> {
  const db = supabaseAdmin()
  const { data: row, error } = await db.from('correios_credentials').select('*').eq('account_id', accountId).maybeSingle()
  if (error) throw new CorreiosAuthError('Não foi possível carregar a configuração dos Correios.')
  if (!row) {
    const fallback = process.env.CORREIOS_API_TOKEN?.trim()
    if (fallback) return fallback
    throw new CorreiosAuthError('Configure o usuário e a senha do Meu Correios em Configurações → Espaço de trabalho → Logística.')
  }
  const current = row as CredentialRow
  let legacyUsername = ''
  let legacyPassword = ''
  try {
    legacyUsername = decrypt(current.username)
    legacyPassword = decrypt(current.password)
  } catch {
    throw new CorreiosAuthError('Não foi possível descriptografar as credenciais dos Correios.')
  }
  const legacyApiToken = extractCorreiosApiToken(legacyUsername, legacyPassword)
  if (legacyApiToken && !current.access_token) {
    const { error: tokenError } = await db.from('correios_credentials').update({
      access_token: encrypt(legacyApiToken),
      token_expires_at: null,
      last_error: null,
    }).eq('account_id', accountId)
    if (tokenError) throw new CorreiosAuthError('A chave CWS foi reconhecida, mas não foi possível armazená-la com segurança.')
    return legacyApiToken
  }
  const expiresAt = current.token_expires_at ? new Date(current.token_expires_at).getTime() : 0
  if (current.access_token && (!current.token_expires_at || expiresAt > Date.now() + 5 * 60_000)) {
    return decrypt(current.access_token)
  }
  const generated = await requestToken({ ...current, username: encrypt(legacyUsername), password: encrypt(legacyPassword) })
  const { error: updateError } = await db.from('correios_credentials').update({
    access_token: encrypt(generated.token),
    token_expires_at: generated.expiresAt,
    last_error: null,
  }).eq('account_id', accountId)
  if (updateError) throw new CorreiosAuthError('Token obtido, mas não foi possível armazená-lo com segurança.')
  return generated.token
}
