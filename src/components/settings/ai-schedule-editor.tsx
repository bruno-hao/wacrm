'use client';

import { useMemo, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AI_WEEKDAYS } from '@/lib/ai/schedule';
import type {
  AiAutoReplySchedule,
  AiTimeRange,
  AiWeekday,
} from '@/lib/ai/types';

type SummaryLabels = {
  shortDays: readonly string[];
  inactive: string;
  always: string;
};

export function scheduleSummary(
  schedule: AiAutoReplySchedule,
  labels: SummaryLabels
) {
  if (!schedule.enabled) return labels.always;

  const signatures = AI_WEEKDAYS.map((day) =>
    schedule.days[day].map((range) => `${range.start}–${range.end}`).join(', ')
  );
  const groups: string[] = [];
  let start = 0;
  while (start < AI_WEEKDAYS.length) {
    let end = start;
    while (
      end + 1 < AI_WEEKDAYS.length &&
      signatures[end + 1] === signatures[start]
    )
      end += 1;
    const dayLabel =
      start === end
        ? labels.shortDays[start]
        : `${labels.shortDays[start]}–${labels.shortDays[end]}`;
    groups.push(`${dayLabel} ${signatures[start] || labels.inactive}`);
    start = end + 1;
  }
  return groups.join(' · ');
}

export function copyScheduleDay(
  schedule: AiAutoReplySchedule,
  source: AiWeekday,
  destinations: readonly AiWeekday[]
): AiAutoReplySchedule {
  const days = { ...schedule.days };
  for (const day of destinations) {
    days[day] = schedule.days[source].map((range) => ({ ...range }));
  }
  return { ...schedule, days };
}

interface AiScheduleEditorProps {
  value: AiAutoReplySchedule;
  onChange: (schedule: AiAutoReplySchedule) => void;
  disabled?: boolean;
}

export function AiScheduleEditor({
  value,
  onChange,
  disabled = false,
}: AiScheduleEditorProps) {
  const t = useTranslations('Settings.aiConfig.schedule');
  const [copySource, setCopySource] = useState<AiWeekday | null>(null);
  const [copyTargets, setCopyTargets] = useState<AiWeekday[]>([]);
  const scheduleDisabled = disabled || !value.enabled;

  const dayNames = useMemo(
    () => AI_WEEKDAYS.map((day) => t(`days.${day}`)),
    [t]
  );
  const shortDays = useMemo(
    () => AI_WEEKDAYS.map((day) => t(`shortDays.${day}`)),
    [t]
  );
  const summary = scheduleSummary(value, {
    shortDays,
    inactive: t('inactive'),
    always: t('alwaysActive'),
  });

  const replaceRanges = (day: AiWeekday, ranges: AiTimeRange[]) => {
    onChange({ ...value, days: { ...value.days, [day]: ranges } });
  };

  const setDayEnabled = (day: AiWeekday, enabled: boolean) => {
    replaceRanges(day, enabled ? [{ start: '08:00', end: '12:00' }] : []);
  };

  const updateRange = (
    day: AiWeekday,
    index: number,
    patch: Partial<AiTimeRange>
  ) => {
    replaceRanges(
      day,
      value.days[day].map((range, i) =>
        i === index ? { ...range, ...patch } : range
      )
    );
  };

  const openCopy = (day: AiWeekday) => {
    setCopySource(day);
    setCopyTargets([]);
  };

  const otherDays = copySource
    ? AI_WEEKDAYS.filter((day) => day !== copySource)
    : [];
  const overwrites = copyTargets.some((day) => value.days[day].length > 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-base">{t('title')}</CardTitle>
            <CardDescription>{t('description')}</CardDescription>
          </div>
          <Switch
            checked={value.enabled}
            onCheckedChange={(enabled) => onChange({ ...value, enabled })}
            disabled={disabled}
            aria-label={t('enabled')}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:max-w-sm">
          <Label htmlFor="ai-schedule-timezone">{t('timezone')}</Label>
          <Select
            value={value.timezone}
            onValueChange={() => undefined}
            disabled={scheduleDisabled}
          >
            <SelectTrigger id="ai-schedule-timezone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="America/Sao_Paulo">
                America/Sao_Paulo (UTC−03)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div
          className={
            value.enabled
              ? 'space-y-2'
              : 'space-y-2 opacity-50'
          }
        >
          {AI_WEEKDAYS.map((day, dayIndex) => {
            const ranges = value.days[day];
            const active = ranges.length > 0;
            return (
              <div key={day} className="border-border rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Switch
                    checked={active}
                    onCheckedChange={(checked) => setDayEnabled(day, checked)}
                    disabled={scheduleDisabled}
                    aria-label={dayNames[dayIndex]}
                  />
                  <span className="min-w-24 text-sm font-medium">
                    {dayNames[dayIndex]}
                  </span>
                  <div className="ml-auto flex gap-2">
                    {active && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          replaceRanges(day, [
                            ...ranges,
                            { start: '14:00', end: '18:00' },
                          ])
                        }
                        disabled={scheduleDisabled}
                      >
                        <Plus className="h-3.5 w-3.5" /> {t('addRange')}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => openCopy(day)}
                      disabled={scheduleDisabled}
                    >
                      <Copy className="h-3.5 w-3.5" /> {t('copyTo')}
                    </Button>
                  </div>
                </div>

                {active && (
                  <div className="mt-3 space-y-2 pl-0 sm:pl-14">
                    {ranges.map((range, index) => (
                      <div
                        key={index}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <Input
                          type="time"
                          value={range.start}
                          onChange={(event) =>
                            updateRange(day, index, {
                              start: event.target.value,
                            })
                          }
                          disabled={scheduleDisabled}
                          required
                          aria-label={`${dayNames[dayIndex]} ${t('start')}`}
                          className="w-32"
                        />
                        <span className="text-muted-foreground text-sm">
                          {t('to')}
                        </span>
                        <Input
                          type="time"
                          value={range.end}
                          onChange={(event) =>
                            updateRange(day, index, { end: event.target.value })
                          }
                          disabled={scheduleDisabled}
                          required
                          aria-label={`${dayNames[dayIndex]} ${t('end')}`}
                          className="w-32"
                        />
                        {range.start > range.end && (
                          <span className="bg-primary/10 text-primary rounded-full px-2 py-1 text-xs font-medium">
                            {t('nextDay')}
                          </span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            replaceRanges(
                              day,
                              ranges.filter((_, i) => i !== index)
                            )
                          }
                          disabled={scheduleDisabled}
                          aria-label={t('removeRange')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {value.enabled &&
          AI_WEEKDAYS.every((day) => value.days[day].length === 0) && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              {t('silentWarning')}
            </p>
          )}
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium">{t('summary')}:</span>{' '}
          {summary}
        </p>
      </CardContent>

      <Dialog
        open={copySource !== null}
        onOpenChange={(open) => !open && setCopySource(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('copyTitle')}</DialogTitle>
            <DialogDescription>
              {copySource
                ? t('copyDescription', {
                    day: dayNames[AI_WEEKDAYS.indexOf(copySource)],
                  })
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="flex cursor-pointer items-center gap-2 font-medium">
              <Checkbox
                checked={
                  otherDays.length > 0 &&
                  copyTargets.length === otherDays.length
                }
                onCheckedChange={(checked) =>
                  setCopyTargets(checked ? [...otherDays] : [])
                }
              />
              {t('allOtherDays')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {otherDays.map((day) => (
                <label
                  key={day}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <Checkbox
                    checked={copyTargets.includes(day)}
                    onCheckedChange={(checked) =>
                      setCopyTargets((current) =>
                        checked
                          ? [...current, day]
                          : current.filter((candidate) => candidate !== day)
                      )
                    }
                  />
                  {dayNames[AI_WEEKDAYS.indexOf(day)]}
                </label>
              ))}
            </div>
            {overwrites && (
              <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {t('overwriteWarning')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCopySource(null)}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              disabled={!copySource || copyTargets.length === 0}
              onClick={() => {
                if (copySource)
                  onChange(copyScheduleDay(value, copySource, copyTargets));
                setCopySource(null);
              }}
            >
              {overwrites ? t('confirmOverwrite') : t('copy')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
