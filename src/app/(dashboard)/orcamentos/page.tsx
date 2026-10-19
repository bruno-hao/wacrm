'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { firstName, formatQuoteNumber, titleCaseName } from '@/lib/orcamentos/format';

interface ActiveQuote {
  id: string;
  number: string;
  customerName: string;
  total: number;
  date: string | null;
  seller: string;
}

const money = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

export default function OrcamentosPage() {
  const t = useTranslations('Quotes');
  const [items, setItems] = useState<ActiveQuote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/orcamentos/ativos', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? 'unexpected');
          setItems([]);
          return;
        }
        setItems(data.items as ActiveQuote[]);
      } catch {
        if (!cancelled) {
          setError('unexpected');
          setItems([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const errorText = error
    ? t(
        (['not_configured', 'login_failed', 'captcha', 'network'].includes(error)
          ? `errors.${error}`
          : 'errors.unexpected') as never,
      )
    : null;

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="mt-6">
        <div>
          <label htmlFor="quote-list" className="mb-1.5 block text-sm font-medium text-foreground">
            {t('listLabel')}
          </label>
          {items === null ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" />
              {t('loading')}
            </div>
          ) : errorText ? (
            <p className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-destructive">
              {errorText}
            </p>
          ) : items.length === 0 ? (
            <p className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
              {t('empty')}
            </p>
          ) : (
            <select
              id="quote-list"
              value={quoteId}
              onChange={(e) => setQuoteId(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              <option value="">{t('quotePlaceholder')}</option>
              {items.map((q) => (
                <option key={q.id} value={q.id}>
                  {[
                    formatQuoteNumber(q.number),
                    q.customerName ? titleCaseName(q.customerName) : '—',
                    money(q.total),
                    fmtDate(q.date),
                    firstName(q.seller) || '—',
                  ].join(' - ')}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  );
}
