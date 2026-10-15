// ============================================================
// Standard messages ("Mensagens Padrão"): reusable texts for the ZapÓtica
// modules, edited in Settings. New accounts get placeholder (mock) texts
// that the store is expected to rewrite.
//
// `{nome}` in a text is replaced by the customer's first name when sent.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export type StandardCategory = 'posvenda' | 'receitas' | 'aniversario'
export const STANDARD_CATEGORIES: StandardCategory[] = ['posvenda', 'receitas', 'aniversario']

export interface StandardMessage {
  id: string
  category: StandardCategory
  title: string
  content_text: string
  position: number
}

const DEFAULTS: { category: StandardCategory; title: string; text: string }[] = [
  {
    category: 'posvenda',
    title: 'Adaptação de óculos e armação',
    text: 'Olá, {nome}! Aqui é da M Vision Ótica. Como está a adaptação dos seus óculos novos? Se sentir qualquer desconforto na armação ou nas lentes, é só nos chamar que ajustamos para você. (mensagem de exemplo)',
  },
  {
    category: 'posvenda',
    title: 'Limpeza',
    text: 'Olá, {nome}! Aqui é da M Vision Ótica. Que tal uma limpeza gratuita nos seus óculos? Passe na loja quando quiser e deixamos tudo como novo. (mensagem de exemplo)',
  },
  {
    category: 'posvenda',
    title: 'Substituição de plaqueta / plaqueta nasal',
    text: 'Olá, {nome}! Aqui é da M Vision Ótica. Se as plaquetas nasais dos seus óculos estiverem machucando ou amareladas, podemos substituí-las rapidamente. Venha nos visitar! (mensagem de exemplo)',
  },
  {
    category: 'posvenda',
    title: 'Manutenção preventiva',
    text: 'Olá, {nome}! Aqui é da M Vision Ótica. Já faz um tempo desde a sua compra: que tal uma manutenção preventiva nos seus óculos? Aparafusamos, alinhamos e limpamos sem custo. (mensagem de exemplo)',
  },
  {
    category: 'receitas',
    title: 'Receita vencida',
    text: 'Olá, {nome}! Aqui é da M Vision Ótica. Notamos que a receita dos seus óculos já venceu. Que tal agendar um novo exame de vista? Cuidar da visão é cuidar de você! (mensagem de exemplo)',
  },
  {
    category: 'aniversario',
    title: 'Feliz aniversário',
    text: 'Parabéns, {nome}! 🎉 A equipe da M Vision Ótica deseja um feliz aniversário, com muita saúde e boas imagens pela frente. Passe na loja e ganhe uma surpresa! (mensagem de exemplo)',
  },
]

/** The account's standard messages; seeds the placeholders on first use. */
export async function listStandardMessages(
  db: SupabaseClient,
  accountId: string,
  category?: StandardCategory,
): Promise<StandardMessage[]> {
  const fetchAll = async () => {
    const { data, error } = await db
      .from('standard_messages')
      .select('id, category, title, content_text, position')
      .eq('account_id', accountId)
      .order('category')
      .order('position')
      .order('created_at')
    if (error) throw error
    return (data ?? []) as StandardMessage[]
  }

  let all = await fetchAll()
  if (all.length === 0) {
    await db.from('standard_messages').insert(
      DEFAULTS.map((d, i) => ({
        account_id: accountId,
        category: d.category,
        title: d.title,
        content_text: d.text,
        position: i,
      })),
    )
    all = await fetchAll()
  }
  return category ? all.filter((m) => m.category === category) : all
}

/** "{nome}" → first name of the customer, capitalised ("" → "cliente"). */
export function fillStandardMessage(text: string, customerName: string | null | undefined): string {
  const first = (customerName ?? '').trim().split(/\s+/)[0] ?? ''
  const name = first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : 'cliente'
  return text.replace(/\{nome\}/gi, name)
}
