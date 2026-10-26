import { describe, expect, it } from 'vitest'
import { readAutoReplyScheduleUpdate } from './config-payload'
import { DEFAULT_AI_AUTO_REPLY_SCHEDULE } from './schedule'

describe('readAutoReplyScheduleUpdate', () => {
  it('preserves the stored schedule when the field is omitted', () => {
    expect(readAutoReplyScheduleUpdate({ model: 'gpt-test' })).toEqual({
      provided: false,
    })
  })

  it('returns a validated schedule when provided', () => {
    expect(
      readAutoReplyScheduleUpdate({
        auto_reply_schedule: DEFAULT_AI_AUTO_REPLY_SCHEDULE,
      }),
    ).toEqual({ provided: true, value: DEFAULT_AI_AUTO_REPLY_SCHEDULE })
  })

  it('rejects malformed schedules', () => {
    expect(() =>
      readAutoReplyScheduleUpdate({ auto_reply_schedule: { enabled: true } }),
    ).toThrow()
  })
})
