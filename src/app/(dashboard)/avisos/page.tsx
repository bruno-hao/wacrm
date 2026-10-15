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
  Megaphone,
  MessageSquare,
  Search,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

type NoticeStatus = 'queued' | 'sending' | 'sent' | 'failed';
type Situation = 'nao_entregue' | 'entregue' | 'cancelada' | 'perda';
type SoldKey = 'sold' | 'not_sold';

interface Notice {
  quick_reply_id: string;
  status: NoticeStatus;
  updated_at: string;
  error?: string | null;
}
interface Row {
  number: string;
  date: string;
  customer_name: string;
  seller: string;
  lab: string;
  has_phone: boolean;
  notices: Notice[];
}

const SITUATIONS: Situation[] = ['nao_entregue', 'entregue', 'cancelada', 'perda'];
const POLL_MS = 3000;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** Today in the store's timezone (UTC-3), matching the server's default. */
const today = () => isoDay(new Date(Date.now() - 3 * 3_600_000));
const daysAgo = (n: number) => isoDay(new Date(Date.now() - 3 * 3_600_000 - n * 86_400_000));
const fmtDate = (iso: string) => iso.split('-').reverse().join('/');

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

export default function AvisosPage() {
  const t = useTranslations('Announcements');
  const canSend = useCan('send-messages');

  // Filters — defaults: last 60 days, "Não entregue" + "Vendida".
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [from, setFrom] = useState(() => daysAgo(60));
  const [to, setTo] = useState(() => today());
  const [situations, setSituations] = useState<Situation[]>(['nao_entregue']);
  const [sold, setSold] = useState<SoldKey[]>(['sold']);
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<Row[]>([]);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected O.S. (number → date); survives paging and filter changes.
  const [selected, setSelected] = useState<Record<string, string>>({});

  // Send dialog: pick a quick reply, then confirm.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [replies, setReplies] = useState<QuickReply[] | null>(null);
  const [chosen, setChosen] = useState<QuickReply | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  const seq = useRef(0);
  const load = useCallback(
    async (silent = false) => {
      const mine = ++seq.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      const params = new URLSearchParams({
        from,
        to,
        q: debouncedQ,
        situations: situations.join(','),
        sold: sold.join(','),
        page: String(page),
      });
      try {
        const res = await fetch(`/api/avisos/os?${params}`, { cache: 'no-store' });
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
    [from, to, debouncedQ, situations, sold, page],
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
  const eligible = rows.filter((r) => r.has_phone);
  const allOnPage = eligible.length > 0 && eligible.every((r) => r.number in selected);
  const someOnPage = eligible.some((r) => r.number in selected);
  const selectedCount = Object.keys(selected).length;

  const toggleRow = (r: Row) =>
    setSelected((cur) => {
      const next = { ...cur };
      if (r.number in next) delete next[r.number];
      else next[r.number] = r.date;
      return next;
    });
  const togglePage = () =>
    setSelected((cur) => {
      const next = { ...cur };
      for (const r of eligible) {
        if (allOnPage) delete next[r.number];
        else next[r.number] = r.date;
      }
      return next;
    });

  // ---------------- sending ----------------
  const openDialog = async () => {
    setChosen(null);
    setConfirming(false);
    setDialogOpen(true);
    if (replies === null) {
      const res = await fetch('/api/quick-replies', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      setReplies(res.ok ? ((data.quick_replies as QuickReply[]) ?? []) : []);
    }
  };

  const submit = async () => {
    if (!chosen) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/avisos/send-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quick_reply_id: chosen.id,
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
      setSelected({});
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

  return (
    <div>
      <div className="flex items-center gap-2">
        <Megaphone className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-9"
          />
        </div>

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
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="w-10">
                <Checkbox
                  checked={allOnPage}
                  indeterminate={!allOnPage && someOnPage}
                  onCheckedChange={togglePage}
                  disabled={eligible.length === 0}
                  aria-label={t('selectPage')}
                />
              </TableHead>
              <TableHead>{t('colDate')}</TableHead>
              <TableHead>{t('colOs')}</TableHead>
              <TableHead>{t('colName')}</TableHead>
              <TableHead className="hidden md:table-cell">{t('colSeller')}</TableHead>
              <TableHead className="hidden lg:table-cell">{t('colLab')}</TableHead>
              <TableHead>
                <div className="flex items-center justify-end gap-3">
                  <span>{t('colAction')}</span>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center">
                  <Loader2 className="mx-auto size-6 animate-spin text-primary" />
                </TableCell>
              </TableRow>
            ) : errorText ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-sm text-destructive">
                  {errorText}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                  {t('noResults')}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.number} className="border-border">
                  <TableCell>
                    <Checkbox
                      checked={r.number in selected}
                      onCheckedChange={() => toggleRow(r)}
                      disabled={!r.has_phone}
                      title={r.has_phone ? undefined : t('noPhone')}
                      aria-label={t('selectRow', { number: r.number })}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(r.date)}</TableCell>
                  <TableCell className="font-medium">{r.number}</TableCell>
                  <TableCell>{r.customer_name || '—'}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{r.seller || '—'}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{r.lab || '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex min-h-6 items-center justify-end">
                      <StatusIcon notice={latestNotice(r)} labels={labels} />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
          <span>{t('showing', { total })}</span>
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

      {/* 20% wider than the previous popup (28rem → 34rem). */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !submitting && setDialogOpen(open)}>
        <DialogContent className="sm:max-w-[34rem]">
          {!confirming ? (
            <>
              <DialogHeader>
                <DialogTitle>{t('pickReply')}</DialogTitle>
                <DialogDescription>{t('pickReplyHint', { count: selectedCount })}</DialogDescription>
              </DialogHeader>
              <div className="max-h-[60vh] space-y-2 overflow-y-auto">
                {replies === null ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="size-5 animate-spin text-primary" />
                  </div>
                ) : replies.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">{t('noQuickReplies')}</p>
                ) : (
                  replies.map((reply) => (
                    <button
                      key={reply.id}
                      type="button"
                      onClick={() => setChosen(reply)}
                      className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted ${
                        chosen?.id === reply.id ? 'border-primary bg-primary/5' : 'border-border'
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">{reply.title}</span>
                        <span className="mt-0.5 line-clamp-3 block text-xs text-muted-foreground">
                          {reply.content_text ?? t('interactiveReply')}
                        </span>
                      </span>
                      {chosen?.id === reply.id && (
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
                  {t('confirmBody', { title: chosen?.title ?? '', count: selectedCount })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" disabled={submitting} onClick={() => setConfirming(false)}>
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
