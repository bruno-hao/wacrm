import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('agent')
    const body = await request.json().catch(() => null)
    const review = typeof body?.review === 'object' ? body.review : {}
    const { data: row } = await supabaseAdmin().from('ai_configs').select('google_reviews_model, google_reviews_prompt').eq('account_id', accountId).maybeSingle()
    const config = await loadAiConfig(supabaseAdmin(), accountId, { requireActive: false })
    if (!config) return NextResponse.json({ error: 'ai_not_configured', message: 'Configure a API de IA antes de gerar respostas.' }, { status: 400 })
    const prompt = row?.google_reviews_prompt?.trim() || 'Responda profissionalmente à avaliação do cliente, agradecendo quando apropriado, demonstrando empatia e convidando-o a voltar. Não invente fatos nem mencione que você é uma IA.'
    const model = row?.google_reviews_model?.trim()
    const result = await generateReply({ config: model ? { ...config, model } : config, systemPrompt: prompt, messages: [{ role: 'user', content: `Avaliação recebida (${review.starRating ?? review.star_rating ?? ''} estrelas) de ${review.reviewerName ?? review.reviewer_name ?? 'cliente'}:\n${review.comment ?? ''}` }] })
    return NextResponse.json({ text: result.text })
  } catch (error) { return toErrorResponse(error) }
}
