import { describe, expect, it } from 'vitest'
import { DEFAULT_MARIA_SYSTEM_PROMPT } from './maria-prompt'

describe('default Maria prompt', () => {
  it('uses WACRM-safe rules and São Paulo timezone', () => {
    expect(DEFAULT_MARIA_SYSTEM_PROMPT).toContain('America/Sao_Paulo')
    expect(DEFAULT_MARIA_SYSTEM_PROMPT).toContain('[[HANDOFF]]')
    expect(DEFAULT_MARIA_SYSTEM_PROMPT).toContain('SSOtica')
    expect(DEFAULT_MARIA_SYSTEM_PROMPT).not.toContain('consultar_pedido_ssotica')
    expect(DEFAULT_MARIA_SYSTEM_PROMPT).not.toContain('$now')
  })
})
