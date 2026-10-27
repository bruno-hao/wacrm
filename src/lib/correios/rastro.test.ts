import { describe, expect, it } from 'vitest'
import { isTrackingCode, normalizeTrackingCode, parseTrackingPayload } from './rastro'

describe('Correios tracking', () => {
  it('normalizes and validates object codes', () => {
    expect(normalizeTrackingCode(' ea000906951br ')).toBe('EA000906951BR')
    expect(isTrackingCode('EA000906951BR')).toBe(true)
    expect(isTrackingCode('INVALID')).toBe(false)
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
