'use client';

// ============================================================
// SsoticaSettings — Settings → ssOtica
//
// Credentials for the ssOtica "API Consultiva": the access key and the
// store CNPJ. Save stays disabled until "Test key" has passed for the
// exact values currently in the form; editing either field invalidates
// the test. The server repeats the test on save (see
// /api/ssotica/config), so this gate cannot be bypassed from the UI.
// The key is encrypted at rest and never sent back to the browser.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Glasses,
  Loader2,
  Trash2,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

const MASKED_KEY = '••••••••••••••••';

/** 00.000.000/0000-00 as the user types. */
function maskCnpj(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

export function SsoticaSettings() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.ssotica');

  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [cnpj, setCnpj] = useState('');
  // Fingerprint of the credentials that passed "Test key". Save is
  // enabled only while it equals the current form values.
  const [testedFor, setTestedFor] = useState<string | null>(null);

  const loadedAccountIdRef = useRef<string | null>(null);

  const fingerprint = (key: string, c: string) =>
    `${key}|${c.replace(/\D/g, '')}`;
  const currentFingerprint = fingerprint(keyEdited ? apiKey.trim() : '', cnpj);
  const testPassed = testedFor !== null && testedFor === currentFingerprint;

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ssotica/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('loadFailed'));
        return;
      }
      if (data.configured) {
        setConfigured(true);
        setCnpj(maskCnpj(data.cnpj ?? ''));
        setVerifiedAt(data.verified_at ?? null);
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
  }, [accountId, fetchConfig]);

  const canTest =
    cnpj.replace(/\D/g, '').length === 14 && (keyEdited ? !!apiKey.trim() : configured);

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/ssotica/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cnpj,
          api_key: keyEdited ? apiKey.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTestedFor(currentFingerprint);
        toast.success(t('testSuccess'));
      } else {
        setTestedFor(null);
        toast.error(data.error ?? t('testRejected'));
      }
    } catch {
      setTestedFor(null);
      toast.error(t('testNetworkError'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/ssotica/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cnpj,
          api_key: keyEdited ? apiKey.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(t('saveSuccess'));
        setTestedFor(null);
        await fetchConfig();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch('/api/ssotica/config', { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setConfigured(false);
        setVerifiedAt(null);
        setApiKey('');
        setKeyEdited(false);
        setCnpj('');
        setTestedFor(null);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  const disabled = !canEdit || saving || testing;

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
            <Glasses className="size-4 text-primary" /> {t('credentials')}
            {configured && verifiedAt && (
              <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-primary" />
                {t('connectedAt', {
                  date: new Date(verifiedAt).toLocaleString(),
                })}
              </span>
            )}
          </CardTitle>
          <CardDescription>{t('encryptionNotice')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ssotica-key">{t('apiKey')}</Label>
            <div className="relative">
              <Input
                id="ssotica-key"
                type={showKey && keyEdited ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setKeyEdited(true);
                }}
                onFocus={() => {
                  if (!keyEdited && apiKey === MASKED_KEY) {
                    setApiKey('');
                    setKeyEdited(true);
                  }
                }}
                placeholder={t('apiKeyPlaceholder')}
                disabled={disabled}
                autoComplete="off"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label={showKey ? t('hideKey') : t('showKey')}
                tabIndex={-1}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{t('apiKeyHint')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ssotica-cnpj">{t('cnpj')}</Label>
            <Input
              id="ssotica-cnpj"
              value={cnpj}
              onChange={(e) => setCnpj(maskCnpj(e.target.value))}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
              disabled={disabled}
              autoComplete="off"
              className="max-w-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={disabled || !canTest}
            >
              {testing && <Loader2 className="mr-2 size-4 animate-spin" />}
              {t('testKey')}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={disabled || !testPassed}
            >
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {t('save')}
            </Button>
            {testPassed && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-primary" /> {t('testPassedHint')}
              </span>
            )}
            {configured && canEdit && (
              <Button
                type="button"
                variant="ghost"
                className="ml-auto text-destructive"
                onClick={handleRemove}
                disabled={removing || saving}
              >
                {removing ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 size-4" />
                )}
                {t('remove')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
