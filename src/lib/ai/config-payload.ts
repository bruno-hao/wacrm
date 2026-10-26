import {
  DEFAULT_AI_AUTO_REPLY_SCHEDULE,
  FAIL_CLOSED_AI_AUTO_REPLY_SCHEDULE,
  parseAiAutoReplySchedule,
} from './schedule';
import type { AiAutoReplySchedule } from './types';

export type AutoReplyScheduleUpdate =
  { provided: false } | { provided: true; value: AiAutoReplySchedule };

export function readAutoReplyScheduleUpdate(
  body: Record<string, unknown>
): AutoReplyScheduleUpdate {
  if (!Object.prototype.hasOwnProperty.call(body, 'auto_reply_schedule')) {
    return { provided: false };
  }
  return {
    provided: true,
    value: parseAiAutoReplySchedule(body.auto_reply_schedule),
  };
}

export function readStoredAutoReplySchedule(
  input: unknown,
  onInvalid: (error: unknown) => void = () => undefined
): AiAutoReplySchedule {
  if (input == null) return DEFAULT_AI_AUTO_REPLY_SCHEDULE;
  try {
    return parseAiAutoReplySchedule(input);
  } catch (error) {
    onInvalid(error);
    return FAIL_CLOSED_AI_AUTO_REPLY_SCHEDULE;
  }
}
