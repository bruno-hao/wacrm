'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/hooks/use-auth'
import { canEditSettings } from '@/lib/auth/roles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SettingsPanelHead } from './settings-panel-head'

export function CorreiosSettings() {
  const { accountRole } = useAuth()
  const canEdit = accountRole ? canEditSettings(accountRole) : false
  const t = useTranslations('Settings.correios')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/correios/config', { cache: 'no-store' })
        const data = await response.json()
        if (response.ok) { setConfigured(Boolean(data.configured)); setExpiresAt(data.token_expires_at ?? null) }
      } finally { setLoading(false) }
    })()
  }, [])

  async function save() {
    setSaving(true)
    try {
      const response = await fetch('/api/correios/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message ?? t('saveFailed'))
      setConfigured(true); setPassword(''); toast.success(t('saved'))
      const refreshed = await fetch('/api/correios/config', { cache: 'no-store' }).then((r) => r.json())
      setExpiresAt(refreshed.token_expires_at ?? null)
    } catch (error) { toast.error(error instanceof Error ? error.message : t('saveFailed')) } finally { setSaving(false) }
  }

  async function remove() {
    if (!window.confirm(t('removeConfirm'))) return
    setRemoving(true)
    try {
      const response = await fetch('/api/correios/config', { method: 'DELETE' })
      if (!response.ok) throw new Error(t('removeFailed'))
      setConfigured(false); setUsername(''); setPassword(''); setExpiresAt(null); toast.success(t('removed'))
    } catch (error) { toast.error(error instanceof Error ? error.message : t('removeFailed')) } finally { setRemoving(false) }
  }

  return <div className="space-y-6">
    <SettingsPanelHead title={t('title')} description={t('description')} />
    <Card>
      <CardHeader><CardTitle>{t('credentialsTitle')}</CardTitle><CardDescription>{t('credentialsDescription')}</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {loading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : <>
          <div><Label htmlFor="correios-username">{t('username')}</Label><Input id="correios-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={t('usernamePlaceholder')} disabled={!canEdit} autoComplete="username" /></div>
          <div><Label htmlFor="correios-password">{t('apiCode')}</Label><div className="relative"><Input id="correios-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={configured ? t('passwordPlaceholderSaved') : t('passwordPlaceholder')} disabled={!canEdit} autoComplete="new-password" className="pr-10" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label={showPassword ? t('hidePassword') : t('showPassword')}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></div>
          <p className="text-xs text-muted-foreground">{t('securityNotice')}</p>
          {configured && <p className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 className="size-4" />{t('connected')}{expiresAt ? ` · ${new Date(expiresAt).toLocaleString()}` : ''}</p>}
          <div className="flex flex-wrap gap-2"><Button type="button" onClick={() => void save()} disabled={!canEdit || saving || ((!username.trim() || !password) && !/^cws-[A-Za-z0-9_-]+$/.test(username.trim()) && !/^cws-[A-Za-z0-9_-]+$/.test(password.trim()))}>{saving && <Loader2 className="mr-2 size-4 animate-spin" />}{t('save')}</Button>{configured && <Button type="button" variant="outline" onClick={() => void remove()} disabled={!canEdit || removing}>{removing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Trash2 className="mr-2 size-4" />}{t('remove')}</Button>}</div>
        </>}
      </CardContent>
    </Card>
  </div>
}
