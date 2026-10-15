/**
 * Web links into the ssOtica app. Only the sale link can be built from
 * what we hold: it needs the store's short code (pasted by an admin in
 * Settings > ssOtica) plus the sale number. The API returns no code for
 * OS pages or prescription images, so those are shown unlinked.
 */
export function saleUrl(
  storeHash: string | null | undefined,
  saleNumber: string | number | null | undefined,
): string | null {
  const hash = storeHash?.trim()
  const number = saleNumber != null ? String(saleNumber).trim() : ''
  if (!hash || !/^[A-Za-z0-9]+$/.test(hash) || !/^\d+$/.test(number)) return null
  return `https://app.ssotica.com.br/movimentacao/vendas/${hash}/listar?nsa_venda_Venda=${number}`
}
