// Display helpers for the Orçamentos page (pure, shared with tests).

const LOWER = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

/** Budget number padded to at least 4 digits: 149 → "0149", 1264 → "1264". */
export function formatQuoteNumber(n: string | number): string {
  const s = String(n).trim()
  return /^\d+$/.test(s) ? s.padStart(4, '0') : s
}

/** "MARIA DA SILVA" → "Maria da Silva"; de / da / do / das / dos / e stay lowercase. */
export function titleCaseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && LOWER.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/** First name only, capitalised: "INGRID SILVA DE JESUS" → "Ingrid". */
export function firstName(name: string | null | undefined): string {
  const w = (name ?? '').trim().split(/\s+/)[0] ?? ''
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''
}
