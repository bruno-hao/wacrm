'use client';

import { Camera, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type Channel = 'whatsapp' | 'instagram';

const STYLE: Record<Channel, string> = {
  whatsapp: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  instagram: 'bg-pink-500/15 text-pink-600 dark:text-pink-400',
};

/** Where a conversation lives: WhatsApp (green) or Instagram (pink). */
export function ChannelBadge({
  channel,
  iconOnly,
  className,
}: {
  channel: Channel;
  iconOnly?: boolean;
  className?: string;
}) {
  const t = useTranslations('Inbox.channel');
  const Icon = channel === 'instagram' ? Camera : MessageCircle;
  return (
    <span
      title={t(channel)}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full',
        STYLE[channel],
        iconOnly ? 'h-4 w-4 justify-center' : 'h-5 px-2 text-[10px] font-medium',
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {!iconOnly && t(channel)}
    </span>
  );
}
