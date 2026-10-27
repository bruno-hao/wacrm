import { NextResponse } from 'next/server'
import { getCurrentAccount } from '@/lib/auth/account'
import { CorreiosTrackingError, trackCorreiosObject } from '@/lib/correios/rastro'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { accountId } = await getCurrentAccount()
    const code = new URL(request.url).searchParams.get('codigo')
    const result = await trackCorreiosObject(code, accountId)
    return NextResponse.json({ result })
  } catch (error) {
    if (error instanceof CorreiosTrackingError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'unexpected', message: 'Não foi possível consultar o rastreio.' }, { status: 500 })
  }
}
