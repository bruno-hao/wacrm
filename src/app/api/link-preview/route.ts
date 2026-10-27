import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import { extractFirstUrl, parseOpenGraph } from '@/lib/links/preview'

export async function GET(request: Request) {
  try {
    await requireRole('agent')
    const raw = new URL(request.url).searchParams.get('url')
    const url = extractFirstUrl(raw)
    if (!url || !(await isDeliverableUrl(url))) return NextResponse.json({ preview: null }, { status: 400 })
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { Accept: 'text/html,application/xhtml+xml' } })
    if (!response.ok) return NextResponse.json({ preview: null })
    const html = (await response.text()).slice(0, 512_000)
    const data = parseOpenGraph(html)
    return NextResponse.json({ preview: data.title || data.image || data.description ? { ...data, url } : null })
  } catch (error) {
    return toErrorResponse(error)
  }
}
