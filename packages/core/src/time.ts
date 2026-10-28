const MINUTE = 60_000;

function offsetMs(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant of a wall-clock date and time in a time zone. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi, s = 0] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = wall - offsetMs(timeZone, wall);
  // Second pass handles days where the offset changes (DST).
  guess = wall - offsetMs(timeZone, guess);
  return new Date(guess);
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export interface DayWindow {
  day: number;
  /** YYYY-MM-DD in the tournament's time zone. */
  date?: string;
  start: number;
  end: number;
}

/** Hours one day plays when they differ from the daily hours: a day that ends early or runs late. */
export interface DayHours {
  /** HH:MM */
  start?: string;
  /** HH:MM; before start means past midnight. */
  end?: string;
}

/** Playing windows (ms since epoch) for each tournament day. */
export function tournamentWindows(t: {
  start_date: string;
  days: number;
  daily_start: string;
  daily_end: string;
  timezone: string;
  /** Per-day changes, by YYYY-MM-DD. */
  day_hours?: Record<string, DayHours> | null;
}): DayWindow[] {
  return Array.from({ length: t.days }, (_, i) => {
    const date = addDays(t.start_date, i);
    const own = t.day_hours?.[date];
    const startClock = own?.start ?? t.daily_start;
    const endClock = own?.end ?? t.daily_end;
    const start = zonedToUtc(date, startClock, t.timezone).getTime();
    let end = zonedToUtc(date, endClock, t.timezone).getTime();
    // A day that runs past midnight (an end equal to the start is a day with nothing left to play).
    if (end < start) end = zonedToUtc(addDays(date, 1), endClock, t.timezone).getTime();
    return { day: i + 1, date, start, end };
  });
}

/** The event-local date (YYYY-MM-DD) of an instant. */
export function zonedDate(at: number | string | Date, timeZone: string): string {
  return toZonedInput(new Date(at).toISOString(), timeZone).slice(0, 10);
}

/** The event-local wall clock (HH:MM) of an instant. */
export function zonedClock(at: number | string | Date, timeZone: string): string {
  return toZonedInput(new Date(at).toISOString(), timeZone).slice(11, 16);
}

/** A clock time for display, 12-hour: "5:30 PM". */
export function formatTime(iso: string | number | Date | null | undefined, timeZone: string): string {
  if (iso == null) return 'TBD';
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}

/** The event-local calendar day (YYYY-MM-DD) of an instant. */
export function localDate(iso: string | number | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** A wall-clock "HH:MM" or "HH:MM:SS" (daily hours, a sheet's start time) for display: "5:30 PM". */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * A start time that says its day when it isn't today: "5:30 PM",
 * "Tomorrow 5:30 PM" or "Thu 29 Oct 5:30 PM". Matches moved to another day
 * would otherwise look like today's.
 */
export function formatWhen(iso: string | number | Date | null | undefined, timeZone: string, now: number = Date.now()): string {
  if (iso == null) return 'TBD';
  const time = formatTime(iso, timeZone);
  const day = zonedDate(iso, timeZone);
  const today = zonedDate(now, timeZone);
  if (day === today) return time;
  if (day === addDays(today, 1)) return `Tomorrow ${time}`;
  if (day === addDays(today, -1)) return `Yesterday ${time}`;
  return `${formatDay(iso, timeZone)} ${time}`;
}

/** Whether an instant falls on a later event-local day than now. */
export function isLaterDay(iso: string | number | Date | null | undefined, timeZone: string, now: number = Date.now()): boolean {
  return iso != null && zonedDate(iso, timeZone) > zonedDate(now, timeZone);
}

export function formatDay(iso: string | number | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
}

/** Value for an <input type="datetime-local"> showing an instant in a zone. */
export function toZonedInput(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function fromZonedInput(value: string, timeZone: string): Date {
  const [date, time] = value.split('T');
  return zonedToUtc(date, time, timeZone);
}

export function elapsed(fromIso: string, now: number = Date.now()): string {
  const total = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export { MINUTE };
