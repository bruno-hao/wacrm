'use client';

import { useEffect, useState } from 'react';
import { WhatsAppConfig } from './whatsapp-config';
import { WahaConfig } from './waha-config';

type Provider = 'meta' | 'waha';

/**
 * Settings → WhatsApp. The account connects its number through ONE of two
 * providers: the official Meta Cloud API, or a WAHA server. The toggle only
 * changes which form is shown; saving either form switches the account to
 * that provider (the other provider's stored settings are replaced).
 */
export function WhatsAppProviderSettings() {
  const [provider, setProvider] = useState<Provider | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/whatsapp/waha/config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { configured?: boolean }) => {
        if (!cancelled) setProvider(d.configured ? 'waha' : 'meta');
      })
      .catch(() => {
        if (!cancelled) setProvider('meta');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!provider) return null;

  const tab = (value: Provider, label: string, hint: string) => (
    <button
      type="button"
      onClick={() => setProvider(value)}
      className={`flex-1 rounded-md border px-4 py-3 text-left transition ${
        provider === value
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border text-muted-foreground hover:bg-muted'
      }`}
      aria-pressed={provider === value}
    >
      <div className="text-sm font-medium">{label}</div>
      <div className="text-xs">{hint}</div>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        {tab('meta', 'API oficial da Meta', 'WhatsApp Business Cloud API, com templates')}
        {tab('waha', 'WAHA', 'Número comum via QR code (WhatsApp Web)')}
      </div>
      {provider === 'meta' ? <WhatsAppConfig /> : <WahaConfig />}
    </div>
  );
}
