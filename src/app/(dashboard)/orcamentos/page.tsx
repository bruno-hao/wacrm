'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface ActiveQuote {
  id: string;
  number: string;
  customerName: string;
  total: number;
  date: string | null;
}

type LensModel = '' | 'one' | 'two_plus';

const money = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

export default function OrcamentosPage() {
  const t = useTranslations('Quotes');
  const [items, setItems] = useState<ActiveQuote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState('');
  const [model, setModel] = useState<LensModel>('');

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

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
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
              size={12}
              value={quoteId}
              onChange={(e) => setQuoteId(e.target.value)}
              className="w-full rounded-lg border border-border bg-card p-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {items.map((q) => (
                <option key={q.id} value={q.id} className="rounded px-2 py-1.5">
                  {`${q.number} - ${q.customerName || '—'} - ${money(q.total)} - ${fmtDate(q.date)}`}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label htmlFor="lens-model" className="mb-1.5 block text-sm font-medium text-foreground">
            {t('modelLabel')}
          </label>
          <select
            id="lens-model"
            value={model}
            onChange={(e) => setModel(e.target.value as LensModel)}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="">{t('modelPlaceholder')}</option>
            <option value="one">{t('modelOne')}</option>
            <option value="two_plus">{t('modelTwoPlus')}</option>
          </select>
        </div>
      </div>
    </div>
  );
}
