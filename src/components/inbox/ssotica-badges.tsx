'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { SsoticaLookup } from '@/hooks/use-ssotica-customer';

type Customer = Extract<SsoticaLookup, { status: 'customer' }>;

const BLUE = 'border-transparent bg-blue-500/15 text-blue-600 dark:text-blue-400';
const RED = 'border-transparent bg-red-500/15 text-red-600 dark:text-red-400';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBrl(value: number | null | undefined): string {
  return value == null ? '—' : brl.format(Number(value));
}

/** yyyy-mm-dd → dd/mm/yyyy */
export function formatIsoDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

function pill(className: string) {
  return cn(
    'inline-flex h-5 w-fit shrink-0 items-center rounded-full border px-2 text-[10px] font-medium whitespace-nowrap',
    className,
  );
}

/** "Cliente ssOtica" (blue) / "Cliente Novo" (red); nothing while unknown. */
export function SsoticaStatusBadge({
  lookup,
  className,
}: {
  lookup: SsoticaLookup;
  className?: string;
}) {
  const t = useTranslations('Inbox.ssotica');
  if (lookup.status === 'customer') {
    return <span className={cn(pill(BLUE), className)}>{t('customer')}</span>;
  }
  if (lookup.status === 'new') {
    return <span className={cn(pill(RED), className)}>{t('newCustomer')}</span>;
  }
  return null;
}

/** Header detail badge: OS / Última Venda / Valor Última Venda. */
export function SsoticaDetailBadge({
  customer,
  className,
}: {
  customer: Customer;
  className?: string;
}) {
  const t = useTranslations('Inbox.ssotica');
  return (
    <span className={cn(pill(BLUE), className)}>
      {t('os')}: {customer.os_number ?? '—'} / {t('lastSale')}:{' '}
      {customer.sale_number ?? '—'} / {t('lastSaleValue')}:{' '}
      {formatBrl(customer.sale_value)}
    </span>
  );
}

/** Contact-panel details: OS, Última Venda, Valor R$, Receita. */
export function SsoticaDetailList({ customer }: { customer: Customer }) {
  const t = useTranslations('Inbox.ssotica');
  const rows: [string, string][] = [
    [t('os'), customer.os_number ?? '—'],
    [t('lastSaleShort'), customer.sale_number ?? '—'],
    [t('valueBrl'), formatBrl(customer.sale_value)],
    [t('receita'), formatIsoDate(customer.receita_date)],
  ];
  return (
    <dl className="mt-2 space-y-0.5 text-left text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-1">
          <dt className="text-muted-foreground">{label}:</dt>
          <dd className="font-medium text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
