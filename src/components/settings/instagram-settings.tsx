'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Copy, Loader2, Trash2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChannelBadge } from '@/components/inbox/channel-badge';
import { SettingsPanelHead } from './settings-panel-head';

interface Status {
  configured: boolean;
  username: string | null;
  status: string | null;
  token_expires_at: string | null;
  env_ready: boolean;
  webhook_url: string;
  redirect_uri: string | null;
}

export function InstagramSettings() {
  const { accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.instagram');
  const params = useSearchParams();

  const [data, setData] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/instagram/config');
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Result of the OAuth round trip (?ig=connected | <error>).
  const igFlag = params.get('ig');
  useEffect(() => {
    if (!igFlag) return;
    if (igFlag === 'connected') toast.success(t('connectedToast'));
    else toast.error(t('connectFailed', { reason: igFlag }));
  }, [igFlag, t]);

  const connect = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/instagram/oauth/start');
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.url) window.location.href = body.url;
      else toast.error(body.error === 'instagram_not_configured' ? t('envMissing') : t('connectFailed', { reason: 'start' }));
    } catch {
      toast.error(t('connectFailed', { reason: 'start' }));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/instagram/config', { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('disconnected'));
        await load();
      } else toast.error(t('disconnectFailed'));
    } finally {
      setBusy(false);
    }
  };

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    toast.success(t('copied'));
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  const connected = data?.configured && data.status === 'connected';

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('adminOnly')}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ChannelBadge channel="instagram" iconOnly /> {t('account')}
            {connected && (
              <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-primary" /> {t('connected')}
              </span>
            )}
          </CardTitle>
          <CardDescription>{t('accountDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {data?.configured && (
            <>
              <p>
                <span className="text-muted-foreground">{t('profile')}: </span>
                <span className="font-medium">@{data.username ?? '—'}</span>
              </p>
              {data.token_expires_at && (
                <p>
                  <span className="text-muted-foreground">{t('tokenExpires')}: </span>
                  <span className="font-medium">
                    {new Date(data.token_expires_at).toLocaleDateString()}
                  </span>
                </p>
              )}
              {data.status === 'disconnected' && (
                <p className="text-destructive">{t('needsReconnect')}</p>
              )}
            </>
          )}
          {canEdit && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={connect} disabled={busy || !data?.env_ready}>
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                {connected ? t('reconnect') : t('connect')}
              </Button>
              {data?.configured && (
                <Button variant="ghost" className="text-destructive" onClick={disconnect} disabled={busy}>
                  <Trash2 className="mr-2 size-4" /> {t('disconnect')}
                </Button>
              )}
            </div>
          )}
          {!data?.env_ready && <p className="text-xs text-amber-500">{t('envMissing')}</p>}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">{t('metaSetup')}</CardTitle>
          <CardDescription>{t('metaSetupDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {[
            [t('webhookUrl'), data?.webhook_url],
            [t('redirectUri'), data?.redirect_uri],
          ].map(([label, value]) =>
            value ? (
              <div key={label}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <button
                  type="button"
                  onClick={() => copy(value)}
                  className="mt-0.5 flex w-full items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-left font-mono text-xs hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">{value}</span>
                  <Copy className="size-3.5 shrink-0" />
                </button>
              </div>
            ) : null,
          )}
        </CardContent>
      </Card>
    </div>
  );
}
