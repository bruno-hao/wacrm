'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
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
import { GatedButton } from '@/components/ui/gated-button';
import { useCan } from '@/hooks/use-can';
import type { QuickReply } from '@/types';

type NoticeStatus = 'sending' | 'sent' | 'failed';
type Situation = 'nao_entregue' | 'entregue' | 'cancelada' | 'perda';
type SoldKey = 'sold' | 'not_sold';

interface Row {
  number: string;
  date: string;
  customer_name: string;
  seller: string;
  lab: string;
  has_phone: boolean;
  notices: { quick_reply_id: string; status: NoticeStatus }[];
}

const SITUATIONS: Situation[] = ['nao_entregue', 'entregue', 'cancelada', 'perda'];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** Today in the store's timezone (UTC-3), matching the server's default. */
const today = () => isoDay(new Date(Date.now() - 3 * 3_600_000));
const daysAgo = (n: number) => isoDay(new Date(Date.now() - 3 * 3_600_000 - n * 86_400_000));
const fmtDate = (iso: string) => iso.split('-').reverse().join('/');

function StatusIcon({ status, label }: { status?: NoticeStatus; label: string }) {
  if (status === 'sending') {
    return <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={label} />;
  }
  if (status === 'sent') {
    return <CheckCircle2 className="size-4 text-green-500" aria-label={label} />;
  }
  if (status === 'failed') {
    return <XCircle className="size-4 text-red-500" aria-label={label} />;
  }
  return null;
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

  // Delivery state per `${os}:${quickReply}` — survives reloads via the server.
  const [notices, setNotices] = useState<Record<string, NoticeStatus>>({});

  const [dialogOs, setDialogOs] = useState<Row | null>(null);
  const [replies, setReplies] = useState<QuickReply[] | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
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
        setError(data.error ?? 'unexpected');
        setRows([]);
        return;
      }
      setRows(data.items as Row[]);
      setPages(data.pages);
      setTotal(data.total);
      setNotices((prev) => {
        const next = { ...prev };
        for (const r of data.items as Row[]) {
          for (const n of r.notices) {
            const k = `${r.number}:${n.quick_reply_id}`;
            // A request in flight in this tab wins over the stored state.
            if (prev[k] !== 'sending') next[k] = n.status;
          }
        }
        return next;
      });
    } catch {
      if (mine === seq.current) setError('unexpected');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [from, to, debouncedQ, situations, sold, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDialog = async (row: Row) => {
    setDialogOs(row);
    setSendError(null);
    if (replies === null) {
      const res = await fetch('/api/quick-replies', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      setReplies(res.ok ? ((data.quick_replies as QuickReply[]) ?? []) : []);
    }
  };

  const sendReply = async (row: Row, reply: QuickReply) => {
    const key = `${row.number}:${reply.id}`;
    setSendError(null);
    setNotices((p) => ({ ...p, [key]: 'sending' }));
    try {
      const res = await fetch('/api/avisos/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          os_number: row.number,
          os_date: row.date,
          quick_reply_id: reply.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const status: NoticeStatus =
        data.status === 'sent' || data.status === 'sending' || data.status === 'failed'
          ? data.status
          : 'failed';
      setNotices((p) => ({ ...p, [key]: status }));
      if (status === 'failed') setSendError(data.error ?? 'send_failed');
    } catch {
      setNotices((p) => ({ ...p, [key]: 'failed' }));
      setSendError('send_failed');
    }
  };

  /** Icon shown beside the row's button: sending > failed > sent. */
  const rowStatus = (row: Row): NoticeStatus | undefined => {
    const all = Object.entries(notices)
      .filter(([k]) => k.startsWith(`${row.number}:`))
      .map(([, v]) => v);
    if (all.includes('sending')) return 'sending';
    if (all.includes('failed') && !all.includes('sent')) return 'failed';
    if (all.includes('sent')) return 'sent';
    return undefined;
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
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('soldGroup')}</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={sold.includes('sold')} onCheckedChange={() => toggleSold('sold')}>
              {t('sold_sold')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={sold.includes('not_sold')}
              onCheckedChange={() => toggleSold('not_sold')}
            >
              {t('sold_not_sold')}
            </DropdownMenuCheckboxItem>
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
              <TableHead>{t('colDate')}</TableHead>
              <TableHead>{t('colOs')}</TableHead>
              <TableHead>{t('colName')}</TableHead>
              <TableHead className="hidden md:table-cell">{t('colSeller')}</TableHead>
              <TableHead className="hidden lg:table-cell">{t('colLab')}</TableHead>
              <TableHead className="text-right">{t('colAction')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center">
                  <Loader2 className="mx-auto size-6 animate-spin text-primary" />
                </TableCell>
              </TableRow>
            ) : errorText ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-destructive">
                  {errorText}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  {t('noResults')}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.number} className="border-border">
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(r.date)}</TableCell>
                  <TableCell className="font-medium">{r.number}</TableCell>
                  <TableCell>{r.customer_name || '—'}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{r.seller || '—'}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{r.lab || '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center justify-end gap-2">
                      <StatusIcon status={rowStatus(r)} label={t('statusIcon')} />
                      <GatedButton
                        variant="outline"
                        size="sm"
                        canAct={canSend && r.has_phone}
                        gateReason={r.has_phone ? t('cannotSend') : t('noPhone')}
                        onClick={() => void openDialog(r)}
                      >
                        <MessageSquare className="mr-1.5 size-3.5" />
                        {t('sendMessage')}
                      </GatedButton>
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

      <Dialog open={!!dialogOs} onOpenChange={(open) => !open && setDialogOs(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('pickReply')}</DialogTitle>
            <DialogDescription>
              {dialogOs ? `${t('colOs')} ${dialogOs.number} · ${dialogOs.customer_name}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {replies === null ? (
              <div className="flex justify-center py-6">
                <Loader2 className="size-5 animate-spin text-primary" />
              </div>
            ) : replies.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('noQuickReplies')}</p>
            ) : (
              replies.map((reply) => {
                const status = dialogOs ? notices[`${dialogOs.number}:${reply.id}`] : undefined;
                return (
                  <button
                    key={reply.id}
                    type="button"
                    disabled={!dialogOs || status === 'sending' || status === 'sent'}
                    onClick={() => dialogOs && void sendReply(dialogOs, reply)}
                    className="flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{reply.title}</span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                        {reply.content_text ?? t('interactiveReply')}
                      </span>
                    </span>
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                      <StatusIcon status={status} label={t(`status_${status ?? 'sending'}` as never)} />
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {sendError && (
            <p className="text-xs text-destructive">
              {t(
                `sendErrors.${
                  ['already_sent','in_progress','os_not_found','no_phone','ssotica_unavailable','contact_failed','conversation_failed','quick_reply_not_found','bad_request'].includes(sendError)
                    ? sendError
                    : 'send_failed'
                }` as never,
              )}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
