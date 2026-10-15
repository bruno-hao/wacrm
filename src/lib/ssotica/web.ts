// ============================================================
// ssOtica web session — used ONLY to read budgets (orçamentos).
//
// The Consultative API has no budgets endpoint, but the ssOtica web app
// loads them from its own GraphQL endpoint (`POST /graphql`,
// `GetPaginatedOrcamentos`), which needs a logged-in Laravel session
// (cookies + `X-XSRF-TOKEN`). With the admin's explicit consent we log in
// with the credentials saved in Settings → ssOtica, keep the cookie jar
// (encrypted) and reuse it until it expires.
//
// Nothing here ever writes to ssOtica: login + read-only queries.
// ============================================================

const BASE = 'https://app.ssotica.com.br'
const UA = 'Mozilla/5.0 (compatible; WACRM-ssOtica-sync)'

export class SsoticaWebError extends Error {
  readonly code: 'login_failed' | 'captcha' | 'session_expired' | 'network' | 'graphql' | 'unexpected'
  constructor(code: SsoticaWebError['code'], message: string) {
    super(message)
    this.name = 'SsoticaWebError'
    this.code = code
  }
}

/** Minimal cookie jar: name → value. */
export type CookieJar = Record<string, string>

function mergeSetCookies(jar: CookieJar, res: Response) {
  const list: string[] =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : []
  for (const line of list) {
    const [pair] = line.split(';')
    const eq = pair.indexOf('=')
    if (eq < 1) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (/;\s*expires=.*1970/i.test(line) || value === '' || value === 'deleted') delete jar[name]
    else jar[name] = value
  }
}

const cookieHeader = (jar: CookieJar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')

async function req(
  path: string,
  jar: CookieJar,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 25_000, headers, ...rest } = init
  try {
    const res = await fetch(`${BASE}${path}`, {
      redirect: 'manual',
      ...rest,
      headers: { 'User-Agent': UA, Cookie: cookieHeader(jar), ...(headers as Record<string, string>) },
      signal: AbortSignal.timeout(timeoutMs),
    })
    mergeSetCookies(jar, res)
    return res
  } catch (err) {
    throw new SsoticaWebError('network', err instanceof Error ? err.message : 'ssOtica unreachable')
  }
}

/** Pull `<input>` elements out of the first form containing a password field. */
export function parseLoginForm(html: string): {
  action: string
  userField: string
  passwordField: string
  hidden: Record<string, string>
} | null {
  const forms = html.match(/<form[\s\S]*?<\/form>/gi) ?? []
  for (const form of forms) {
    const inputs = [...form.matchAll(/<input\b[^>]*>/gi)].map((m) => m[0])
    const attr = (tag: string, name: string) =>
      new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)?.[2] ??
      new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag)?.[1] ??
      null
    const password = inputs.find((i) => attr(i, 'type')?.toLowerCase() === 'password')
    if (!password) continue
    const user = inputs.find((i) => {
      const t = attr(i, 'type')?.toLowerCase() ?? 'text'
      return ['email', 'text'].includes(t) && attr(i, 'name')
    })
    if (!user) continue
    const hidden: Record<string, string> = {}
    for (const i of inputs) {
      if (attr(i, 'type')?.toLowerCase() === 'hidden' && attr(i, 'name')) {
        hidden[attr(i, 'name')!] = attr(i, 'value') ?? ''
      }
    }
    const action = /<form\b[^>]*\baction\s*=\s*"([^"]*)"/i.exec(form)?.[1] ?? '/login'
    return {
      action,
      userField: attr(user, 'name')!,
      passwordField: attr(password, 'name')!,
      hidden,
    }
  }
  return null
}

/** Log in and return the authenticated cookie jar. Throws SsoticaWebError. */
export async function loginSsotica(login: string, password: string): Promise<CookieJar> {
  const jar: CookieJar = {}
  const page = await req('/login', jar, { headers: { Accept: 'text/html' } })
  const html = await page.text()
  if (/g-recaptcha|hcaptcha|cf-turnstile/i.test(html)) {
    throw new SsoticaWebError('captcha', 'ssOtica login asks for a captcha')
  }
  const form = parseLoginForm(html)
  if (!form) throw new SsoticaWebError('unexpected', 'ssOtica login form not recognised')

  const body = new URLSearchParams({
    ...form.hidden,
    [form.userField]: login,
    [form.passwordField]: password,
  })
  const action = form.action.startsWith('http') ? new URL(form.action).pathname : form.action
  const res = await req(action || '/login', jar, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html',
      Referer: `${BASE}/login`,
    },
    body,
  })
  // A successful login redirects away from /login; a failure comes back to it.
  const location = res.headers.get('location') ?? ''
  if (res.status >= 300 && res.status < 400 && !/\/login/i.test(location)) return jar
  if (res.status === 200 && !/name=["']password["']/i.test(await res.text())) return jar
  throw new SsoticaWebError('login_failed', 'ssOtica rejected the login')
}

export interface GraphqlQuote {
  hashed_id: string
  numero: string | number
  total: string | number | null
  desconto?: string | number | null
  acrescimo?: string | number | null
  vencimento?: string | null
  data_orcamento?: string | null
  status: string
  observacao?: string | null
  cliente_nome?: string | null
  cliente_telefone?: string | null
  cliente_DDI?: string | number | null
  funcionario?: { nome?: string | null } | null
  itens?: {
    quantidade?: string | number | null
    valor?: string | number | null
    produto?: { descricao_completa?: string | null } | null
  }[]
  venda_hashed_id?: string | null
  os_hashed_id?: string | null
}

const QUOTES_QUERY = `query OrcamentoByEmpresas($empresa:String,$busca:String,$funcionario:String,$situacao:[String],$periodo_inicio:String,$periodo_fim:String,$page:Int,$per_page:Int){GetPaginatedOrcamentos(empresa:$empresa,busca:$busca,funcionario:$funcionario,situacao:$situacao,periodo_inicio:$periodo_inicio,periodo_fim:$periodo_fim,page:$page,per_page:$per_page){total last_page current_page data{hashed_id numero total desconto acrescimo vencimento data_orcamento status observacao cliente_nome cliente_telefone cliente_DDI funcionario{nome} itens{quantidade valor produto{descricao_completa}} venda_hashed_id os_hashed_id}}}`

const ddmmyyyy = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`

/**
 * Fetch every budget created between `from` and `to` (all statuses).
 * Throws `session_expired` when the cookie jar is no longer valid so the
 * caller can log in again once.
 */
export async function fetchQuotes(
  jar: CookieJar,
  storeHash: string,
  from: Date,
  to: Date,
  maxPages = 20,
): Promise<GraphqlQuote[]> {
  const out: GraphqlQuote[] = []
  for (let page = 1; page <= maxPages; page++) {
    const xsrf = decodeURIComponent(jar['XSRF-TOKEN'] ?? '')
    const res = await req('/graphql', jar, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {}),
      },
      body: JSON.stringify({
        query: QUOTES_QUERY,
        variables: {
          empresa: storeHash,
          busca: '',
          funcionario: null,
          page,
          per_page: 50,
          periodo_inicio: ddmmyyyy(from),
          periodo_fim: ddmmyyyy(to),
          situacao: ['ATIVO', 'CONVERTIDO', 'CANCELADO', 'EXPIRADO'],
        },
      }),
    })
    if (res.status === 401 || res.status === 419 || (res.status >= 300 && res.status < 400)) {
      throw new SsoticaWebError('session_expired', `HTTP ${res.status}`)
    }
    if (!res.ok) throw new SsoticaWebError('graphql', `HTTP ${res.status}`)
    const json = (await res.json().catch(() => null)) as {
      data?: { GetPaginatedOrcamentos?: { last_page?: number; data?: GraphqlQuote[] } }
      errors?: { message?: string }[]
    } | null
    if (!json || json.errors?.length || !json.data?.GetPaginatedOrcamentos) {
      throw new SsoticaWebError('graphql', json?.errors?.[0]?.message ?? 'empty GraphQL response')
    }
    const block = json.data.GetPaginatedOrcamentos
    out.push(...(block.data ?? []))
    if (page >= (block.last_page ?? 1)) break
  }
  return out
}
