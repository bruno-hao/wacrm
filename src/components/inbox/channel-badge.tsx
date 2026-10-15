'use client';

import { Camera } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/** Marks a conversation that lives on Instagram (WhatsApp is the default and is not marked). */
export function ChannelBadge({
  channel,
  iconOnly,
  className,
}: {
  channel: 'instagram';
  iconOnly?: boolean;
  className?: string;
}) {
  const t = useTranslations('Inbox.channel');
  if (channel !== 'instagram') return null;
  return (
    <span
      title={t('instagram')}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-pink-500/15 text-pink-600 dark:text-pink-400',
        iconOnly ? 'h-4 w-4 justify-center' : 'h-5 px-2 text-[10px] font-medium',
        className,
      )}
    >
      <Camera className="h-3 w-3" />
      {!iconOnly && t('instagram')}
    </span>
  );
}
