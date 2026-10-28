import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTrackingCode, normalizeTrackingCode, parseTrackingPayload, trackCorreiosObject } from './rastro'

describe('Correios tracking', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  it('normalizes and validates object codes', () => {
    expect(normalizeTrackingCode(' ea000906951br ')).toBe('EA000906951BR')
    expect(isTrackingCode('EA000906951BR')).toBe(true)
    expect(isTrackingCode('INVALID')).toBe(false)
  })

  it('sends pt-BR and reports object-level contract errors instead of a false success', async () => {
    vi.stubEnv('CORREIOS_API_TOKEN', 'test-token')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ objetos: [{ codObjeto: 'EA000906951BR', mensagem: 'SRO-009: Objeto não pertence ao contrato' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(trackCorreiosObject('EA000906951BR')).rejects.toThrow('Objeto não pertence ao contrato')
    expect(fetchMock.mock.calls[0][1].headers['Accept-Language']).toBe('pt-BR')
  })

  it('normalizes the Correios object response and creates a change fingerprint', () => {
    const result = parseTrackingPayload({
      objetos: [{
        eventos: [{ dtHrCriado: '27/10/2026 10:00', codigo: 'BDE', descricao: 'Objeto em trânsito', unidade: 'Salvador/BA' }],
      }],
    }, 'EA000906951BR')
    expect(result.status).toBe('Objeto em trânsito')
    expect(result.statusCode).toBe('BDE')
    expect(result.events[0].location).toBe('Salvador/BA')
    expect(result.fingerprint).toContain('BDE')
  })
})
