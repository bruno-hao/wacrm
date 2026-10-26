'use client'

import { useEffect, useState } from 'react'
import { Loader2, ScanSearch, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'

interface ReadRow { status: string; result_text?: string | null; error_code?: string | null }

export function PrescriptionReading({ messageId }: { messageId: string }) {
  const t = useTranslations('Inbox.bubble')
  const [read, setRead] = useState<ReadRow | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/ai/prescription-read?message_id=${encodeURIComponent(messageId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setRead(data?.read ?? null) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [messageId])

  const run = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/ai/prescription-read', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: messageId }),
      })
      const data = await res.json().catch(() => null)
      if (data?.read) setRead(data.read)
      else if (!res.ok) setRead({ status: 'failed', error_code: data?.error })
    } finally { setBusy(false) }
  }

  if (read?.status === 'completed' && read.result_text) {
    return <div className="border-border bg-muted/30 mt-2 rounded-md border p-2 text-xs">
      <p className="mb-1 flex items-center gap-1 font-medium"><ScanSearch className="h-3 w-3" /> {t('prescriptionTitle')}</p>
      <p className="whitespace-pre-wrap">{read.result_text}</p>
    </div>
  }
  if (read?.status === 'processing' || busy) {
    return <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs"><Loader2 className="h-3 w-3 animate-spin" /> {t('prescriptionReading')}</p>
  }
  return <Button type="button" variant="ghost" size="sm" className="mt-1 h-7 px-1.5 text-xs" onClick={run}>
    {read?.status === 'failed' ? <RefreshCw className="mr-1 h-3 w-3" /> : <ScanSearch className="mr-1 h-3 w-3" />}
    {read?.status === 'failed' ? t('prescriptionRetry') : t('prescriptionRead')}
  </Button>
}
