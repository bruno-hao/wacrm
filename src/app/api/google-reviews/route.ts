import { NextResponse } from 'next/server'
import { getCurrentAccount } from '@/lib/auth/account'
import { listGoogleReviews } from '@/lib/google/business-profile'

export async function GET() {
  try { const { accountId } = await getCurrentAccount(); return NextResponse.json(await listGoogleReviews(accountId)) } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível carregar as avaliações.' }, { status: 502 }) }
}
