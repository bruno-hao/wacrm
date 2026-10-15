// ============================================================
// ssOtica budgets → pipeline "Fluxo de Vendas".
//
//   número            → título do negócio
//   telefone          → contato (já existente no CRM; sem contato, pula)
//   total             → valor, moeda BRL
//   data do orçamento → fechamento previsto = data + 20 dias
//   vendedor          → atribuído a (nome casado com os membros; senão vazio)
//   itens             → notas, uma linha "produto — qtd × preço"
//   ATIVO     → etapa "Identificação e Demanda" (só ao criar; depois o
//               time pode mover o negócio sem a sincronização desfazer)
//   CONVERTIDO→ etapa "Ganho" + status won
//   EXPIRADO  → status lost
//   CANCELADO → negócio excluído
// ============================================================

import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { canonicalPhone } from './sync'
import {
  fetchQuotes,
  loginSsotica,
  SsoticaWebError,
  type CookieJar,
  type GraphqlQuote,
} from './web'

export const PIPELINE_NAME = 'Fluxo de Vendas'
export const STAGE_ACTIVE = 'Identificação e Demanda'
export const STAGE_WON = 'Ganho'
export const CLOSE_DAYS = 20
const LOOKBACK_DAYS = 90

export type QuoteStatus = 'ATIVO' | 'CONVERTIDO' | 'CANCELADO' | 'EXPIRADO'

export interface Quote {
  id: string
  number: string
  total: number
  status: QuoteStatus
  createdAt: string | null // yyyy-mm-dd
  phone: string | null
  seller: string | null
  notes: string
}

// ------------------------------------------------------------
// Pure helpers (unit tested)
// ------------------------------------------------------------

/** "1.200,00" | "R$ 1.200,00" | 1200 | "1200.00" → 1200 */
export function parseMoney(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v ?? '').replace(/[^\d,.-]/g, '')
  if (!s) return 0
  const n =
    s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s)
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
    phone,
    seller: g.funcionario?.nome?.trim() || null,
    notes: lines.join('\n'),
  }
}

export function contentHash(q: Quote): string {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify([q.number, q.total, q.status, q.createdAt, q.seller, q.notes]))
    .digest('hex')
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
  const result = empty()

  const { data: cfg } = await db
    .from('ssotica_config')
    .select('account_id, created_by, store_hash, web_login, web_password, web_session')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!cfg?.web_login || !cfg.web_password || !cfg.store_hash) {
    return { ...result, ok: false, error: 'not_configured' }
  }

  // Fetch, re-logging in once if the stored session has expired.
  const to = new Date()
  const from = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)
  let quotesRaw: GraphqlQuote[]
  try {
    try {
      quotesRaw = await fetchQuotes(await getJar(db, cfg), cfg.store_hash, from, to)
    } catch (err) {
      if (!(err instanceof SsoticaWebError) || err.code !== 'session_expired') throw err
      quotesRaw = await fetchQuotes(await getJar(db, cfg, true), cfg.store_hash, from, to)
    }
  } catch (err) {
    const code = err instanceof SsoticaWebError ? err.code : 'unexpected'
    console.error('[ssotica-quotes] fetch failed:', code)
    return { ...result, ok: false, error: code }
  }

  // Pipeline, stages, members.
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
  const activeStage = stageId(STAGE_ACTIVE)
  const wonStage = stageId(STAGE_WON)
  if (!activeStage) return { ...result, ok: false, error: 'stage_missing' }

  const { data: members } = await db
    .from('profiles')
    .select('id, full_name')
    .eq('account_id', accountId)

  const { data: tracked } = await db
    .from('ssotica_quotes')
    .select('quote_id, deal_id, status, content_hash')
    .eq('account_id', accountId)
  const trackedById = new Map((tracked ?? []).map((t) => [t.quote_id as string, t]))

  for (const raw of quotesRaw) {
    const q = normalizeQuote(raw)
    if (!q) continue
    const hash = contentHash(q)
    const prev = trackedById.get(q.id)
    if (prev && prev.content_hash === hash) {
      result.unchanged++
      await db
        .from('ssotica_quotes')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('account_id', accountId)
        .eq('quote_id', q.id)
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
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,quote_id' },
      )
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
      title: q.number,
      value: q.total,
      currency: 'BRL',
      notes: q.notes,
      assigned_to: assignee?.id ?? null,
    }
    const status = q.status === 'CONVERTIDO' ? 'won' : q.status === 'EXPIRADO' ? 'lost' : 'open'

    if (prev?.deal_id) {
      const patch: Record<string, unknown> = { ...base, status, updated_at: new Date().toISOString() }
      if (q.status === 'CONVERTIDO' && wonStage) patch.stage_id = wonStage
      const { error } = await db.from('deals').update(patch).eq('id', prev.deal_id)
      if (!error) {
        result.updated++
        if (status === 'won') result.won++
        if (status === 'lost') result.lost++
      }
      await track(prev.deal_id)
      continue
    }
    // Deal was removed by hand and the quote is otherwise unchanged in kind: respect it.
    if (prev && !prev.deal_id && prev.status === q.status) {
      await track(null)
      continue
    }

    // New deal: needs a contact found by phone.
    const contact = q.phone ? await findExistingContact(db, accountId, q.phone) : null
    if (!contact) {
      result.noContact++
      continue // not tracked: it will be retried once the contact exists
    }
    const { data: deal, error } = await db
      .from('deals')
      .insert({
        account_id: accountId,
        user_id: cfg.created_by,
        pipeline_id: pipeline.id,
        stage_id: q.status === 'CONVERTIDO' && wonStage ? wonStage : activeStage,
        contact_id: contact.id,
        expected_close_date: q.createdAt ? addDays(q.createdAt, CLOSE_DAYS) : null,
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
