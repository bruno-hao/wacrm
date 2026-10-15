'use client';

import { useEffect, useState } from 'react';

export type SsoticaLookup =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'new' }
  | {
      status: 'customer';
      name: string | null;
      os_number: string | null;
      os_date: string | null;
      receita_date: string | null;
      sale_number: string | null;
      sale_date: string | null;
      sale_value: number | null;
    };

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: SsoticaLookup }>();
const inflight = new Map<string, Promise<SsoticaLookup>>();

async function lookup(phone: string): Promise<SsoticaLookup> {
  const hit = cache.get(phone);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let p = inflight.get(phone);
  if (!p) {
    p = fetch(`/api/ssotica/customer?phone=${encodeURIComponent(phone)}`)
      .then((r) => (r.ok ? r.json() : { status: 'unavailable' }))
      .catch(() => ({ status: 'unavailable' }) as SsoticaLookup)
      .then((v: SsoticaLookup) => {
        cache.set(phone, { at: Date.now(), value: v });
        inflight.delete(phone);
        return v;
      });
    inflight.set(phone, p);
  }
  return p;
}

/**
 * Is this contact's phone a ssOtica customer (and their last OS / sale)?
 * Answered from the synced index; `unavailable` means "show nothing"
 * (ssOtica not configured, first sync still running, or no phone).
 */
export function useSsoticaCustomer(phone: string | null | undefined): SsoticaLookup {
  const key = phone?.trim() ?? '';
  const [state, setState] = useState<{ key: string; value: SsoticaLookup }>({
    key: '',
    value: { status: 'loading' },
  });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void lookup(key).then((value) => {
      if (!cancelled) setState({ key, value });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!key) return { status: 'unavailable' };
  return state.key === key ? state.value : { status: 'loading' };
}
