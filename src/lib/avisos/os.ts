// ============================================================
// Avisos para Clientes — service orders (O.S.) from the ssOtica API.
//
// The list is read live from the Consultative API
// (`/integracoes/ordens-servico/periodo`, status TODAS), filtered here and
// cached for a minute, so the page always reflects ssOtica.
// ============================================================

import { ssoticaGet } from '@/lib/ssotica/client'
import { canonicalPhone } from '@/lib/ssotica/sync'

export type Situation = 'nao_entregue' | 'entregue' | 'cancelada' | 'perda'
export const SITUATIONS: Situation[] = ['nao_entregue', 'entregue', 'cancelada', 'perda']
export type SoldFilter = 'sold' | 'not_sold'

export interface NoticeOs {
  number: string
  date: string // yyyy-mm-dd
  customerName: string
  seller: string
  lab: string
  status: string
  situation: Situation
  sold: boolean
  phones: string[] // canonical (ninth digit)
  customerId: string // ssOtica customer id ('' when absent)
  prescriptionExpiry: string | null // yyyy-mm-dd, from the O.S. prescription
}

interface RawOs {
  numero?: number | string | null
  data?: string | null
  status?: string | null
  laboratorio?: string | null
  id_venda_vinculada?: number | string | null
  funcionario?: { nome?: string | null } | null
  receita?: { validade?: string | null } | null
  cliente?: {
    id?: number | string | null
    nome?: string | null
    telefones?: (string | { numero?: string | null })[] | null
  } | null
}

/** Não Entregue (open / closed / sold / veiled), Entregue, Cancelada, Perda. */
export function situationOf(status: string | null | undefined): Situation {
  switch ((status ?? '').toUpperCase()) {
    case 'ENTREGUE':
      return 'entregue'
    case 'CANCELADO':
      return 'cancelada'
    case 'PERDA':
      return 'perda'
    default:
      return 'nao_entregue'
  }
}

function dayOrNull(v: string | null | undefined): string | null {
  const d = String(v ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

export function normalizeOs(raw: RawOs): NoticeOs | null {
  if (raw.numero == null || !raw.data) return null
  const status = String(raw.status ?? '').toUpperCase()
  const phones = (raw.cliente?.telefones ?? [])
    .map((t) => canonicalPhone(typeof t === 'string' ? t : t?.numero))
    .filter((p): p is string => !!p)
  return {
    number: String(raw.numero),
    date: String(raw.data).slice(0, 10),
    customerName: raw.cliente?.nome?.trim() ?? '',
    seller: raw.funcionario?.nome?.trim() ?? '',
    lab: raw.laboratorio?.trim() ?? '',
    status,
    situation: situationOf(status),
    sold:
      status === 'VENDIDO' ||
      (raw.id_venda_vinculada != null && String(raw.id_venda_vinculada).trim() !== ''),
    phones: [...new Set(phones)],
    customerId: raw.cliente?.id != null ? String(raw.cliente.id) : '',
    prescriptionExpiry: dayOrNull(raw.receita?.validade),
  }
}

const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * Search by customer name, O.S. number, seller or laboratory; filter by
 * situation and sold / not sold (an empty group means "no filter").
 */
export function filterOs(
  list: NoticeOs[],
  opts: { q?: string; situations?: Situation[]; sold?: SoldFilter[]; statuses?: string[] },
): NoticeOs[] {
  const q = fold(opts.q ?? '')
  const situations = opts.situations?.length ? new Set(opts.situations) : null
  const sold = opts.sold?.length ? new Set(opts.sold) : null
  const statuses = opts.statuses?.length ? new Set(opts.statuses) : null
  return list.filter((o) => {
    if (statuses && !statuses.has(o.status)) return false
    if (situations && !situations.has(o.situation)) return false
    if (sold && !sold.has(o.sold ? 'sold' : 'not_sold')) return false
    if (!q) return true
    return (
      fold(o.customerName).includes(q) ||
      o.number.includes(q.replace(/\D/g, '') || '\u0000') ||
      fold(o.seller).includes(q) ||
      fold(o.lab).includes(q)
    )
  })
}

/** Newest first; same day → higher O.S. number first. */
export function sortOs(list: NoticeOs[]): NoticeOs[] {
  return [...list].sort(
    (a, b) => b.date.localeCompare(a.date) || Number(b.number) - Number(a.number),
  )
}

export type PrescriptionPeriod = 'this_month' | 'last_month' | 'last_3' | 'last_6'
export const PRESCRIPTION_PERIODS: PrescriptionPeriod[] = ['this_month', 'last_month', 'last_3', 'last_6']

function addMonths(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  const dom = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + n)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(dom, last))
  return d.toISOString().slice(0, 10)
}

/**
 * Expiry window (inclusive) of a period, ending no later than `today`:
 * this month = 1st → today; last month = the whole previous month;
 * 3 / 6 months = the same day N months back → today.
 */
export function expiryWindow(period: PrescriptionPeriod, today: string): { from: string; to: string } {
  const first = `${today.slice(0, 8)}01`
  switch (period) {
    case 'this_month':
      return { from: first, to: today }
    case 'last_month': {
      const end = new Date(Date.parse(`${first}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
      return { from: addMonths(first, -1), to: end }
    }
    case 'last_3':
      return { from: addMonths(today, -3), to: today }
    case 'last_6':
      return { from: addMonths(today, -6), to: today }
  }
}

/**
 * Customers whose most recent prescription expired inside the window.
 * One row per customer (the O.S. with the latest expiry); cancelled / lost
 * O.S. are ignored. Newest expiry first.
 */
export function expiredPrescriptions(list: NoticeOs[], win: { from: string; to: string }): NoticeOs[] {
  const latest = new Map<string, NoticeOs>()
  for (const o of list) {
    if (!o.prescriptionExpiry || o.situation === 'cancelada' || o.situation === 'perda') continue
    const key = o.customerId || `n:${fold(o.customerName)}`
    const cur = latest.get(key)
    if (!cur || o.prescriptionExpiry > (cur.prescriptionExpiry ?? '')) latest.set(key, o)
  }
  return [...latest.values()]
    .filter((o) => o.prescriptionExpiry! >= win.from && o.prescriptionExpiry! <= win.to)
    .sort((a, b) => b.prescriptionExpiry!.localeCompare(a.prescriptionExpiry!) || Number(b.number) - Number(a.number))
}

export function paginate<T>(list: T[], page: number, size = 10) {
  const pages = Math.max(1, Math.ceil(list.length / size))
  const p = Math.min(Math.max(1, page), pages)
  return { items: list.slice((p - 1) * size, p * size), page: p, pages, total: list.length }
}

// ---------------- fetching (windows of ≤180 days, cached 60 s) ----------------

const WINDOW_DAYS = 179
const CACHE_MS = 60_000
const cache = new Map<string, { at: number; data: Promise<NoticeOs[]> }>()

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function fetchWindow(
  creds: { apiKey: string; cnpj: string },
  from: string,
  to: string,
): Promise<NoticeOs[]> {
  const out: NoticeOs[] = []
  for (let page = 1; page <= 20; page++) {
    const res = await ssoticaGet<{ totalPages?: number; data?: RawOs[] }>(
      '/integracoes/ordens-servico/periodo',
      creds,
      { inicio_periodo: from, fim_periodo: to, status: 'TODAS', page, perPage: 100 },
      30_000,
    )
    for (const raw of res.data ?? []) {
      const os = normalizeOs(raw)
      if (os) out.push(os)
    }
    if (page >= (res.totalPages ?? 1)) break
  }
  return out
}

/** Every O.S. opened between `from` and `to` (yyyy-mm-dd), any status. */
export async function fetchOsRange(
  creds: { apiKey: string; cnpj: string },
  from: string,
  to: string,
): Promise<NoticeOs[]> {
  const key = `${creds.cnpj}|${from}|${to}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data
  const data = (async () => {
    const all: NoticeOs[] = []
    for (let start = from; start <= to; ) {
      const end = addDays(start, WINDOW_DAYS) < to ? addDays(start, WINDOW_DAYS) : to
      all.push(...(await fetchWindow(creds, start, end)))
      start = addDays(end, 1)
    }
    return all
  })()
  cache.set(key, { at: Date.now(), data })
  data.catch(() => cache.delete(key))
  return data
}
