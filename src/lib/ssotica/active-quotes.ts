// ============================================================
// Active ssOtica budgets for the Orçamentos page: read live from the
// ssOtica web (same login the budget sync uses), cached for a minute.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchQuotes, SsoticaWebError, type GraphqlQuote } from './web'
import { getJar, normalizeQuote } from './quotes'

export interface ActiveQuote {
  id: string
  number: string
  customerName: string
  total: number
  date: string | null // yyyy-mm-dd
  seller: string
}

const RANGE_FROM = new Date(2001, 0, 1)
const RANGE_TO = new Date(2100, 11, 31)
const CACHE_MS = 60_000
const cache = new Map<string, { at: number; data: Promise<ActiveQuote[]> }>()

/** Active (ATIVO) budgets, newest first. Throws `Error('not_configured')` without a web login. */
export function listActiveQuotes(db: SupabaseClient, accountId: string): Promise<ActiveQuote[]> {
  const hit = cache.get(accountId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data
  const data = load(db, accountId)
  cache.set(accountId, { at: Date.now(), data })
  data.catch(() => cache.delete(accountId))
  return data
}

async function load(db: SupabaseClient, accountId: string): Promise<ActiveQuote[]> {
  const { data: cfg } = await db
    .from('ssotica_config')
    .select('account_id, store_hash, web_login, web_password, web_session')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!cfg?.web_login || !cfg.web_password || !cfg.store_hash) throw new Error('not_configured')

  const run = (jar: Awaited<ReturnType<typeof getJar>>) =>
    fetchQuotes(jar, cfg.store_hash as string, RANGE_FROM, RANGE_TO, 300, ['ATIVO'])

  let raw: GraphqlQuote[]
  try {
    raw = await run(await getJar(db, cfg))
  } catch (err) {
    if (!(err instanceof SsoticaWebError) || err.code !== 'session_expired') throw err
    raw = await run(await getJar(db, cfg, true))
  }

  return raw
    .map((g) => ({ g, q: normalizeQuote(g) }))
    .filter((x): x is { g: GraphqlQuote; q: NonNullable<ReturnType<typeof normalizeQuote>> } =>
      x.q?.status === 'ATIVO',
    )
    .map(({ g, q }) => ({
      id: q.id,
      number: q.number,
      customerName: (g.cliente_nome ?? '').trim(),
      total: q.total,
      date: q.createdAt,
      seller: q.seller ?? '',
    }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || Number(b.number) - Number(a.number))
}
