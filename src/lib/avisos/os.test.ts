import { describe, expect, it } from 'vitest'
import { filterOs, normalizeOs, paginate, situationOf, sortOs, type NoticeOs } from './os'

const os = (over: Partial<NoticeOs>): NoticeOs => ({
  number: '1000',
  date: '2026-10-01',
  customerName: 'Maria da Silva',
  seller: 'Ingrid Silva',
  lab: 'Tecnolens',
  status: 'ABERTO',
  situation: 'nao_entregue',
  sold: true,
  phones: ['5573982395770'],
  ...over,
})

describe('situationOf', () => {
  it('maps ssOtica statuses to the four situations', () => {
    expect(situationOf('ABERTO')).toBe('nao_entregue')
    expect(situationOf('VENDIDO')).toBe('nao_entregue')
    expect(situationOf('ENTREGUE')).toBe('entregue')
    expect(situationOf('CANCELADO')).toBe('cancelada')
    expect(situationOf('PERDA')).toBe('perda')
  })
})

describe('normalizeOs', () => {
  it('reads customer, seller, lab, sale link and canonical phones', () => {
    const n = normalizeOs({
      numero: 1256,
      data: '2026-09-22',
      status: 'aberto',
      laboratorio: ' Hoya ',
      id_venda_vinculada: 51792798,
      funcionario: { nome: 'Ingrid Silva de Jesus' },
      cliente: { nome: 'Regina', telefones: ['(71) 9.8831-1413', '(71) 8831-1413'] },
    })!
    expect(n).toMatchObject({
      number: '1256',
      date: '2026-09-22',
      lab: 'Hoya',
      sold: true,
      situation: 'nao_entregue',
      seller: 'Ingrid Silva de Jesus',
      phones: ['5571988311413'],
    })
    expect(normalizeOs({ numero: null, data: '2026-01-01' })).toBeNull()
  })
})

describe('filterOs', () => {
  const list = [
    os({ number: '1001', customerName: 'Regina Maria', lab: 'Hoya' }),
    os({ number: '1002', customerName: 'João Pedro', seller: 'Tainá', situation: 'entregue', status: 'ENTREGUE' }),
    os({ number: '1003', customerName: 'Ana', sold: false, lab: 'Segment Produtos' }),
  ]
  it('searches name (accent-insensitive), O.S. number, seller and laboratory', () => {
    expect(filterOs(list, { q: 'joao' }).map((o) => o.number)).toEqual(['1002'])
    expect(filterOs(list, { q: '1003' }).map((o) => o.number)).toEqual(['1003'])
    expect(filterOs(list, { q: 'taina' }).map((o) => o.number)).toEqual(['1002'])
    expect(filterOs(list, { q: 'segment' }).map((o) => o.number)).toEqual(['1003'])
  })
  it('combines the situation and sold filters (default: not delivered + sold)', () => {
    expect(filterOs(list, { situations: ['nao_entregue'], sold: ['sold'] }).map((o) => o.number)).toEqual(['1001'])
    expect(filterOs(list, { situations: ['nao_entregue', 'entregue'] }).length).toBe(3)
    expect(filterOs(list, {}).length).toBe(3)
  })
})

describe('sortOs / paginate', () => {
  it('orders newest first, ties by higher O.S. number', () => {
    const sorted = sortOs([
      os({ number: '10', date: '2026-09-01' }),
      os({ number: '12', date: '2026-10-01' }),
      os({ number: '11', date: '2026-10-01' }),
    ])
    expect(sorted.map((o) => o.number)).toEqual(['12', '11', '10'])
  })
  it('pages 10 at a time and clamps the page', () => {
    const many = Array.from({ length: 23 }, (_, i) => i)
    expect(paginate(many, 1).items.length).toBe(10)
    expect(paginate(many, 3).items).toEqual([20, 21, 22])
    expect(paginate(many, 99).page).toBe(3)
    expect(paginate([], 1)).toMatchObject({ pages: 1, total: 0 })
  })
})
