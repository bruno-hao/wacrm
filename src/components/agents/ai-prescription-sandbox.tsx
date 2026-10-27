'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Loader2, RotateCcw, ScanSearch, Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function AiPrescriptionSandbox({ onGoToSetup }: { onGoToSetup?: () => void }) {
  const t = useTranslations('Agents.recipeSandbox')
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const reset = () => { setFile(null); setResult(''); if (inputRef.current) inputRef.current.value = '' }

  const run = async () => {
    if (!file || busy) return
    setBusy(true)
    setResult('')
    try {
      const body = new FormData()
      body.append('image', file)
      const response = await fetch('/api/ai/prescription-sandbox', { method: 'POST', body })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) { toast.error(data.error ?? t('failed')); return }
      setResult(typeof data.result === 'string' ? data.result : '')
    } catch { toast.error(t('unreachable')) } finally { setBusy(false) }
  }

  return <div className="flex min-h-[420px] flex-col rounded-xl border border-border bg-card">
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <div className="flex items-center gap-2"><ScanSearch className="h-4 w-4 text-primary" /><span className="text-sm font-medium">{t('title')}</span></div>
      <Button variant="ghost" size="sm" onClick={reset} disabled={busy || (!file && !result)}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />{t('reset')}</Button>
    </div>
    <div className="flex-1 space-y-4 p-4">
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      {onGoToSetup && <Button variant="link" size="sm" onClick={onGoToSetup} className="h-auto p-0 text-xs">{t('goToSetup')} <ArrowRight className="ml-1 h-3 w-3" /></Button>}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setResult('') }} />
      {!file && <Button variant="outline" onClick={() => inputRef.current?.click()}><Upload className="mr-2 h-4 w-4" />{t('chooseImage')}</Button>}
      {previewUrl && <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2"><img src={previewUrl} alt={t('previewAlt')} className="max-h-80 w-full rounded-lg border border-border object-contain" /><Button onClick={() => void run()} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-2 h-4 w-4" />}{busy ? t('reading') : t('read')}</Button></div>
        <div className="min-h-40 rounded-lg border border-border bg-muted/30 p-3 text-sm">{result ? <p className="whitespace-pre-wrap">{result}</p> : <p className="text-muted-foreground">{t('emptyResult')}</p>}</div>
      </div>}
    </div>
  </div>
}
