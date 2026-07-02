import scheduleData from '@/config/schedule.json'

// Schedule as data. Session.date and the inputs/outputs here are all
// Athens-local YYYY-MM-DD calendar dates (see route.ts for the ingest-time
// date semantics). eventFor honors the season bounds and the timeShifts
// (e.g. the Sept 1 shift to earlier start/end); scheduledHotelFor is a thin
// wrapper kept for /api/ingest, which only needs the weekly hotel mapping.
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

// A scheduled event: which hotel, and its Athens-local start/end wall times.
export type ScheduledEvent = { hotelId: string; start: string; end: string }

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

// Add n calendar days to a YYYY-MM-DD date. Arithmetic is done in UTC so it is
// pure calendar-day math (no DST drift) and the result is formatted back to
// YYYY-MM-DD — matching how DAY_KEYS is derived above.
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// The scheduled event for a given Athens YYYY-MM-DD, or null outside the season
// or on a day with no event. String comparison is valid because YYYY-MM-DD is
// lexicographically sortable. Day-of-week is derived from the calendar date via
// UTC parsing, independent of the server's local timezone. When one or more
// timeShifts apply (date on or after `from`), the latest applicable shift's
// start/end override the weekly slot's — the hotel is unchanged.
export function eventFor(date: string): ScheduledEvent | null {
  const { season, weekly, timeShifts } = schedule
  if (date < season.start || date > season.end) return null
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
  const slot = weekly[DAY_KEYS[dow]]
  if (!slot) return null

  let { start, end } = slot
  const applicable = timeShifts
    .filter((s) => date >= s.from)
    .sort((a, b) => (a.from < b.from ? -1 : 1))
    .at(-1)
  if (applicable) {
    start = applicable.start
    end = applicable.end
  }
  return { hotelId: slot.hotelId, start, end }
}

// The next scheduled event on or after fromDate, walking forward one calendar
// day at a time (fromDate itself is checked first). Returns the event plus its
// date, or null if none falls within the next limitDays days.
export function nextEvent(
  fromDate: string,
  limitDays = 14,
): { date: string; hotelId: string; start: string; end: string } | null {
  for (let i = 0; i < limitDays; i++) {
    const date = addDays(fromDate, i)
    const event = eventFor(date)
    if (event) return { date, ...event }
  }
  return null
}

// The scheduled hotel slug for a given YYYY-MM-DD, or null. Kept as the ingest
// path's entry point; delegates to eventFor so season/weekly logic lives in one
// place (the time shift doesn't affect which hotel hosts).
export function scheduledHotelFor(date: string): string | null {
  return eventFor(date)?.hotelId ?? null
}
