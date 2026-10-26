import { parseAiAutoReplySchedule } from './schedule'
import type { AiAutoReplySchedule } from './types'

export type AutoReplyScheduleUpdate =
  | { provided: false }
  | { provided: true; value: AiAutoReplySchedule }

export function readAutoReplyScheduleUpdate(
  body: Record<string, unknown>,
): AutoReplyScheduleUpdate {
  if (!Object.prototype.hasOwnProperty.call(body, 'auto_reply_schedule')) {
    return { provided: false }
  }
  return {
    provided: true,
    value: parseAiAutoReplySchedule(body.auto_reply_schedule),
  }
}
