import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadAiConfig } from '@/lib/ai/config'
import { generatePrescriptionReading } from '@/lib/ai/prescription'
import { validatePrescriptionSandboxImage } from '@/lib/ai/prescription-sandbox'
import { AiError } from '@/lib/ai/types'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/** Ephemeral recipe sandbox: the uploaded bytes never enter Storage or the database. */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const form = await request.formData()
    const file = form.get('image')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: t('ai.prescriptionSandboxImageRequired'), code: 'image_required' }, { status: 400 })
    }

    const validation = validatePrescriptionSandboxImage({ mimeType: file.type, size: file.size })
    if (!validation.ok) {
      const key = validation.code === 'invalid_image' ? 'ai.prescriptionSandboxInvalidImage' : 'ai.prescriptionSandboxImageTooLarge'
      return NextResponse.json({ error: t(key), code: validation.code }, { status: 400 })
    }

    const config = await loadAiConfig(supabase, accountId, { requireActive: false })
    if (!config?.prescriptionReaderModel) {
      return NextResponse.json({ error: t('ai.prescriptionSandboxNotConfigured'), code: 'prescription_reader_not_configured' }, { status: 400 })
    }

    const result = await generatePrescriptionReading({
      config,
      model: config.prescriptionReaderModel,
      prompt: config.prescriptionReaderPrompt || 'Leia apenas os campos legíveis da receita. Indique incertezas. Não faça diagnóstico nem recomende lentes.',
      bytes: await file.arrayBuffer(),
      mimeType: file.type,
    })
    return NextResponse.json({ result: result.text })
  } catch (error) {
    if (error instanceof AiError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    return toErrorResponse(error)
  }
}
