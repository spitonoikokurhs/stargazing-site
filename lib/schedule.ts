import scheduleData from '@/config/schedule.json'

// Schedule as data. Session.date and the inputs/outputs here are all
// Athens-local YYYY-MM-DD calendar dates (see route.ts for the ingest-time
// date semantics). timeShifts is carried for later use by the /live page's
// "next session" copy; scheduledHotelFor only needs the weekly hotel mapping.
type DaySlot = { hotelId: string; start: string; end: string } | null

type Schedule = {
  season: { start: string; end: string }
  timezone: string
  weekly: Record<string, DaySlot>
  timeShifts: { from: string; start: string; end: string }[]
}

const schedule = scheduleData as Schedule

// getUTCDay() index (0 = Sunday) → schedule.weekly key.
const DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

// Today's Europe/Athens calendar date as YYYY-MM-DD. Formatted in the Athens
// zone (en-CA yields ISO-style YYYY-MM-DD) rather than from the server's
// local/UTC date, which would be off by one for part of each day.
export function athensToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

// The scheduled hotel slug for a given YYYY-MM-DD, or null outside the season
// or on a day with no event. String comparison is valid because YYYY-MM-DD is
// lexicographically sortable. Day-of-week is derived from the calendar date
// via UTC parsing, independent of the server's local timezone.
export function scheduledHotelFor(date: string): string | null {
  const { season, weekly } = schedule
  if (date < season.start || date > season.end) return null
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
  const slot = weekly[DAY_KEYS[dow]]
  return slot ? slot.hotelId : null
}
