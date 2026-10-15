'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCan } from '@/hooks/use-can';
import { SettingsPanelHead } from './settings-panel-head';

type Category = 'posvenda' | 'receitas' | 'aniversario';
const CATEGORIES: Category[] = ['posvenda', 'receitas', 'aniversario'];

interface StandardMessage {
  id: string;
  category: Category;
  title: string;
  content_text: string;
}
interface Draft {
  id?: string;
  category: Category;
  title: string;
  content_text: string;
}

/** Settings → Mensagens Padrão: the texts the ZapÓtica modules send. */
export function StandardMessagesManager() {
  const t = useTranslations('Settings.standardMessages');
  const canEdit = useCan('edit-settings');
  const [items, setItems] = useState<StandardMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/standard-messages', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setItems((data.messages as StandardMessage[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim() || !draft.content_text.trim()) {
      toast.error(t('required'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        draft.id ? `/api/standard-messages/${draft.id}` : '/api/standard-messages',
        {
          method: draft.id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: draft.category,
            title: draft.title,
            content_text: draft.content_text,
          }),
        },
      );
      if (!res.ok) {
        toast.error(t('saveError'));
        return;
      }
      toast.success(t('saved'));
      setDraft(null);
      await load();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('deleteConfirm'))) return;
    const res = await fetch(`/api/standard-messages/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error(t('deleteError'));
      return;
    }
    await load();
  };

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />
      {!canEdit && <p className="mb-4 text-sm text-muted-foreground">{t('adminOnly')}</p>}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-8">
          {CATEGORIES.map((category) => {
            const list = items.filter((m) => m.category === category);
            return (
              <section key={category}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground">{t(`cat_${category}`)}</h3>
                    <p className="text-xs text-muted-foreground">{t(`catHint_${category}`)}</p>
                  </div>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDraft({ category, title: '', content_text: '' })}
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      {t('new')}
                    </Button>
                  )}
                </div>
                {list.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                    {t('empty')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {list.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
                      >
                        <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{m.title}</p>
                          <p className="line-clamp-2 text-xs text-muted-foreground">{m.content_text}</p>
                        </div>
                        {canEdit && (
                          <div className="flex shrink-0 gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() =>
                                setDraft({
                                  id: m.id,
                                  category: m.category,
                                  title: m.title,
                                  content_text: m.content_text,
                                })
                              }
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => void remove(m.id)}
                              className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? t('edit') : t('new')}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('nameLabel')}</label>
                <Input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="bg-muted text-foreground"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('textLabel')}</label>
                <Textarea
                  rows={7}
                  value={draft.content_text}
                  onChange={(e) => setDraft({ ...draft, content_text: e.target.value })}
                  className="bg-muted text-foreground"
                />
                <p className="mt-1 text-xs text-muted-foreground">{t('textHint')}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              {t('cancel')}
            </Button>
            <Button disabled={saving} onClick={() => void save()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
