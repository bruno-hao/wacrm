'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquare,
  Search,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCan } from '@/hooks/use-can';
import type { QuickReply } from '@/types';

export type NoticeModule = 'avisos' | 'posvenda' | 'receitas' | 'aniversario';

type NoticeStatus = 'queued' | 'sending' | 'sent' | 'failed';
type Situation = 'nao_entregue' | 'entregue' | 'cancelada' | 'perda';
type SoldKey = 'sold' | 'not_sold';
type Period = 'this_month' | 'last_month' | 'last_3' | 'last_6';

interface Notice {
  standard_message_id?: string | null;
  status: NoticeStatus;
  updated_at: string;
  error?: string | null;
}
interface Row {
  /** Selection / queue key: the O.S. number, or "<customer>-<year>" for birthdays. */
  ref: string;
  number: string;
  date: string;
  customer_name: string;
  seller: string;
  lab: string;
  has_phone: boolean;
  /** Prescription expiry (receitas) or birth date (aniversario), yyyy-mm-dd. */
  extra?: string | null;
  /** receitas: the customer's newer O.S. number in the last 2 months, if any. */
  recent_os?: string | null;
  /** aniversario: customer since (yyyy-mm-dd). */
  since?: string | null;
  notices: Notice[];
}
/** Something the user can send: a quick reply (Avisos) or a standard message. */
interface Choice {
  id: string;
  title: string;
  text: string | null;
}

const SITUATIONS: Situation[] = ['nao_entregue', 'entregue', 'cancelada', 'perda'];
const PERIODS: Period[] = ['this_month', 'last_month', 'last_3', 'last_6'];
const POLL_MS = 3000;
/** The four after-sales messages, one table column each. */
const POST_KEYS = ['adaptacao', 'limpeza', 'plaqueta', 'preventiva'] as const;
type PostKey = (typeof POST_KEYS)[number];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** Today in the store's timezone (UTC-3), matching the server's default. */
const today = () => isoDay(new Date(Date.now() - 3 * 3_600_000));
const daysAgo = (n: number) => isoDay(new Date(Date.now() - 3 * 3_600_000 - n * 86_400_000));
const fmtDate = (iso: string) => iso.split('-').reverse().join('/');
/** Age the customer turns this year. */
const ageOf = (birth: string) => Number(today().slice(0, 4)) - Number(birth.slice(0, 4));

/** WhatsApp's "typing…" indicator: three bouncing dots. */
function TypingDots({ label }: { label: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-1"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

function StatusIcon({ notice, labels }: { notice?: Notice; labels: Record<NoticeStatus, string> }) {
  if (!notice) return null;
  if (notice.status === 'queued' || notice.status === 'sending') {
    return <TypingDots label={labels[notice.status]} />;
  }
  if (notice.status === 'sent') {
    return <CheckCircle2 className="size-4 text-green-500" aria-label={labels.sent} />;
  }
  return (
    <span title={notice.error ? `${labels.failed}: ${notice.error}` : labels.failed}>
      <XCircle className="size-4 text-red-500" aria-label={labels.failed} />
    </span>
  );
}

/**
 * One ZapÓtica list: the O.S. / customers of a module, selectable by
 * clicking the row, with a queued WhatsApp send for the selection.
 */
export function NoticesPanel({ module }: { module: NoticeModule }) {
  const t = useTranslations('Announcements');
  const canSend = useCan('send-messages');

  const isAvisos = module === 'avisos';
  const hasDates = module === 'avisos' || module === 'posvenda';

  // Filters — defaults: last 60 days, "Não entregue" + "Vendida".
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [from, setFrom] = useState(() => daysAgo(60));
  const [to, setTo] = useState(() => today());
  const [situations, setSituations] = useState<Situation[]>(['nao_entregue']);
  const [sold, setSold] = useState<SoldKey[]>(['sold']);
  const [period, setPeriod] = useState<Period>('last_3');
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<Row[]>([]);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected rows (ref → date); survives paging and filter changes.
  const [selected, setSelected] = useState<Record<string, string>>({});

  // Send dialog: pick a message, then confirm.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [chosen, setChosen] = useState<Choice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Pós-Venda: the standard message behind each category column.
  const [post, setPost] = useState<Partial<Record<PostKey, Choice>>>({});

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    if (module !== 'posvenda') return;
    void (async () => {
      try {
        const res = await fetch('/api/standard-messages?category=posvenda', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        const next: Partial<Record<PostKey, Choice>> = {};
        const list =
          (data.messages as { id: string; key: string | null; title: string; content_text: string }[]) ?? [];
        for (const m of list) {
          if (m.key && (POST_KEYS as readonly string[]).includes(m.key)) {
            next[m.key as PostKey] = { id: m.id, title: m.title, text: m.content_text };
          }
        }
        setPost(next);
      } catch {
        /* the category buttons stay disabled */
      }
    })();
  }, [module]);

  const seq = useRef(0);
  const load = useCallback(
    async (silent = false) => {
      const mine = ++seq.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      const params = new URLSearchParams({ q: debouncedQ, page: String(page) });
      if (module === 'avisos') {
        params.set('from', from);
        params.set('to', to);
        params.set('situations', situations.join(','));
        params.set('sold', sold.join(','));
      } else if (module === 'posvenda') {
        params.set('module', 'posvenda');
        params.set('from', from);
        params.set('to', to);
      } else if (module === 'receitas') {
        params.set('module', 'receitas');
        params.set('period', period);
      }
      const url = module === 'aniversario' ? '/api/avisos/birthdays' : '/api/avisos/os';
      try {
        const res = await fetch(`${url}?${params}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (mine !== seq.current) return;
        if (!res.ok) {
          if (!silent) {
            setError(data.error ?? 'unexpected');
            setRows([]);
          }
          return;
        }
        setRows(data.items as Row[]);
        setPages(data.pages);
        setTotal(data.total);
        setError(null);
      } catch {
        if (mine === seq.current && !silent) setError('unexpected');
      } finally {
        if (mine === seq.current && !silent) setLoading(false);
      }
    },
    [module, from, to, debouncedQ, situations, sold, period, page],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // While notices are queued / being sent, follow their status.
  const hasPending = rows.some((r) =>
    r.notices.some((n) => n.status === 'queued' || n.status === 'sending'),
  );
  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(id);
  }, [hasPending, load]);

  /** The row's most recent notice drives the icon beside it. */
  const latestNotice = (row: Row): Notice | undefined =>
    [...row.notices].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

  const labels: Record<NoticeStatus, string> = {
    queued: t('status_queued'),
    sending: t('status_sending'),
    sent: t('status_sent'),
    failed: t('status_failed'),
  };

  // ---------------- selection ----------------
  // Click anywhere on a row to select / unselect it. The selection is kept
  // while filters, search and pages change, until "Limpar seleção" is used.
  const selectedCount = Object.keys(selected).length;

  const toggleRow = (r: Row) => {
    if (!r.has_phone) return;
    setSelected((cur) => {
      const next = { ...cur };
      if (r.ref in next) delete next[r.ref];
      else next[r.ref] = r.date;
      return next;
    });
  };

  // ---------------- sending ----------------
  const openDialog = async () => {
    setChosen(null);
    setConfirming(false);
    setDialogOpen(true);
    if (choices !== null) return;
    try {
      if (isAvisos) {
        const res = await fetch('/api/quick-replies', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        const list = res.ok ? ((data.quick_replies as QuickReply[]) ?? []) : [];
        setChoices(
          list.map((r) => ({
            id: r.id,
            title: r.title,
            text: r.content_text ?? t('interactiveReply'),
          })),
        );
      } else {
        const res = await fetch(`/api/standard-messages?category=${module}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        const list = res.ok
          ? ((data.messages as { id: string; title: string; content_text: string }[]) ?? [])
          : [];
        setChoices(list.map((m) => ({ id: m.id, title: m.title, text: m.content_text })));
      }
    } catch {
      setChoices([]);
    }
  };

  /** Pós-Venda: confirm one category's message for the selected rows. */
  const openCategory = (key: PostKey) => {
    const msg = post[key];
    if (!msg) return;
    setChosen(msg);
    setConfirming(true);
    setDialogOpen(true);
  };

  const categoryNotice = (row: Row, messageId: string): Notice | undefined =>
    row.notices
      .filter((n) => n.standard_message_id === messageId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

  const submit = async () => {
    if (!chosen) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/avisos/send-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module,
          ...(isAvisos ? { quick_reply_id: chosen.id } : { standard_message_id: chosen.id }),
          items: Object.entries(selected).map(([os_number, os_date]) => ({ os_number, os_date })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const known = ['too_many', 'quick_reply_not_found', 'bad_request'];
        toast.error(t(`batchErrors.${known.includes(data.error) ? data.error : 'generic'}` as never));
        return;
      }
      toast.success(t('queuedToast', { queued: data.queued, skipped: data.skipped }));
      setDialogOpen(false);
      await load(true);
    } catch {
      toast.error(t('batchErrors.generic'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSituation = (s: Situation) => {
    setSituations((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
    setPage(1);
  };
  const toggleSold = (s: SoldKey) => {
    setSold((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
    setPage(1);
  };

  const filterCount = situations.length + sold.length;
  const errorText = useMemo(() => {
    if (!error) return null;
    const known = ['not_configured', 'invalid_key', 'network', 'range_too_long', 'invalid_range'];
    return t(`errors.${known.includes(error) ? error : 'unexpected'}` as never) as string;
  }, [error, t]);

  const colCount = { avisos: 7, posvenda: 9, receitas: 8, aniversario: 6 }[module];

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">{t(`tab_${module}` as never)}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{t(`desc_${module}` as never)}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-9"
          />
        </div>

        {isAvisos && (
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-muted">
              {t('statusFilter')}
              {filterCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {filterCount}
                </span>
              )}
              <ChevronDown className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 border-border bg-popover">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t('situationGroup')}</DropdownMenuLabel>
                {SITUATIONS.map((s) => (
                  <DropdownMenuCheckboxItem
                    key={s}
                    checked={situations.includes(s)}
                    onCheckedChange={() => toggleSituation(s)}
                  >
                    {t(`sit_${s}` as never)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t('soldGroup')}</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={sold.includes('sold')}
                  onCheckedChange={() => toggleSold('sold')}
                >
                  {t('sold_sold')}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={sold.includes('not_sold')}
                  onCheckedChange={() => toggleSold('not_sold')}
                >
                  {t('sold_not_sold')}
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {module === 'receitas' && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t('periodLabel')}
            <select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value as Period);
                setPage(1);
              }}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {t(`period_${p}` as never)}
                </option>
              ))}
            </select>
          </label>
        )}

        {hasDates && (
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              {t('from')}
              <Input
                type="date"
                value={from}
                max={to}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
                className="w-40"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              {t('to')}
              <Input
                type="date"
                value={to}
                min={from}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
                className="w-40"
              />
            </label>
          </>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead>{t('colDate')}</TableHead>
              {module !== 'aniversario' && <TableHead>{t('colOs')}</TableHead>}
              <TableHead>{t('colName')}</TableHead>
              <TableHead className="hidden lg:table-cell">{t('colSeller')}</TableHead>
              {module !== 'aniversario' && (
                <TableHead className="hidden xl:table-cell">{t('colLab')}</TableHead>
              )}
              {module === 'avisos' && (
                <TableHead className="whitespace-nowrap text-center">{t('colReady')}</TableHead>
              )}
              {module === 'receitas' && (
                <>
                  <TableHead className="whitespace-nowrap">{t('colExpiry')}</TableHead>
                  <TableHead className="whitespace-nowrap">{t('colRecentOs')}</TableHead>
                </>
              )}
              {module === 'aniversario' && (
                <>
                  <TableHead className="whitespace-nowrap">{t('colSince')}</TableHead>
                  <TableHead className="whitespace-nowrap">{t('colBirthday')}</TableHead>
                </>
              )}
              {module === 'posvenda' ? (
                POST_KEYS.map((k) => (
                  <TableHead key={k} className="text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="whitespace-nowrap">{t(`cat_${k}` as never)}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canSend || selectedCount === 0 || !post[k]}
                        title={canSend ? undefined : t('cannotSend')}
                        onClick={() => openCategory(k)}
                      >
                        <MessageSquare className="mr-1 size-3.5" />
                        {t('send')}
                        {selectedCount > 0 && ` (${selectedCount})`}
                      </Button>
                    </div>
                  </TableHead>
                ))
              ) : (
                <TableHead>
                  <div className="flex items-center justify-end">
                    <Button
                      size="sm"
                      disabled={!canSend || selectedCount === 0}
                      title={canSend ? undefined : t('cannotSend')}
                      onClick={() => void openDialog()}
                    >
                      <MessageSquare className="mr-1.5 size-3.5" />
                      {t('sendMessage')}
                      {selectedCount > 0 && ` (${selectedCount})`}
                    </Button>
                  </div>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-12 text-center">
                  <Loader2 className="mx-auto size-6 animate-spin text-primary" />
                </TableCell>
              </TableRow>
            ) : errorText ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-12 text-center text-sm text-destructive">
                  {errorText}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-12 text-center text-sm text-muted-foreground">
                  {t('noResults')}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.ref}
                  role="row"
                  tabIndex={r.has_phone ? 0 : -1}
                  aria-selected={r.ref in selected}
                  title={r.has_phone ? undefined : t('noPhone')}
                  onClick={() => toggleRow(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleRow(r);
                    }
                  }}
                  className={`border-border select-none ${
                    r.has_phone ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                  } ${
                    r.ref in selected
                      ? 'bg-primary/10 shadow-[inset_3px_0_0_var(--color-primary)] hover:bg-primary/15'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(r.date)}</TableCell>
                  {module !== 'aniversario' && <TableCell className="font-medium">{r.number || '—'}</TableCell>}
                  <TableCell>{r.customer_name || '—'}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{r.seller || '—'}</TableCell>
                  {module !== 'aniversario' && (
                    <TableCell className="hidden text-muted-foreground xl:table-cell">
                      {(module === 'posvenda' ? r.lab.split(/\s+/)[0] : r.lab) || '—'}
                    </TableCell>
                  )}
                  {module === 'avisos' && (
                    <TableCell className="text-center">
                      {r.notices.some((n) => n.status === 'sent') ? (
                        <CheckCircle2 className="mx-auto size-4 text-green-500" aria-label={labels.sent} />
                      ) : null}
                    </TableCell>
                  )}
                  {module === 'receitas' && (
                    <>
                      <TableCell className="whitespace-nowrap">{r.extra ? fmtDate(r.extra) : '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.recent_os ? t('recentYes', { number: r.recent_os }) : t('recentNo')}
                      </TableCell>
                    </>
                  )}
                  {module === 'aniversario' && (
                    <>
                      <TableCell className="whitespace-nowrap">{r.since ? fmtDate(r.since) : '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.extra ? `${fmtDate(r.extra)} (${t('ageYears', { age: ageOf(r.extra) })})` : '—'}
                      </TableCell>
                    </>
                  )}
                  {module === 'posvenda' ? (
                    POST_KEYS.map((k) => (
                      <TableCell key={k} className="text-center">
                        <div className="flex min-h-6 items-center justify-center">
                          <StatusIcon notice={post[k] ? categoryNotice(r, post[k]!.id) : undefined} labels={labels} />
                        </div>
                      </TableCell>
                    ))
                  ) : (
                    <TableCell className="text-right">
                      <div className="flex min-h-6 items-center justify-end">
                        <StatusIcon notice={latestNotice(r)} labels={labels} />
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            {selectedCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => setSelected({})}>
                {t('clearSelection')}
              </Button>
            )}
            <span>
              {t('showing', { total })}
              {selectedCount > 0 && (
                <span className="font-medium text-foreground">
                  {' · '}
                  {t('selectedCount', { count: selectedCount })}
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span>{t('pageOf', { page, pages })}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => !submitting && setDialogOpen(open)}>
        <DialogContent className="sm:max-w-[34rem]">
          {!confirming ? (
            <>
              <DialogHeader>
                <DialogTitle>{t('pickReply')}</DialogTitle>
                <DialogDescription>{t('pickReplyHint', { count: selectedCount })}</DialogDescription>
              </DialogHeader>
              <div className="max-h-[60vh] space-y-2 overflow-y-auto">
                {choices === null ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="size-5 animate-spin text-primary" />
                  </div>
                ) : choices.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {isAvisos ? t('noQuickReplies') : t('noStandardMessages')}
                  </p>
                ) : (
                  choices.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      onClick={() => setChosen(choice)}
                      className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted ${
                        chosen?.id === choice.id ? 'border-primary bg-primary/5' : 'border-border'
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">{choice.title}</span>
                        <span className="mt-0.5 line-clamp-3 block text-xs text-muted-foreground">
                          {choice.text}
                        </span>
                      </span>
                      {chosen?.id === choice.id && (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                      )}
                    </button>
                  ))
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button disabled={!chosen} onClick={() => setConfirming(true)}>
                  {t('send')}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t('confirmTitle')}</DialogTitle>
                <DialogDescription>
                  {t(isAvisos ? 'confirmBody' : 'confirmBodyGeneric', {
                    title: chosen?.title ?? '',
                    count: selectedCount,
                  })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" disabled={submitting} onClick={() => (module === 'posvenda' ? setDialogOpen(false) : setConfirming(false))}>
                  {t('back')}
                </Button>
                <Button disabled={submitting} onClick={() => void submit()}>
                  {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {t('confirm')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
