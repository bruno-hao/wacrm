import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SsoticaError,
  isValidCnpj,
  normalizeCnpj,
  ssoticaGet,
  testSsoticaConnection,
} from './client'

const creds = { apiKey: 'secret-key', cnpj: '11.222.333/0001-81' }

function mockFetch(status: number, body: string, contentType = 'application/json') {
  const fn = vi.fn().mockResolvedValue(
    new Response(body, { status, headers: { 'content-type': contentType } }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('cnpj helpers', () => {
  it('normalizes and validates check digits', () => {
    expect(normalizeCnpj('11.222.333/0001-81')).toBe('11222333000181')
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
    expect(isValidCnpj('11222333000182')).toBe(false)
    expect(isValidCnpj('11111111111111')).toBe(false)
    expect(isValidCnpj('123')).toBe(false)
  })
})

describe('ssoticaGet', () => {
  it('sends the bearer key and the bare-digit cnpj', async () => {
    const fn = mockFetch(200, '{"data":[]}')
    await ssoticaGet('/integracoes/clientes', creds, { page: 1, perPage: 1 })
    const [url, init] = fn.mock.calls[0]
    expect(String(url)).toBe(
      'https://app.ssotica.com.br/api/v1/integracoes/clientes?cnpj=11222333000181&page=1&perPage=1',
    )
    expect(init.headers.Authorization).toBe('Bearer secret-key')
  })

  it('maps a bare "Unauthorized" 401 to invalid_key', async () => {
    mockFetch(401, 'Unauthorized', 'text/html')
    await expect(testSsoticaConnection(creds)).rejects.toMatchObject({ code: 'invalid_key' })
  })

  it('maps a 401 with a message to user_blocked', async () => {
    mockFetch(401, 'Usuário bloqueado', 'text/html')
    await expect(testSsoticaConnection(creds)).rejects.toMatchObject({ code: 'user_blocked' })
  })

  it.each([
    ['EMPRESA_NAO_ENCONTRADA', 'store_not_found'],
    ['API_NAO_CONTRATADA', 'api_not_contracted'],
    ['CONTRATO_ILEGIVEL', 'contract_unreadable'],
    ['PARAMETRO_INVALIDO', 'bad_request'],
  ])('maps 400 %s to %s', async (apiCode, code) => {
    mockFetch(400, JSON.stringify({ error: apiCode, error_info: 'x' }))
    await expect(testSsoticaConnection(creds)).rejects.toMatchObject({ code })
  })

  it('reports network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    const err = await testSsoticaConnection(creds).catch((e) => e)
    expect(err).toBeInstanceOf(SsoticaError)
    expect(err.code).toBe('network')
  })

  it('resolves on success', async () => {
    mockFetch(200, '{"currentPage":1,"totalPages":1,"data":[]}')
    await expect(testSsoticaConnection(creds)).resolves.toBeUndefined()
  })
})
