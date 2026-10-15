// ============================================================
// Minimal client for the ssOtica "API Consultiva" (read-only).
// https://apidocs.ipe.digital/
//
// Every request carries the user's access key as a Bearer token and
// identifies the store with `cnpj`. NEVER call POST /login: it mints a
// new key and invalidates the one copied from the user's registration.
// ============================================================

export const SSOTICA_BASE_URL = 'https://app.ssotica.com.br/api/v1'

export type SsoticaErrorCode =
  | 'invalid_key' // 401 Unauthorized (missing / wrong key)
  | 'user_blocked' // 401 with a message (blocked user / no active store)
  | 'store_not_found' // 400 EMPRESA_NAO_ENCONTRADA
  | 'api_not_contracted' // 400 API_NAO_CONTRATADA
  | 'contract_unreadable' // 400 CONTRATO_ILEGIVEL (transient)
  | 'bad_request' // any other 400
  | 'rate_limited' // 429 (60 calls/min per store)
  | 'network' // timeout / DNS / TLS
  | 'unexpected'

export class SsoticaError extends Error {
  readonly code: SsoticaErrorCode
  constructor(code: SsoticaErrorCode, message: string) {
    super(message)
    this.name = 'SsoticaError'
    this.code = code
  }
}

/** Keep digits only. */
export function normalizeCnpj(raw: string): string {
  return raw.replace(/\D/g, '')
}

/** Standard CNPJ check-digit validation (14 digits). */
export function isValidCnpj(raw: string): boolean {
  const c = normalizeCnpj(raw)
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false
  const digit = (len: number) => {
    let sum = 0
    let weight = len - 7
    for (let i = 0; i < len; i++) {
      sum += Number(c[i]) * weight--
      if (weight < 2) weight = 9
    }
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  return digit(12) === Number(c[12]) && digit(13) === Number(c[13])
}

/**
 * GET a read-only listing. `params` are query-string values; the store
 * is always identified by `cnpj`.
 */
export async function ssoticaGet<T = unknown>(
  path: string,
  creds: { apiKey: string; cnpj: string },
  params: Record<string, string | number> = {},
  timeoutMs = 15_000,
): Promise<T> {
  const url = new URL(`${SSOTICA_BASE_URL}${path}`)
  url.searchParams.set('cnpj', normalizeCnpj(creds.cnpj))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        Accept: 'application/json',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new SsoticaError('network', 'ssOtica unreachable')
  }

  if (res.ok) {
    try {
      return (await res.json()) as T
    } catch {
      throw new SsoticaError('unexpected', 'ssOtica returned a non-JSON body')
    }
  }

  const text = await res.text().catch(() => '')
  if (res.status === 401) {
    // A bad/missing key answers with the bare text "Unauthorized"; a
    // blocked user or a user without an active store answers with a
    // message.
    const body = text.trim()
    throw new SsoticaError(
      !body || body.toLowerCase() === 'unauthorized' ? 'invalid_key' : 'user_blocked',
      body.slice(0, 200),
    )
  }
  if (res.status === 400) {
    let code = ''
    let info = ''
    try {
      const j = JSON.parse(text) as { error?: string; error_info?: string }
      code = j.error ?? ''
      info = j.error_info ?? ''
    } catch {
      /* not JSON */
    }
    if (code === 'EMPRESA_NAO_ENCONTRADA') throw new SsoticaError('store_not_found', info)
    if (code === 'API_NAO_CONTRATADA') throw new SsoticaError('api_not_contracted', info)
    if (code === 'CONTRATO_ILEGIVEL') throw new SsoticaError('contract_unreadable', info)
    throw new SsoticaError('bad_request', info || code)
  }
  if (res.status === 429) throw new SsoticaError('rate_limited', 'rate limited')
  throw new SsoticaError('unexpected', `HTTP ${res.status}`)
}

/**
 * Cheapest authenticated call (one customer row) — proves the key, the
 * CNPJ and that the store has the API contracted. Throws SsoticaError.
 */
export async function testSsoticaConnection(creds: {
  apiKey: string
  cnpj: string
}): Promise<void> {
  await ssoticaGet('/integracoes/clientes', creds, { page: 1, perPage: 1 })
}
