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


/** Contact-panel details, centred: label above value. */
export function SsoticaDetailList({ customer }: { customer: Customer }) {
  const t = useTranslations('Inbox.ssotica');
  // Sale number and value link to the sale in ssOtica (when the store
  // code is configured). The API gives no code for the OS page or the
  // prescription image, so those two stay plain text.
  const rows: { label: string; value: string; href: string | null }[] = [
    { label: t('osNumber'), value: customer.os_number ?? '—', href: null },
    { label: t('saleNumber'), value: customer.sale_number ?? '—', href: customer.sale_url },
    { label: t('valueBrl'), value: formatBrl(customer.sale_value), href: customer.sale_url },
    { label: t('receitaDate'), value: formatIsoDate(customer.os_date), href: null },
  ];
  return (
    <dl className="mt-3 space-y-2 text-center">
      {rows.map(({ label, value, href }) => (
        <div key={label}>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </dt>
          <dd className="text-sm font-medium text-foreground">
            {href && value !== '—' ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
              >
                {value}
              </a>
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
