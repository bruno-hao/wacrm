import { describe, expect, it } from 'vitest'
import {
  addDays,
  buildTitle,
  closeDate,
  contentHash,
  matchSeller,
  normalizeQuote,
  parseDay,
  parseMoney,
} from './quotes'
import { parseLoginForm } from './web'

describe('parsers', () => {
  it('parseMoney reads numbers and Brazilian strings', () => {
    expect(parseMoney(1200)).toBe(1200)
    expect(parseMoney('1445.6')).toBe(1445.6)
    expect(parseMoney('R$ 1.932,00')).toBe(1932)
    expect(parseMoney(null)).toBe(0)
  })
  it('parseDay accepts dd/mm/yyyy and ISO, with or without time', () => {
    expect(parseDay('01/10/2026 12:10')).toBe('2026-10-01')
    expect(parseDay('2026-10-01 12:10:00')).toBe('2026-10-01')
    expect(parseDay('')).toBeNull()
  })
  it('addDays crosses month ends (close date = quote date + 20 days)', () => {
    expect(addDays('2026-10-15', 20)).toBe('2026-11-04')
    expect(addDays('2026-01-25', 20)).toBe('2026-02-14')
  })
})

describe('buildTitle', () => {
  it('builds ORC / OS / VEN, each part only when it exists', () => {
    expect(buildTitle('149')).toBe('ORC 149')
    expect(buildTitle('149', '1256')).toBe('ORC 149 / OS 1256')
    expect(buildTitle('149', '1256', '1200')).toBe('ORC 149 / OS 1256 / VEN 1200')
    expect(buildTitle('149', null, '1200')).toBe('ORC 149 / VEN 1200')
  })
})

describe('closeDate', () => {
  it('uses the budget validity, falling back to creation + 20 days', () => {
    expect(closeDate({ validUntil: '2026-11-11', createdAt: '2026-10-14' })).toBe('2026-11-11')
    expect(closeDate({ validUntil: null, createdAt: '2026-10-15' })).toBe('2026-11-04')
    expect(closeDate({ validUntil: null, createdAt: null })).toBeNull()
  })
})

describe('matchSeller', () => {
  const members = [
    { id: 'a', full_name: 'Ingrid Silva' },
    { id: 'b', full_name: 'Bruno Oliveira' },
  ]
  it('matches the full ssOtica name against the shorter CRM name', () => {
    expect(matchSeller('Ingrid Silva de Jesus', members)?.id).toBe('a')
    expect(matchSeller('ingrid silva', members)?.id).toBe('a')
  })
  it('leaves it empty when nobody matches or the name is ambiguous', () => {
    expect(matchSeller('Tainá Souza', members)).toBeNull()
    expect(matchSeller(null, members)).toBeNull()
    // Two members could be "Ana Maria": do not guess.
    expect(
      matchSeller('Ana Maria', [
        { id: '1', full_name: 'Ana' },
        { id: '2', full_name: 'Ana Maria Lima' },
      ]),
    ).toBeNull()
  })
})

describe('normalizeQuote', () => {
  const raw = {
    hashed_id: 'abc',
    numero: 149,
    total: '1200.00',
    status: 'ativo',
    data_orcamento: '01/10/2026 12:10',
    vencimento: '15/10/2026',
    os_hashed_id: 'OSHASH1',
    venda_hashed_id: null,
    cliente_telefone: '(73) 98239-5770',
    cliente_DDI: '55',
    funcionario: { nome: 'Ingrid Silva de Jesus' },
    itens: [
      { quantidade: '1.0000', valor: '1200', produto: { descricao_completa: 'Lente Varilux' } },
    ],
  }
  it('maps the fields the pipeline needs', () => {
    const q = normalizeQuote(raw)!
    expect(q).toMatchObject({
      id: 'abc',
      number: '149',
      total: 1200,
      status: 'ATIVO',
      createdAt: '2026-10-01',
      validUntil: '2026-10-15',
      osHash: 'OSHASH1',
      saleHash: null,
      phone: '5573982395770',
      seller: 'Ingrid Silva de Jesus',
    })
    expect(q.notes).toBe('Lente Varilux — 1 × R$ 1200,00')
  })
  it('ignores unknown statuses and hashes content deterministically', () => {
    expect(normalizeQuote({ ...raw, status: 'OUTRO' })).toBeNull()
    const a = normalizeQuote(raw)!
    const b = normalizeQuote({ ...raw, total: '1300' })!
    expect(contentHash(a)).toBe(contentHash(normalizeQuote(raw)!))
    expect(contentHash(a)).not.toBe(contentHash(b))
    // OS / sale numbers are part of the hash, so resolving them updates the deal title.
    expect(contentHash(a, { osNumber: '1256' })).not.toBe(contentHash(a))
  })
})

describe('parseLoginForm', () => {
  it('finds the user/password fields and hidden inputs of the login form', () => {
    const html = `<form method="POST" action="https://app.ssotica.com.br/login">
      <input type="hidden" name="_token" value="tok123">
      <input type="email" name="email" value="">
      <input type="password" name="password">
    </form>`
    expect(parseLoginForm(html)).toEqual({
      action: 'https://app.ssotica.com.br/login',
      userField: 'email',
      passwordField: 'password',
      hidden: { _token: 'tok123' },
    })
  })
  it('returns null without a password field', () => {
    expect(parseLoginForm('<form><input type="text" name="q"></form>')).toBeNull()
  })
})
