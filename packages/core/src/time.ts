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
  start: number;
  end: number;
}

/** Playing windows (ms since epoch) for each tournament day. */
export function tournamentWindows(t: {
  start_date: string;
  days: number;
  daily_start: string;
  daily_end: string;
  timezone: string;
}): DayWindow[] {
  return Array.from({ length: t.days }, (_, i) => {
    const date = addDays(t.start_date, i);
    return {
      day: i + 1,
      start: zonedToUtc(date, t.daily_start, t.timezone).getTime(),
      end: zonedToUtc(date, t.daily_end, t.timezone).getTime(),
    };
  });
}

export function formatTime(iso: string | number | Date | null | undefined, timeZone: string): string {
  if (iso == null) return 'TBD';
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
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
