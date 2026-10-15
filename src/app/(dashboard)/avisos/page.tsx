'use client';

import { Megaphone } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Placeholder: this entry will get its function later. */
export default function AnnouncementsPage() {
  const t = useTranslations('Announcements');
  return (
    <div>
      <div className="flex items-center gap-2">
        <Megaphone className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('title')}
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
    </div>
  );
}
