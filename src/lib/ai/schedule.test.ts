import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AI_AUTO_REPLY_SCHEDULE,
  isAiAutoReplyActive,
  parseAiAutoReplySchedule,
} from './schedule'
import type { AiAutoReplySchedule } from './types'

const emptyDays = () => ({
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
})

function schedule(
  days: AiAutoReplySchedule['days'],
  enabled = true,
): AiAutoReplySchedule {
  return { enabled, timezone: 'America/Sao_Paulo', days }
}

describe('parseAiAutoReplySchedule', () => {
  it('accepts a complete weekly schedule and preserves multiple ranges', () => {
    const input = schedule({
      ...emptyDays(),
      monday: [
        { start: '08:00', end: '12:00' },
        { start: '14:00', end: '18:00' },
      ],
    })

    expect(parseAiAutoReplySchedule(input)).toEqual(input)
  })

  it.each([
    ['bad hour', { start: '24:00', end: '12:00' }],
    ['bad minute', { start: '08:60', end: '12:00' }],
    ['not padded', { start: '8:00', end: '12:00' }],
    ['empty duration', { start: '08:00', end: '08:00' }],
  ])('rejects %s', (_label, range) => {
    expect(() =>
      parseAiAutoReplySchedule(
        schedule({ ...emptyDays(), monday: [range] }),
      ),
    ).toThrow()
  })

  it('rejects unsupported timezones and malformed day collections', () => {
    expect(() =>
      parseAiAutoReplySchedule({
        ...DEFAULT_AI_AUTO_REPLY_SCHEDULE,
        timezone: 'UTC',
      }),
    ).toThrow(/timezone/i)
    expect(() =>
      parseAiAutoReplySchedule({
        enabled: true,
        timezone: 'America/Sao_Paulo',
        days: { monday: [] },
      }),
    ).toThrow(/days/i)
  })
})

describe('isAiAutoReplyActive', () => {
  it('allows every instant when the schedule is disabled', () => {
    expect(
      isAiAutoReplyActive(
        schedule(emptyDays(), false),
        new Date('2026-10-26T03:00:00Z'),
      ),
    ).toBe(true)
  })

  it('keeps an enabled empty week silent', () => {
    expect(
      isAiAutoReplyActive(
        schedule(emptyDays()),
        new Date('2026-10-26T14:00:00Z'),
      ),
    ).toBe(false)
  })

  it('uses start-inclusive and end-exclusive boundaries in Sao Paulo', () => {
    const configured = schedule({
      ...emptyDays(),
      monday: [{ start: '08:00', end: '12:00' }],
    })

    expect(isAiAutoReplyActive(configured, new Date('2026-10-26T10:59:59Z'))).toBe(false)
    expect(isAiAutoReplyActive(configured, new Date('2026-10-26T11:00:00Z'))).toBe(true)
    expect(isAiAutoReplyActive(configured, new Date('2026-10-26T14:59:59Z'))).toBe(true)
    expect(isAiAutoReplyActive(configured, new Date('2026-10-26T15:00:00Z'))).toBe(false)
  })

  it('matches either of several ranges on one day', () => {
    const configured = schedule({
      ...emptyDays(),
      monday: [
        { start: '08:00', end: '12:00' },
        { start: '14:00', end: '18:00' },
      ],
    })

    expect(isAiAutoReplyActive(configured, new Date('2026-10-26T16:00:00Z'))).toBe(false)
    expect(isAiAutoReplyActive(configured, new Date('2026-10-26T17:00:00Z'))).toBe(true)
  })

  it('continues an overnight range into the following day', () => {
    const configured = schedule({
      ...emptyDays(),
      monday: [{ start: '22:00', end: '02:00' }],
    })

    expect(isAiAutoReplyActive(configured, new Date('2026-10-27T00:59:59Z'))).toBe(false)
    expect(isAiAutoReplyActive(configured, new Date('2026-10-27T01:00:00Z'))).toBe(true)
    expect(isAiAutoReplyActive(configured, new Date('2026-10-27T04:59:59Z'))).toBe(true)
    expect(isAiAutoReplyActive(configured, new Date('2026-10-27T05:00:00Z'))).toBe(false)
  })

  it('wraps an overnight Sunday range into Monday', () => {
    const configured = schedule({
      ...emptyDays(),
      sunday: [{ start: '22:00', end: '02:00' }],
    })

    expect(isAiAutoReplyActive(configured, new Date('2026-11-02T04:00:00Z'))).toBe(true)
    expect(isAiAutoReplyActive(configured, new Date('2026-11-02T05:00:00Z'))).toBe(false)
  })
})
