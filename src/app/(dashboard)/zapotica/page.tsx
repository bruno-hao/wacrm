'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Cake, FileClock, HeartHandshake, Megaphone, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { NoticesPanel, type NoticeModule } from '@/components/zapotica/notices-panel';

const SECTIONS: { id: NoticeModule; icon: LucideIcon }[] = [
  { id: 'avisos', icon: Megaphone },
  { id: 'posvenda', icon: HeartHandshake },
  { id: 'receitas', icon: FileClock },
  { id: 'aniversario', icon: Cake },
];

function resolveSection(raw: string | null): NoticeModule {
  return SECTIONS.find((s) => s.id === raw)?.id ?? 'avisos';
}

// `useSearchParams` needs a Suspense boundary (same reason as /settings).
export default function ZapOticaPage() {
  return (
    <Suspense fallback={null}>
      <ZapOticaInner />
    </Suspense>
  );
}

function ZapOticaInner() {
  const t = useTranslations('Announcements');
  const router = useRouter();
  const searchParams = useSearchParams();
  const section = resolveSection(searchParams.get('tab'));

  const go = (next: NoticeModule) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/zapotica?${params.toString()}`, { scroll: false });
  };

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('zapTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('zapDescription')}</p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        {/* Same rail as Settings: vertical on desktop, a scroller on narrow screens. */}
        <nav
          aria-label={t('tabsNav')}
          className={cn(
            'flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            'border-b border-border',
            'lg:sticky lg:top-0 lg:flex-col lg:overflow-visible lg:border-b-0 lg:pb-0',
          )}
        >
          {SECTIONS.map(({ id, icon: Icon }) => {
            const isActive = id === section;
            return (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors',
                  'lg:w-full',
                  isActive
                    ? 'bg-primary-soft text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1">{t(`tab_${id}` as never)}</span>
              </button>
            );
          })}
        </nav>
        <div className="min-w-0">
          <NoticesPanel key={section} module={section} />
        </div>
      </div>
    </div>
  );
}
