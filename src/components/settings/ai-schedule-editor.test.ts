import { describe, expect, it } from 'vitest';

import { DEFAULT_AI_AUTO_REPLY_SCHEDULE } from '@/lib/ai/schedule';
import type { AiAutoReplySchedule } from '@/lib/ai/types';
import { copyScheduleDay, scheduleSummary } from './ai-schedule-editor';

const example = (): AiAutoReplySchedule => ({
  ...DEFAULT_AI_AUTO_REPLY_SCHEDULE,
  enabled: true,
  days: {
    monday: [
      { start: '08:00', end: '12:00' },
      { start: '14:00', end: '18:00' },
    ],
    tuesday: [
      { start: '08:00', end: '12:00' },
      { start: '14:00', end: '18:00' },
    ],
    wednesday: [
      { start: '08:00', end: '12:00' },
      { start: '14:00', end: '18:00' },
    ],
    thursday: [
      { start: '08:00', end: '12:00' },
      { start: '14:00', end: '18:00' },
    ],
    friday: [
      { start: '08:00', end: '12:00' },
      { start: '14:00', end: '18:00' },
    ],
    saturday: [{ start: '08:00', end: '12:00' }],
    sunday: [],
  },
});

describe('AI schedule editor helpers', () => {
  it('summarises consecutive days with identical hours', () => {
    expect(
      scheduleSummary(example(), {
        shortDays: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],
        inactive: 'inativo',
        always: '24 horas',
      })
    ).toBe('Seg–Sex 08:00–12:00, 14:00–18:00 · Sáb 08:00–12:00 · Dom inativo');
  });

  it('describes a disabled schedule as always available', () => {
    expect(
      scheduleSummary(DEFAULT_AI_AUTO_REPLY_SCHEDULE, {
        shortDays: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
        inactive: 'off',
        always: '24/7',
      })
    ).toBe('24/7');
  });

  it('copies cloned ranges only to selected destinations', () => {
    const original = example();
    const copied = copyScheduleDay(original, 'monday', ['saturday', 'sunday']);
    expect(copied.days.saturday).toEqual(original.days.monday);
    expect(copied.days.sunday).toEqual(original.days.monday);
    expect(copied.days.saturday).not.toBe(original.days.monday);
    expect(copied.days.tuesday).toEqual(original.days.tuesday);
  });
});
