'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Link as LinkIcon, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { extractFirstUrl } from '@/lib/links/preview'

interface Preview { url: string; title?: string; description?: string; image?: string }

export function LinkPreview({ text }: { text: string | null | undefined }) {
  const t = useTranslations('Inbox.bubble')
  const url = extractFirstUrl(text)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(Boolean(url))

  useEffect(() => {
    if (!url) {
      // The empty URL is an external-input reset, not a render-loop update.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview(null)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (!cancelled) setPreview(data?.preview ?? null) })
      .catch(() => { if (!cancelled) setPreview(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [url])

  if (!url || (!loading && !preview)) return null
  if (loading) return <span className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> {t('linkPreviewLoading')}</span>
  return <a href={preview?.url ?? url} target="_blank" rel="noopener noreferrer" className="mt-2 block max-w-sm overflow-hidden rounded-lg border border-border bg-background/60 text-left hover:bg-background/80">
    {preview?.image && <img src={preview.image} alt="" className="h-28 w-full object-cover" loading="lazy" />}
    <span className="flex gap-2 p-2"><LinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span className="min-w-0"><span className="block truncate text-xs font-medium">{preview?.title ?? url}</span>{preview?.description && <span className="mt-0.5 block line-clamp-2 text-[11px] text-muted-foreground">{preview.description}</span>}<ExternalLink className="mt-1 h-3 w-3 text-muted-foreground" /></span></span>
  </a>
}
