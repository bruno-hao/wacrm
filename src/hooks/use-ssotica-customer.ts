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
      /** ssOtica status: ABERTO, FECHADO, VENDIDO, VELADO, ENTREGUE, CANCELADO, PERDA. */
      os_status: string | null;
      os_stage: string | null;
      os_sold: boolean | null;
      receita_date: string | null;
      seller: string | null;
      sale_number: string | null;
      sale_date: string | null;
      sale_value: number | null;
      /** Link to the sale in ssOtica; null until the store code is set. */
      sale_url: string | null;
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

// ---- Conversation list: customer / new for many phones in one request ----

const batchCache = new Map<string, { at: number; status: 'customer' | 'new' }>();

/**
 * `customer` / `new` per phone for the visible conversations. Phones the
 * server cannot decide (not configured, first sync running) are absent.
 */
export function useSsoticaStatuses(phones: string[]): Record<string, 'customer' | 'new'> {
  const key = [...new Set(phones.filter(Boolean))].sort().join(',');
  const [state, setState] = useState<{ key: string; map: Record<string, 'customer' | 'new'> }>({
    key: '',
    map: {},
  });

  useEffect(() => {
    if (!key) return;
    const list = key.split(',');
    const fresh: Record<string, 'customer' | 'new'> = {};
    const missing: string[] = [];
    for (const p of list) {
      const hit = batchCache.get(p);
      if (hit && Date.now() - hit.at < TTL_MS) fresh[p] = hit.status;
      else missing.push(p);
    }
    let cancelled = false;
    if (!missing.length) {
      void Promise.resolve().then(() => !cancelled && setState({ key, map: fresh }));
      return () => {
        cancelled = true;
      };
    }
    fetch('/api/ssotica/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phones: missing }),
    })
      .then((r) => (r.ok ? r.json() : { status: {} }))
      .catch(() => ({ status: {} }))
      .then((d: { status?: Record<string, 'customer' | 'new'> }) => {
        const map = { ...fresh, ...(d.status ?? {}) };
        for (const [p, st] of Object.entries(d.status ?? {})) {
          batchCache.set(p, { at: Date.now(), status: st });
        }
        if (!cancelled) setState({ key, map });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state.key === key ? state.map : {};
}
