import type {
  AiAutoReplySchedule,
  AiTimeRange,
  AiWeekday,
} from './types'

export const AI_WEEKDAYS: readonly AiWeekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

const EMPTY_DAYS = (): AiAutoReplySchedule['days'] => ({
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
})

export const DEFAULT_AI_AUTO_REPLY_SCHEDULE: AiAutoReplySchedule = {
  enabled: false,
  timezone: 'America/Sao_Paulo',
  days: EMPTY_DAYS(),
}

/** Safe fallback for a corrupt enabled schedule: manual AI stays usable,
 * while automatic replies remain silent until an admin saves valid data. */
export const FAIL_CLOSED_AI_AUTO_REPLY_SCHEDULE: AiAutoReplySchedule = {
  enabled: true,
  timezone: 'America/Sao_Paulo',
  days: EMPTY_DAYS(),
}

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export function parseAiAutoReplySchedule(input: unknown): AiAutoReplySchedule {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('auto_reply_schedule must be an object')
  }
  const raw = input as Record<string, unknown>
  if (typeof raw.enabled !== 'boolean') {
    throw new Error('auto_reply_schedule.enabled must be boolean')
  }
  if (raw.timezone !== 'America/Sao_Paulo') {
    throw new Error('auto_reply_schedule.timezone is unsupported')
  }
  if (!raw.days || typeof raw.days !== 'object' || Array.isArray(raw.days)) {
    throw new Error('auto_reply_schedule.days must contain the complete week')
  }

  const rawDays = raw.days as Record<string, unknown>
  const days = EMPTY_DAYS()
  for (const day of AI_WEEKDAYS) {
    const ranges = rawDays[day]
    if (!Array.isArray(ranges)) {
      throw new Error(`auto_reply_schedule.days.${day} must be an array`)
    }
    days[day] = ranges.map((range, index) => parseRange(range, day, index))
  }

  return { enabled: raw.enabled, timezone: raw.timezone, days }
}

function parseRange(input: unknown, day: AiWeekday, index: number): AiTimeRange {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`auto_reply_schedule.days.${day}[${index}] must be an object`)
  }
  const raw = input as Record<string, unknown>
  if (typeof raw.start !== 'string' || !TIME_RE.test(raw.start)) {
    throw new Error(`auto_reply_schedule.days.${day}[${index}].start is invalid`)
  }
  if (typeof raw.end !== 'string' || !TIME_RE.test(raw.end)) {
    throw new Error(`auto_reply_schedule.days.${day}[${index}].end is invalid`)
  }
  if (raw.start === raw.end) {
    throw new Error(`auto_reply_schedule.days.${day}[${index}] cannot be empty`)
  }
  return { start: raw.start, end: raw.end }
}

const minutes = (value: string) => {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

const previousWeekday = (day: AiWeekday): AiWeekday => {
  const index = AI_WEEKDAYS.indexOf(day)
  return AI_WEEKDAYS[(index + AI_WEEKDAYS.length - 1) % AI_WEEKDAYS.length]
}

function localWeekdayAndMinute(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value
  const weekday = value('weekday')?.toLowerCase() as AiWeekday | undefined
  const hour = Number(value('hour'))
  const minute = Number(value('minute'))
  if (!weekday || !AI_WEEKDAYS.includes(weekday) || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    throw new Error('Could not resolve the configured AI schedule timezone')
  }
  return { weekday, minute: hour * 60 + minute }
}

export function isAiAutoReplyActive(
  schedule: AiAutoReplySchedule,
  now: Date = new Date(),
): boolean {
  if (!schedule.enabled) return true

  const local = localWeekdayAndMinute(now, schedule.timezone)
  for (const range of schedule.days[local.weekday]) {
    const start = minutes(range.start)
    const end = minutes(range.end)
    if (start < end && local.minute >= start && local.minute < end) return true
    if (start > end && local.minute >= start) return true
  }

  for (const range of schedule.days[previousWeekday(local.weekday)]) {
    const start = minutes(range.start)
    const end = minutes(range.end)
    if (start > end && local.minute < end) return true
  }
  return false
}
