// ============================================================
// ssOtica → CRM customer index.
//
// The ssOtica API cannot search by phone and allows 60 calls/minute per
// store, so we mirror what the inbox needs into `ssotica_customers`:
// each customer's phones (canonical, Brazilian mobiles with the ninth
// digit) plus the last service order, last prescription date and last
// sale.
//
// One run (`runSsoticaSync`, called every 10 minutes by the cron or by
// the "sync now" button) spends at most CALL_BUDGET API calls:
//   backfill  customers (all pages) → sales (3 years, 180-day windows)
//             → service orders (same); may take several runs
//   live      customers registered recently + sales / OS of the last few
//             days, so changes show up within one cron tick
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { brazilianCanonical, normalizePhone } from '@/lib/whatsapp/phone-utils'
import { SsoticaError, ssoticaGet } from './client'

export const CALL_BUDGET = 45
const HISTORY_YEARS = 3
const WINDOW_DAYS = 180
const LIVE_LOOKBACK_DAYS = 3
const LOCK_MINUTES = 4

type Phase = 'customers' | 'sales' | 'os' | 'live'

interface SyncState {
  phase: Phase
  page: number
  cursor_date: string | null
  live_since: string | null
}

interface Creds {
  apiKey: string
  cnpj: string
}

interface Paged<T> {
  currentPage: number
  totalPages: number
  data: T[]
}

interface ApiCustomer {
  id: number
  nome?: string | null
  telefones?: (string | { numero?: string | null })[] | null
}

interface ApiSale {
  numero?: number | string | null
  data?: string | null
  valor_liquido?: number | string | null
  funcionario?: { nome?: string | null } | null
  cliente?: ApiCustomer | null
}

interface ApiOs {
  numero?: number | string | null
  data?: string | null
  possui_receita?: number | boolean | null
  status?: string | null
  etapa_atual?: string | null
  id_venda_vinculada?: number | string | null
  funcionario?: { nome?: string | null } | null
  cliente?: ApiCustomer | null
}

export interface SyncResult {
  phase: Phase
  calls: number
  customers: number
  stopped: 'budget' | 'rate_limited' | 'done' | 'locked' | 'error'
  error?: string
}

// ------------------------------------------------------------
// Pure helpers (unit tested)
// ------------------------------------------------------------

/** Canonical lookup keys for one phone as typed in ssOtica or WhatsApp. */
export function canonicalPhone(raw: string | null | undefined): string | null {
  let d = normalizePhone(raw ?? '')
  if (!d) return null
  // "(11) 9.9999-0000" style entries carry DDD + number, no country code.
  if (d.length === 10 || d.length === 11) d = `55${d}`
  const br = brazilianCanonical(d)
  if (br) return br.digits
  // Without a DDD (7–9 digits) there is nothing safe to match on.
  return d.length >= 11 ? d : null
}

export function customerPhones(c: ApiCustomer | null | undefined): string[] {
  const out = new Set<string>()
  for (const t of c?.telefones ?? []) {
    const raw = typeof t === 'string' ? t : t?.numero
    const canon = canonicalPhone(raw)
    if (canon) out.add(canon)
  }
  return [...out]
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return isoDay(d)
}

/** True when (date, number) is newer than what we already hold. */
export function isNewer(
  curDate: string | null,
  curNumber: string | null,
  date: string | null,
  number: string | null,
): boolean {
  if (!date) return false
  if (!curDate) return true
  if (date !== curDate) return date > curDate
  return Number(number ?? 0) >= Number(curNumber ?? 0)
}

// ------------------------------------------------------------
// Persistence
// ------------------------------------------------------------

interface Row {
  account_id: string
  ssotica_id: number
  name: string | null
  phones: string[]
  last_os_number: string | null
  last_os_date: string | null
  last_os_status: string | null
  last_os_etapa: string | null
  last_os_sold: boolean | null
  last_receita_date: string | null
  last_seller: string | null
  last_sale_number: string | null
  last_sale_date: string | null
  last_sale_value: number | null
}

async function loadRows(db: SupabaseClient, accountId: string, ids: number[]) {
  const map = new Map<number, Row>()
  if (!ids.length) return map
  const { data, error } = await db
    .from('ssotica_customers')
    .select(
      'account_id, ssotica_id, name, phones, last_os_number, last_os_date, last_os_status, last_os_etapa, last_os_sold, last_receita_date, last_seller, last_sale_number, last_sale_date, last_sale_value',
    )
    .eq('account_id', accountId)
    .in('ssotica_id', ids)
  if (error) throw error
  for (const r of (data ?? []) as Row[]) map.set(Number(r.ssotica_id), r)
  return map
}

function blank(accountId: string, id: number): Row {
  return {
    account_id: accountId,
    ssotica_id: id,
    name: null,
    phones: [],
    last_os_number: null,
    last_os_date: null,
    last_os_status: null,
    last_os_etapa: null,
    last_os_sold: null,
    last_receita_date: null,
    last_seller: null,
    last_sale_number: null,
    last_sale_date: null,
    last_sale_value: null,
  }
}

/**
 * Merge a page of API rows into the table. `apply` mutates the row for
 * one API record (customer listing, sale or OS). Rows are upserted in
 * one statement per page.
 */
async function mergePage<T>(
  db: SupabaseClient,
  accountId: string,
  records: T[],
  customerOf: (r: T) => ApiCustomer | null | undefined,
  apply: (row: Row, r: T) => void,
): Promise<number> {
  const withCustomer = records.filter((r) => customerOf(r)?.id)
  const ids = [...new Set(withCustomer.map((r) => Number(customerOf(r)!.id)))]
  const existing = await loadRows(db, accountId, ids)

  for (const r of withCustomer) {
    const c = customerOf(r)!
    const id = Number(c.id)
    const row = existing.get(id) ?? blank(accountId, id)
    if (c.nome) row.name = c.nome
    const phones = new Set([...row.phones, ...customerPhones(c)])
    row.phones = [...phones]
    apply(row, r)
    existing.set(id, row)
  }

  const upserts = ids.map((id) => ({
    ...existing.get(id)!,
    updated_at: new Date().toISOString(),
  }))
  if (upserts.length) {
    const { error } = await db
      .from('ssotica_customers')
      .upsert(upserts, { onConflict: 'account_id,ssotica_id' })
    if (error) throw error
  }
  return upserts.length
}

const applyNothing = () => {}

function applySale(row: Row, s: ApiSale) {
  const date = s.data ?? null
  const number = s.numero != null ? String(s.numero) : null
  if (isNewer(row.last_sale_date, row.last_sale_number, date, number)) {
    row.last_sale_date = date
    row.last_sale_number = number
    const v = Number(s.valor_liquido)
    row.last_sale_value = Number.isFinite(v) ? v : null
    // The customer's seller is the one on the most recent sale.
    const seller = s.funcionario?.nome?.trim()
    if (seller) row.last_seller = seller
  }
}

function applyOs(row: Row, o: ApiOs) {
  const date = o.data ?? null
  const number = o.numero != null ? String(o.numero) : null
  if (isNewer(row.last_os_date, row.last_os_number, date, number)) {
    row.last_os_date = date
    row.last_os_number = number
    row.last_os_status = o.status ?? null
    // Sold = linked to a sale (or already in the VENDIDO status).
    row.last_os_sold =
      o.status === 'VENDIDO' ||
      (o.id_venda_vinculada != null && String(o.id_venda_vinculada).trim() !== '')
    // The stage is only kept for sold OS.
    row.last_os_etapa = row.last_os_sold ? o.etapa_atual?.trim() || null : null
  }
  // No sale yet → fall back to the OS's seller.
  const osSeller = o.funcionario?.nome?.trim()
  if (osSeller && !row.last_seller) row.last_seller = osSeller
  // "Receita": date of the most recent OS that carries a prescription.
  if (
    (o.possui_receita === 1 || o.possui_receita === true) &&
    date &&
    (!row.last_receita_date || date > row.last_receita_date)
  ) {
    row.last_receita_date = date
  }
}

// ------------------------------------------------------------
// The run
// ------------------------------------------------------------

export async function runSsoticaSync(
  db: SupabaseClient,
  accountId: string,
  creds: Creds,
  budget = CALL_BUDGET,
): Promise<SyncResult> {
  const today = isoDay(new Date())
  const historyStart = (() => {
    const d = new Date()
    d.setUTCFullYear(d.getUTCFullYear() - HISTORY_YEARS)
    return isoDay(d)
  })()

  const { data: stateRow } = await db
    .from('ssotica_sync_state')
    .select('phase, page, cursor_date, live_since, running_until')
    .eq('account_id', accountId)
    .maybeSingle()

  if (
    stateRow?.running_until &&
    new Date(stateRow.running_until).getTime() > Date.now()
  ) {
    return { phase: stateRow.phase as Phase, calls: 0, customers: 0, stopped: 'locked' }
  }

  const state: SyncState = {
    phase: (stateRow?.phase as Phase) ?? 'customers',
    page: stateRow?.page ?? 1,
    cursor_date: stateRow?.cursor_date ?? null,
    live_since: stateRow?.live_since ?? null,
  }

  const save = async (extra: Record<string, unknown> = {}) => {
    await db.from('ssotica_sync_state').upsert(
      {
        account_id: accountId,
        phase: state.phase,
        page: state.page,
        cursor_date: state.cursor_date,
        live_since: state.live_since,
        updated_at: new Date().toISOString(),
        ...extra,
      },
      { onConflict: 'account_id' },
    )
  }

  await save({
    running_until: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString(),
  })

  let calls = 0
  let touched = 0
  let stopped: SyncResult['stopped'] = 'done'
  let error: string | undefined

  const get = async <T>(path: string, params: Record<string, string | number>) => {
    if (calls >= budget) throw new SsoticaError('rate_limited', 'budget')
    calls++
    return ssoticaGet<Paged<T>>(path, creds, { ...params, perPage: 100 }, 30_000)
  }

  try {
    // Walk one paginated listing; returns true when the listing finished.
    const walk = async <T>(
      path: string,
      baseParams: Record<string, string>,
      customerOf: (r: T) => ApiCustomer | null | undefined,
      apply: (row: Row, r: T) => void,
    ): Promise<boolean> => {
      for (;;) {
        const res = await get<T>(path, { ...baseParams, page: state.page })
        touched += await mergePage(db, accountId, res.data ?? [], customerOf, apply)
        if (state.page >= (res.totalPages ?? 1)) return true
        state.page++
        await save()
      }
    }

    // Walk windows of ≤180 days from `cursor_date` up to today.
    const walkWindows = async <T>(
      path: string,
      extra: Record<string, string>,
      next: Phase,
      apply: (row: Row, r: T) => void,
    ) => {
      state.cursor_date ??= historyStart
      while (state.cursor_date <= today) {
        const end = addDays(state.cursor_date, WINDOW_DAYS - 1)
        const to = end > today ? today : end
        await walk<T>(
          path,
          { ...extra, inicio_periodo: state.cursor_date, fim_periodo: to },
          (r) => (r as { cliente?: ApiCustomer | null }).cliente,
          apply,
        )
        state.cursor_date = addDays(to, 1)
        state.page = 1
        await save()
      }
      state.phase = next
      state.cursor_date = null
      state.page = 1
      await save()
    }

    if (state.phase === 'customers') {
      await walk<ApiCustomer>('/integracoes/clientes', {}, (c) => c, applyNothing)
      state.phase = 'sales'
      state.page = 1
      state.cursor_date = null
      state.live_since = today
      await save()
    }
    if (state.phase === 'sales') {
      await walkWindows<ApiSale>('/integracoes/vendas/periodo', {}, 'os', applySale)
    }
    if (state.phase === 'os') {
      await walkWindows<ApiOs>(
        '/integracoes/ordens-servico/periodo',
        { status: 'TODAS' },
        'live',
        applyOs,
      )
    }
    if (state.phase === 'live') {
      const since = addDays(state.live_since ?? today, -LIVE_LOOKBACK_DAYS)
      state.page = 1
      await walk<ApiCustomer>(
        '/integracoes/clientes',
        { cadastro_inicio: since, cadastro_fim: today },
        (c) => c,
        applyNothing,
      )
      state.page = 1
      await walk<ApiSale>(
        '/integracoes/vendas/periodo',
        { inicio_periodo: since, fim_periodo: today },
        (r) => r.cliente,
        applySale,
      )
      state.page = 1
      await walk<ApiOs>(
        '/integracoes/ordens-servico/periodo',
        { inicio_periodo: since, fim_periodo: today, status: 'TODAS' },
        (r) => r.cliente,
        applyOs,
      )
      state.page = 1
      state.live_since = today
    }
  } catch (err) {
    if (err instanceof SsoticaError && err.code === 'rate_limited') {
      stopped = err.message === 'budget' ? 'budget' : 'rate_limited'
    } else {
      stopped = 'error'
      error =
        err instanceof SsoticaError
          ? err.code
          : err instanceof Error
            ? err.message
            : String(err)
      console.error('[ssotica-sync] failed:', error)
    }
  }

  await save({
    running_until: null,
    last_run_at: new Date().toISOString(),
    last_error: error ?? null,
  })
  return { phase: state.phase, calls, customers: touched, stopped, error }
}
