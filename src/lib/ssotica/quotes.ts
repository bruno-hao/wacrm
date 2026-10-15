// ============================================================
// ssOtica budgets → pipeline "Fluxo de Vendas".
//
//   título    ORC <nº>                       (só o orçamento)
//             ORC <nº> / OS <nº>             (com O.S. aberta a partir dele)
//             ORC <nº> / OS <nº> / VEN <nº>  (O.S. e venda)
//   contato   localizado pelo telefone (já existente no CRM; sem contato, pula)
//   valor     total do orçamento, em BRL
//   fechamento previsto = validade (vencimento) do orçamento no ssOtica,
//             sempre sobrescrita; sem validade, data + 20 dias
//   vendedor  atribuído a (nome casado com os membros; senão vazio)
//   itens     notas, uma linha "produto — qtd × preço"
//   ATIVO      → etapa "Identificação e Demanda" (só ao criar)
//   CONVERTIDO → etapa "Ganho" + status won
//   EXPIRADO   → etapa "Perdidos" + status lost
//   CANCELADO  → negócio excluído
//
// Busca SEMPRE todo o histórico (01/01/2001 a 31/12/2100) e só grava o que
// mudou (hash do conteúdo, incluindo os números de O.S./venda).
// ============================================================

import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { ssoticaGet } from './client'
import { canonicalPhone } from './sync'
import {
  fetchOsNumber,
  fetchQuotes,
  loginSsotica,
  SsoticaWebError,
  type CookieJar,
  type GraphqlQuote,
} from './web'

export const PIPELINE_NAME = 'Fluxo de Vendas'
export const STAGE_ACTIVE = 'Identificação e Demanda'
/** The same stage was renamed in the CRM; either name receives active budgets. */
export const STAGE_ACTIVE_ALT = 'Orçamento Enviado'
export const STAGE_WON = 'Ganho'
export const STAGE_LOST = 'Perdidos'
export const CLOSE_DAYS_FALLBACK = 20

/** Whole ssOtica history, every run. */
const RANGE_FROM = new Date(2001, 0, 1)
const RANGE_TO = new Date(2100, 11, 31)
/** Lookups (OS page / API window) allowed per run; the rest waits for the next one. */
const ENRICH_BUDGET = 12
/** How long before an unresolved OS→sale link is looked up again. */
const RECHECK_MS = 2 * 3_600_000
/** Stop writing after this long; the remainder is picked up by the next run. */
const TIME_LIMIT_MS = 100_000

export type QuoteStatus = 'ATIVO' | 'CONVERTIDO' | 'CANCELADO' | 'EXPIRADO'

export interface Quote {
  id: string
  number: string
  total: number
  status: QuoteStatus
  createdAt: string | null // yyyy-mm-dd
  createdTs: string | null // full timestamp of the budget (America/Bahia, -03:00)
  validUntil: string | null // yyyy-mm-dd
  convertedDay: string | null
  phone: string | null
  seller: string | null
  notes: string
  osHash: string | null
  saleHash: string | null
}

// ------------------------------------------------------------
// Pure helpers (unit tested)
// ------------------------------------------------------------

/** "1.200,00" | "R$ 1.200,00" | 1200 | "1200.00" → 1200 */
export function parseMoney(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v ?? '').replace(/[^\d,.-]/g, '')
  if (!s) return 0
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s)
  return Number.isFinite(n) ? n : 0
}

/** "01/10/2026 12:10", "2026-10-01 12:10:00" or ISO → "2026-10-01" */
export function parseDay(v: unknown): string | null {
  const s = String(v ?? '').trim()
  let m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** "01/10/2026 12:10" → "2026-10-01T12:10:00-03:00" (budget time, store timezone). */
export function parseTimestamp(v: unknown): string | null {
  const s = String(v ?? '').trim()
  let m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(s)
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4] ?? '12'}:${m[5] ?? '00'}:00-03:00`
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s)
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '12'}:${m[5] ?? '00'}:00-03:00` : null
}

/** ORC 149 / OS 1256 / VEN 1200 — each part only when it exists. */
export function buildTitle(
  number: string,
  osNumber?: string | null,
  saleNumber?: string | null,
): string {
  return [`ORC ${number}`, osNumber ? `OS ${osNumber}` : null, saleNumber ? `VEN ${saleNumber}` : null]
    .filter(Boolean)
    .join(' / ')
}

/** Expected close = the budget's own validity, else date + 20 days. */
export function closeDate(q: Pick<Quote, 'validUntil' | 'createdAt'>): string | null {
  return q.validUntil ?? (q.createdAt ? addDays(q.createdAt, CLOSE_DAYS_FALLBACK) : null)
}

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Member whose name matches the seller ("Ingrid Silva de Jesus" ~ "Ingrid Silva"). */
export function matchSeller<T extends { id: string; full_name: string | null }>(
  seller: string | null,
  members: T[],
): T | null {
  if (!seller) return null
  const s = norm(seller)
  const exact = members.find((m) => m.full_name && norm(m.full_name) === s)
  if (exact) return exact
  const prefix = members.filter((m) => {
    if (!m.full_name) return false
    const n = norm(m.full_name)
    return s.startsWith(n + ' ') || n.startsWith(s + ' ')
  })
  return prefix.length === 1 ? prefix[0] : null
}

export function normalizeQuote(g: GraphqlQuote): Quote | null {
  const status = String(g.status ?? '').toUpperCase() as QuoteStatus
  if (!['ATIVO', 'CONVERTIDO', 'CANCELADO', 'EXPIRADO'].includes(status)) return null
  const ddi = String(g.cliente_DDI ?? '').replace(/\D/g, '')
  const tel = String(g.cliente_telefone ?? '').replace(/\D/g, '')
  const phone = canonicalPhone(tel ? (ddi && !tel.startsWith(ddi) ? ddi : '') + tel : null)
  const lines = (g.itens ?? []).map((i) => {
    const name = i.produto?.descricao_completa?.trim() || 'Item'
    const qty = parseMoney(i.quantidade) || 1
    const price = parseMoney(i.valor)
    return `${name} — ${qty} × R$ ${price.toFixed(2).replace('.', ',')}`
  })
  return {
    id: g.hashed_id,
    number: String(g.numero),
    total: parseMoney(g.total),
    status,
    createdAt: parseDay(g.data_orcamento),
    createdTs: parseTimestamp(g.data_orcamento),
    validUntil: parseDay(g.vencimento),
    convertedDay: parseDay(g.convertido_em),
    phone,
    seller: g.funcionario?.nome?.trim() || null,
    notes: lines.join('\n'),
    osHash: g.os_hashed_id || null,
    saleHash: g.venda_hashed_id || null,
  }
}

export function contentHash(
  q: Quote,
  links: { osNumber?: string | null; saleNumber?: string | null } = {},
): string {
  return crypto
    .createHash('sha1')
    .update(
      JSON.stringify([
        'v2', q.number, q.total, q.status, q.createdTs, q.validUntil, q.seller, q.notes,
        links.osNumber ?? null, links.saleNumber ?? null,
      ]),
    )
    .digest('hex')
}

// ------------------------------------------------------------
// OS / sale number lookups (Consultative API, keyed by the quote's dates)
// ------------------------------------------------------------

interface ApiCreds {
  apiKey: string
  cnpj: string
}
interface ApiPage<T> {
  totalPages?: number
  data?: T[]
}
interface ApiOs {
  id: number
  numero: number | string
  id_venda_vinculada?: number | string | null
}
interface ApiSale {
  id: number
  numero: number | string
  valor_liquido?: number | string | null
  cliente?: { telefones?: (string | { numero?: string | null })[] | null } | null
}

async function allPages<T>(
  path: string,
  creds: ApiCreds,
  params: Record<string, string>,
): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page <= 20; page++) {
    const res = await ssoticaGet<ApiPage<T>>(path, creds, { ...params, page, perPage: 100 }, 30_000)
    out.push(...(res.data ?? []))
    if (page >= (res.totalPages ?? 1)) break
  }
  return out
}

function makeLookups(creds: ApiCreds) {
  const osCache = new Map<string, Promise<ApiOs[]>>()
  const saleCache = new Map<string, Promise<ApiSale[]>>()
  const osWindow = (from: string, to: string) => {
    const k = `${from}|${to}`
    if (!osCache.has(k)) {
      osCache.set(
        k,
        allPages<ApiOs>('/integracoes/ordens-servico/periodo', creds, {
          inicio_periodo: from, fim_periodo: to, status: 'TODAS',
        }),
      )
    }
    return osCache.get(k)!
  }
  const saleWindow = (from: string, to: string) => {
    const k = `${from}|${to}`
    if (!saleCache.has(k)) {
      saleCache.set(
        k,
        allPages<ApiSale>('/integracoes/vendas/periodo', creds, {
          inicio_periodo: from, fim_periodo: to,
        }),
      )
    }
    return saleCache.get(k)!
  }

  return {
    /** Sale number linked to an OS number (OS → id_venda_vinculada → sale). */
    async saleNumberForOs(osNumber: string, day: string): Promise<string | null> {
      const from = addDays(day, -2)
      const to = addDays(day, 30)
      const os = (await osWindow(from, to)).find((o) => String(o.numero) === osNumber)
      const saleId = os?.id_venda_vinculada
      if (!saleId) return null
      const sale = (await saleWindow(from, to)).find((s) => String(s.id) === String(saleId))
      return sale ? String(sale.numero) : null
    },
    /** A sale made straight from the budget: same customer phone + same total, that day. */
    async saleNumberByMatch(q: Quote, day: string): Promise<string | null> {
      if (!q.phone) return null
      const sales = await saleWindow(addDays(day, -1), addDays(day, 1))
      const hits = sales.filter((s) => {
        const phones = (s.cliente?.telefones ?? []).map((t) =>
          canonicalPhone(typeof t === 'string' ? t : t?.numero),
        )
        return phones.includes(q.phone) && Math.abs(parseMoney(s.valor_liquido) - q.total) < 0.01
      })
      return hits.length === 1 ? String(hits[0].numero) : null
    },
  }
}

// ------------------------------------------------------------
// Sync
// ------------------------------------------------------------

export interface QuoteSyncResult {
  ok: boolean
  error?: string
  created: number
  updated: number
  won: number
  lost: number
  deleted: number
  noContact: number
  unchanged: number
  partial?: boolean
}

const empty = (): QuoteSyncResult => ({
  ok: true, created: 0, updated: 0, won: 0, lost: 0, deleted: 0, noContact: 0, unchanged: 0,
})

async function getJar(
  db: SupabaseClient,
  cfg: { account_id: string; web_login: string; web_password: string; web_session: string | null },
  force = false,
): Promise<CookieJar> {
  if (!force && cfg.web_session) {
    try {
      return JSON.parse(decrypt(cfg.web_session)) as CookieJar
    } catch {
      /* fall through to a fresh login */
    }
  }
  const jar = await loginSsotica(cfg.web_login, decrypt(cfg.web_password))
  await db
    .from('ssotica_config')
    .update({ web_session: encrypt(JSON.stringify(jar)) })
    .eq('account_id', cfg.account_id)
  return jar
}

export async function syncQuotes(db: SupabaseClient, accountId: string): Promise<QuoteSyncResult> {
  const started = Date.now()
  const result = empty()

  const { data: cfg } = await db
    .from('ssotica_config')
    .select('account_id, created_by, cnpj, api_key, store_hash, web_login, web_password, web_session')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!cfg?.web_login || !cfg.web_password || !cfg.store_hash) {
    return { ...result, ok: false, error: 'not_configured' }
  }

  // The whole history, re-logging in once if the stored session has expired.
  let jar: CookieJar
  let quotesRaw: GraphqlQuote[]
  try {
    jar = await getJar(db, cfg)
    try {
      quotesRaw = await fetchQuotes(jar, cfg.store_hash, RANGE_FROM, RANGE_TO)
    } catch (err) {
      if (!(err instanceof SsoticaWebError) || err.code !== 'session_expired') throw err
      jar = await getJar(db, cfg, true)
      quotesRaw = await fetchQuotes(jar, cfg.store_hash, RANGE_FROM, RANGE_TO)
    }
  } catch (err) {
    const code = err instanceof SsoticaWebError ? err.code : 'unexpected'
    console.error('[ssotica-quotes] fetch failed:', code)
    return { ...result, ok: false, error: code }
  }

  const { data: pipeline } = await db
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .ilike('name', PIPELINE_NAME)
    .maybeSingle()
  if (!pipeline) return { ...result, ok: false, error: 'pipeline_missing' }
  const { data: stages } = await db
    .from('pipeline_stages')
    .select('id, name')
    .eq('pipeline_id', pipeline.id)
  const stageId = (name: string) =>
    (stages ?? []).find((s) => norm(s.name) === norm(name))?.id as string | undefined
  const activeStage = stageId(STAGE_ACTIVE) ?? stageId(STAGE_ACTIVE_ALT)
  const wonStage = stageId(STAGE_WON)
  const lostStage = stageId(STAGE_LOST)
  if (!activeStage) return { ...result, ok: false, error: 'stage_missing' }

  const { data: members } = await db
    .from('profiles')
    .select('id, full_name')
    .eq('account_id', accountId)

  const { data: tracked } = await db
    .from('ssotica_quotes')
    .select('quote_id, deal_id, status, content_hash, os_hash, os_number, sale_hash, sale_number, links_checked_at')
    .eq('account_id', accountId)
  const trackedById = new Map((tracked ?? []).map((t) => [t.quote_id as string, t]))

  const lookups = makeLookups({ apiKey: decrypt(cfg.api_key), cnpj: cfg.cnpj })
  let budget = ENRICH_BUDGET

  for (const raw of quotesRaw) {
    if (Date.now() - started > TIME_LIMIT_MS) {
      result.partial = true
      break
    }
    const q = normalizeQuote(raw)
    if (!q) continue
    const prev = trackedById.get(q.id)

    // --- OS / sale numbers (cached by hash; unresolved links re-checked every 2 h) ---
    let osNumber: string | null = prev && prev.os_hash === q.osHash ? prev.os_number ?? null : null
    let saleNumber: string | null =
      prev && prev.sale_hash === q.saleHash ? prev.sale_number ?? null : null
    let checkedAt: string | null = prev?.links_checked_at ?? null
    const needsLinks =
      q.status !== 'CANCELADO' && (q.osHash || q.saleHash) && (!osNumber || !saleNumber)
    const stale = !checkedAt || Date.now() - new Date(checkedAt).getTime() > RECHECK_MS
    if (needsLinks && budget > 0 && (stale || (q.osHash && !osNumber))) {
      try {
        const day = q.convertedDay ?? q.createdAt
        if (q.osHash && !osNumber) {
          budget--
          osNumber = await fetchOsNumber(jar, q.osHash)
        }
        if (day && !saleNumber && budget > 0) {
          if (osNumber) {
            budget--
            saleNumber = await lookups.saleNumberForOs(osNumber, day)
          } else if (q.saleHash && !q.osHash) {
            budget--
            saleNumber = await lookups.saleNumberByMatch(q, day)
          }
        }
        checkedAt = new Date().toISOString()
      } catch (err) {
        if (err instanceof SsoticaWebError && err.code === 'session_expired') {
          jar = await getJar(db, cfg, true).catch(() => jar)
        }
        console.error('[ssotica-quotes] link lookup failed:', err instanceof Error ? err.message : err)
      }
    }

    const hash = contentHash(q, { osNumber, saleNumber })
    if (prev && prev.content_hash === hash && prev.links_checked_at === checkedAt) {
      result.unchanged++
      continue
    }

    const track = async (dealId: string | null) => {
      await db.from('ssotica_quotes').upsert(
        {
          account_id: accountId,
          quote_id: q.id,
          number: q.number,
          deal_id: dealId,
          status: q.status,
          content_hash: hash,
          os_hash: q.osHash,
          os_number: osNumber,
          sale_hash: q.saleHash,
          sale_number: saleNumber,
          links_checked_at: checkedAt,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,quote_id' },
      )
    }

    // Only the link bookkeeping changed: no deal write needed.
    if (prev && prev.content_hash === hash) {
      await track(prev.deal_id ?? null)
      result.unchanged++
      continue
    }

    // CANCELADO → remove the deal.
    if (q.status === 'CANCELADO') {
      if (prev?.deal_id) {
        await db.from('deals').delete().eq('id', prev.deal_id)
        result.deleted++
      }
      await track(null)
      continue
    }

    const assignee = matchSeller(q.seller, members ?? [])
    const base = {
      title: buildTitle(q.number, osNumber, saleNumber),
      value: q.total,
      currency: 'BRL',
      notes: q.notes,
      assigned_to: assignee?.id ?? null,
      expected_close_date: closeDate(q),
      // The board orders deals by creation date: use the budget's own.
      ...(q.createdTs ? { created_at: q.createdTs } : {}),
    }
    const status = q.status === 'CONVERTIDO' ? 'won' : q.status === 'EXPIRADO' ? 'lost' : 'open'
    const targetStage =
      q.status === 'CONVERTIDO' ? wonStage : q.status === 'EXPIRADO' ? lostStage : undefined

    if (prev?.deal_id) {
      const patch: Record<string, unknown> = { ...base, status, updated_at: new Date().toISOString() }
      if (targetStage) patch.stage_id = targetStage
      const { error } = await db.from('deals').update(patch).eq('id', prev.deal_id)
      if (!error) {
        result.updated++
        if (status === 'won') result.won++
        if (status === 'lost') result.lost++
      }
      await track(prev.deal_id)
      continue
    }
    // Deal removed by hand and the budget kept its status: respect that.
    if (prev && !prev.deal_id && prev.status === q.status) {
      await track(null)
      continue
    }

    // New deal: needs a contact found by phone.
    const contact = q.phone ? await findExistingContact(db, accountId, q.phone) : null
    if (!contact) {
      result.noContact++
      continue // not tracked: retried once the contact exists
    }
    const { data: deal, error } = await db
      .from('deals')
      .insert({
        account_id: accountId,
        user_id: cfg.created_by,
        pipeline_id: pipeline.id,
        stage_id: targetStage ?? activeStage,
        contact_id: contact.id,
        status,
        ...base,
      })
      .select('id')
      .single()
    if (error || !deal) {
      console.error('[ssotica-quotes] could not create deal:', error?.message)
      continue
    }
    result.created++
    if (status === 'won') result.won++
    if (status === 'lost') result.lost++
    await track(deal.id as string)
  }
  return result
}
