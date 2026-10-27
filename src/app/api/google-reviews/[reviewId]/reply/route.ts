import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { updateGoogleReply } from '@/lib/google/business-profile'

export async function PUT(request: Request, context: { params: Promise<{ reviewId: string }> }) {
  try { const { accountId } = await requireRole('agent'); const { reviewId } = await context.params; const body = await request.json().catch(() => null); const comment = typeof body?.comment === 'string' ? body.comment.trim() : ''; if (!comment || comment.length > 4096) return NextResponse.json({ error: 'comment_invalid' }, { status: 400 }); return NextResponse.json({ reply: await updateGoogleReply(accountId, reviewId, comment) }) } catch (error) { return toErrorResponse(error) }
}
