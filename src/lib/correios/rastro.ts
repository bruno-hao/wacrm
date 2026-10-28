const CODE = /^[A-Z]{2}\d{9}[A-Z]{2}$/

export interface TrackingEvent {
  date: string | null
  code: string | null
  status: string
  location: string | null
  detail: string | null
}

export interface TrackingResult {
  code: string
  status: string
  statusCode: string | null
  events: TrackingEvent[]
  lastEventAt: string | null
  fingerprint: string
}

export class CorreiosTrackingError extends Error {
  readonly code: 'invalid_code' | 'not_configured' | 'not_found' | 'api_error'
  readonly status: number

  constructor(code: CorreiosTrackingError['code'], message: string, status: number) {
    super(message)
    this.name = 'CorreiosTrackingError'
    this.code = code
    this.status = status
  }
}

export function normalizeTrackingCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

export function isTrackingCode(value: unknown): value is string {
  return typeof value === 'string' && CODE.test(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const found = text(value)
    if (found) return found
  }
  return null
}

function locationText(value: unknown): string | null {
  const direct = text(value)
  if (direct) return direct
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  return firstString(
    item.nome,
    item.nomeUnidade,
    item.cidade && item.uf ? `${text(item.cidade) ?? ''}/${text(item.uf) ?? ''}` : null,
    item.endereco,
  )
}

function eventsFromPayload(payload: unknown): TrackingEvent[] {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const objects = Array.isArray(root.objetos) ? root.objetos : [root]
  const rows: TrackingEvent[] = []
  for (const object of objects) {
    if (!object || typeof object !== 'object') continue
    const item = object as Record<string, unknown>
    const rawEvents = Array.isArray(item.eventos)
      ? item.eventos
      : Array.isArray(item.objeto) ? item.objeto : []
    for (const raw of rawEvents) {
      if (!raw || typeof raw !== 'object') continue
      const event = raw as Record<string, unknown>
      const date = firstString(event.dtHrCriado, event.data, event.date, event.dtEvento)
      rows.push({
        date,
        code: firstString(event.codigo, event.code, event.coEvento),
        status: firstString(event.descricao, event.status, event.description) ?? 'Status não informado',
        location: firstString(locationText(event.unidade), event.local, event.location),
        detail: firstString(event.detalhe, event.detail, event.observacao),
      })
    }
  }
  return rows
}

function fingerprint(result: Omit<TrackingResult, 'fingerprint'>): string {
  return JSON.stringify({ code: result.statusCode, status: result.status, last: result.events[0] ?? null })
}

export function parseTrackingPayload(payload: unknown, code: string): TrackingResult {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const events = eventsFromPayload(payload)
  const first = events[0]
  const status = first?.status ?? firstString(root.status, root.descricao, root.message) ?? 'Objeto localizado'
  const base = {
    code,
    status,
    statusCode: first?.code ?? firstString(root.codigo, root.coEvento),
    events,
    lastEventAt: first?.date ?? null,
  }
  return { ...base, fingerprint: fingerprint(base) }
}

export async function trackCorreiosObject(rawCode: unknown, accountId?: string): Promise<TrackingResult> {
  const code = normalizeTrackingCode(rawCode)
  if (!isTrackingCode(code)) {
    throw new CorreiosTrackingError('invalid_code', 'Informe um código de encomenda válido, como EA000906951BR.', 400)
  }
  let token: string
  try { token = accountId ? await getCorreiosAccessToken(accountId) : process.env.CORREIOS_API_TOKEN?.trim() || '' } catch (error) {
    throw new CorreiosTrackingError('not_configured', error instanceof Error ? error.message : 'A API dos Correios ainda não foi configurada.', 503)
  }
  if (!token) throw new CorreiosTrackingError('not_configured', 'Configure as credenciais da API dos Correios.', 503)
  const base = (process.env.CORREIOS_API_BASE_URL || 'https://api.correios.com.br').replace(/\/$/, '')
  let response: Response
  try {
    response = await fetch(`${base}/srorastro/v1/objetos/${encodeURIComponent(code)}?resultado=T`, {
      headers: { Accept: 'application/json', 'Accept-Language': 'pt-BR', Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new CorreiosTrackingError('api_error', 'Não foi possível consultar os Correios agora.', 502)
  }
  const payload = await response.json().catch(() => null)
  if (response.status === 404 || response.status === 422) {
    throw new CorreiosTrackingError('not_found', 'Código não encontrado nos Correios.', 404)
  }
  if (!response.ok) {
    throw new CorreiosTrackingError('api_error', 'Os Correios recusaram a consulta. Verifique a credencial da API.', 502)
  }
  const objects = payload && typeof payload === 'object' && Array.isArray(payload.objetos) ? payload.objetos : []
  const objectMessage = objects.find((item: unknown) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).mensagem === 'string')?.mensagem
  if (typeof objectMessage === 'string' && objectMessage.trim()) {
    throw new CorreiosTrackingError('not_found', objectMessage.trim(), 404)
  }
  return parseTrackingPayload(payload, code)
}
import { getCorreiosAccessToken } from './auth'
