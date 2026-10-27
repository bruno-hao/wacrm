"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import { cleanContactName, displayContactHandle } from "@/lib/whatsapp/wa-identity";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const MAX_TARGETS = 10;

interface ForwardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageIds: string[];
  /** Called after a successful forward so the thread can leave selection mode. */
  onForwarded: () => void;
}

/** "Encaminhar mensagens para": recent conversations, multi-select, send. */
export function ForwardDialog({
  open,
  onOpenChange,
  messageIds,
  onForwarded,
}: ForwardDialogProps) {
  const t = useTranslations("Inbox.selection");
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setChosen([]);
    let cancelled = false;
    void (async () => {
      const { data } = await createClient()
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (cancelled) return;
      const all = normalizeConversations((data ?? []) as never);
      // Instagram threads only take replies inside the window: not a forward target.
      setConversations(all.filter((c) => (c.channel ?? "whatsapp") === "whatsapp"));
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const nameOf = (c: Conversation) =>
    cleanContactName(c.contact?.name) || displayContactHandle(c.contact ?? {}) || t("unknown");

  const initialsOf = (c: Conversation) =>
    nameOf(c)
      .replace(/[^\p{L}\p{N} ]/gu, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!conversations) return [];
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        nameOf(c).toLowerCase().includes(q) ||
        (c.contact?.phone ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "") || "\u0000"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, query]);

  const toggle = (id: string) =>
    setChosen((cur) =>
      cur.includes(id)
        ? cur.filter((x) => x !== id)
        : cur.length >= MAX_TARGETS
          ? cur
          : [...cur, id],
    );

  const send = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/whatsapp/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_ids: messageIds, conversation_ids: chosen }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(t("forwardFailed"));
        return;
      }
      if (data.sent > 0) {
        toast.success(t("forwarded", { sent: data.sent }));
        if (data.skipped > 0) toast.message(t("skipped", { count: data.skipped }));
        onOpenChange(false);
        onForwarded();
      } else {
        toast.error(data.skipped > 0 ? t("onlyMedia") : t("forwardFailed"));
      }
    } catch {
      toast.error(t("forwardFailed"));
    } finally {
      setSending(false);
    }
  };

  const chosenNames = (conversations ?? [])
    .filter((c) => chosen.includes(c.id))
    .map(nameOf)
    .join(", ");

  return (
    <Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("forwardTitle")}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search")}
            className="pl-9"
            autoFocus
          />
        </div>
        <div className="min-h-[200px] flex-1 overflow-y-auto">
          {conversations === null ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("noContacts")}</p>
          ) : (
            <>
              <p className="px-1 pb-1 text-xs text-muted-foreground">{t("recent")}</p>
              {filtered.map((c) => {
                const on = chosen.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded border",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground",
                      )}
                    >
                      {on && <Check className="size-3.5" />}
                    </span>
                    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium text-foreground">
                      {c.contact?.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.contact.avatar_url}
                          alt={nameOf(c)}
                          className="size-10 rounded-full object-cover"
                        />
                      ) : (
                        initialsOf(c)
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {nameOf(c)}
                      </span>
                      {c.contact?.phone ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.contact.phone}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
        {chosen.length > 0 && (
          <div className="flex items-center gap-3 border-t border-border pt-3">
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {chosenNames}
            </span>
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending}
              aria-label={t("forward")}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-60"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
