import { useMemo, useState } from 'react';
import {
  formatDay,
  formatTime,
  formatWhen,
  MINUTE,
  previewDay,
  rescheduleInTimetable,
  stationLabel,
  timetableOptions,
  todayOf,
  zonedClock,
  zonedDate,
  zonedToUtc,
  type Game,
  type Match,
  type Tournament,
  type TournamentGame,
} from '@dlc/core';
import { addTournamentDay, rescheduleMatch, setDayHours } from '../lib/admin';
import { Button, ErrorNote, Field, Panel, useNow } from './ui';

interface Common {
  tournament: Tournament;
  tgames: TournamentGame[];
  matches: Match[];
  catalog: Iterable<Game>;
}

/**
 * Give a queued match a new start time, today or another day. The preview
 * shows where it lands and which matches move to make room before saving.
 */
export function RescheduleDialog({
  tournament,
  tgames,
  matches,
  catalog,
  match,
  title,
  matchName,
  onClose,
}: Common & { match: Match; title: string; matchName: (m: Match) => string; onClose: () => void }) {
  const tz = tournament.timezone;
  const [now] = useState(() => Date.now());
  const options = useMemo(() => timetableOptions(tournament, tgames, now, catalog), [tournament, tgames, now, catalog]);
  const today = zonedDate(now, tz);
  const days = options.windows.filter((w) => w.date && w.date >= today);
  const planned = match.scheduled_start ? new Date(match.scheduled_start).getTime() : now;
  const [date, setDate] = useState(() => {
    const d = zonedDate(planned, tz);
    return days.some((w) => w.date === d) ? d : (days[0]?.date ?? today);
  });
  const [time, setTime] = useState(() => zonedClock(Math.max(planned, now), tz));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const at = date && time ? zonedToUtc(date, time, tz).getTime() : null;
  const preview = useMemo(() => (at != null && at >= now - MINUTE ? rescheduleInTimetable(matches, options, match.id, at) : null), [matches, options, match.id, at, now]);
  const byId = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const tomorrow = days.find((w) => w.date! > today);

  const save = async (value: number | null) => {
    setBusy(true);
    setError(null);
    try {
      await rescheduleMatch(match, value == null ? null : new Date(value));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const nudge = (minutes: number) => {
    const t = Math.max(planned, now) + minutes * MINUTE;
    setDate(zonedDate(t, tz));
    setTime(zonedClock(t, tz));
  };

  const slot = preview?.slot;
  const late = slot && at != null && slot.start > at;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="panel glass-strong max-h-[92vh] w-full max-w-lg overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 hud text-xs text-flame">{title}</div>
        <h2 className="mb-1 text-xl font-bold">Reschedule {matchName(match)}</h2>
        <p className="mb-4 text-sm text-muted">
          Now planned for {match.scheduled_start ? `${formatDay(match.scheduled_start, tz)}, ${formatTime(match.scheduled_start, tz)}` : 'no time yet'}
          {match.time_locked ? ' (a set time)' : ''}. Pick a new start; the other matches move round it.
        </p>

        <div className="mb-3 flex flex-wrap gap-2">
          <Button variant="ghost" className="px-2 py-1" onClick={() => nudge(15)}>
            +15 min
          </Button>
          <Button variant="ghost" className="px-2 py-1" onClick={() => nudge(30)}>
            +30 min
          </Button>
          <Button variant="ghost" className="px-2 py-1" onClick={() => nudge(60)}>
            +1 hour
          </Button>
          {tomorrow && (
            <Button variant="ghost" className="px-2 py-1" onClick={() => (setDate(tomorrow.date!), setTime(zonedClock(tomorrow.start, tz)))}>
              Tomorrow, first
            </Button>
          )}
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Day">
            <select value={date} onChange={(e) => setDate(e.target.value)}>
              {days.map((w) => (
                <option key={w.date} value={w.date}>
                  {w.date === today ? 'Today' : formatDay(w.start, tz)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start time">
            <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>

        {at != null && at < now - MINUTE && <div className="mb-3 text-sm text-danger">That time has already passed.</div>}
        {preview && !slot && <div className="mb-3 text-sm text-danger">The timetable can't place this match at that time.</div>}
        {preview && slot && (
          <div className="mb-4 flex flex-col gap-1 text-sm">
            <div>
              Starts <span className="font-semibold text-ember">{formatTime(slot.start, tz)}</span>
              {date !== today ? ` on ${formatDay(slot.start, tz)}` : ''} on {stationLabel(slot)}.
            </div>
            {late && <div className="text-gold">Its players or the round it waits for aren't done by {formatTime(at, tz)}, so that is the earliest it can start.</div>}
            {slot.overflow && <div className="text-gold">That is outside the day's hours. It still plays then; use End of day to run the day late.</div>}
            <div className="text-muted">
              {preview.shifted.length === 0 ? 'No other match moves.' : `${preview.shifted.length} other ${preview.shifted.length === 1 ? 'match moves' : 'matches move'}:`}
            </div>
            {preview.shifted.length > 0 && (
              <ul className="ml-4 list-disc text-muted">
                {preview.shifted.slice(0, 6).map((id) => {
                  const m = byId.get(id);
                  const s = preview.result.slots.find((x) => x.id === id)!;
                  return (
                    <li key={id}>
                      {m ? matchName(m) : 'A match'}: {formatWhen(m?.scheduled_start, tz)} → {formatWhen(s.start, tz)}
                    </li>
                  );
                })}
                {preview.shifted.length > 6 && <li>and {preview.shifted.length - 6} more</li>}
              </ul>
            )}
          </div>
        )}

        <ErrorNote message={error} />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button disabled={busy || !slot || at == null} onClick={() => save(at)}>
            Save new time
          </Button>
          {match.time_locked && (
            <Button variant="ghost" disabled={busy} onClick={() => save(null)} title="Let the timetable place it again">
              Clear set time
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The end of the day: see what still fits today and what moves on, then run
 * the day late so the rest plays tonight, or stop and move it to tomorrow.
 */
export function EndOfDay({ tournament, tgames, matches, catalog }: Common) {
  const tz = tournament.timezone;
  const now = useNow(30_000);
  const day = todayOf(tournament, now);
  const own = day?.date ? tournament.day_hours?.[day.date] : undefined;
  const [until, setUntil] = useState(() => (day ? zonedClock(day.end + 60 * MINUTE, tz) : '22:00'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const queued = matches.some((m) => !m.is_bye && (m.status === 'pending' || m.status === 'ready'));
  // Each preview rebuilds the timetable in memory; nothing is saved until a button is pressed.
  const preview = (end?: string) => (day?.date ? safe(() => previewDay(tournament, tgames, matches, day.date!, end ? { ...own, end } : undefined, now, catalog)) : null);
  const current = preview();
  const late = until ? preview(until) : null;
  const stopAt = zonedClock(Math.max(now, day?.start ?? now), tz);
  // Once the day is over there is nothing to stop.
  const stop = day && now < day.end ? preview(stopAt) : null;

  if (!day?.date || !current || !queued) return null;
  const date = day.date;
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const lastDay = day.day === tournament.days;
  const plural = (n: number) => `${n} ${n === 1 ? 'match' : 'matches'}`;
  const moving = (p: typeof current) => [p.later > 0 && `${plural(p.later)} move to tomorrow`, p.beyond > 0 && `${plural(p.beyond)} have no day left`].filter(Boolean).join(', ');

  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">End of day</h2>
        <span className="text-sm text-muted">
          Today plays until {formatTime(day.end, tz)}
          {own ? ' (changed for today)' : ''}
        </span>
      </div>
      <p className="text-sm text-muted">
        {current.later + current.beyond === 0
          ? `Everything still queued for today fits before ${formatTime(day.end, tz)}.`
          : `${plural(current.today)} still fit today. ${moving(current)}.`}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Run today late until" hint="Past midnight is fine">
          <input type="time" value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
        <Button disabled={busy || !until} onClick={() => run(() => setDayHours(tournament, date, { ...own, end: until }), `Today now runs until ${until}. Timetable rebuilt.`)}>
          Play the rest today
        </Button>
        {late && <span className="text-sm text-muted">Then {plural(late.today)} play today{late.later + late.beyond ? `; ${moving(late)}` : ', nothing moves on'}.</span>}
      </div>

      {stop && (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => run(() => setDayHours(tournament, date, { ...own, end: stopAt }), 'Stopped for today. What was left moves to tomorrow.')}
          title="End today now; every queued match moves to the next day"
        >
          Stop for today, move the rest to tomorrow
        </Button>
        <span className="text-sm text-muted">{stop.later + stop.beyond ? `${moving(stop)}.` : 'Nothing is left to move.'}</span>
      </div>
      )}

      {(lastDay || current.beyond > 0 || (stop?.beyond ?? 0) > 0) && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-gold">{lastDay ? 'Today is the last tournament day.' : 'Some matches run past the last day.'}</span>
          <Button variant="ghost" disabled={busy} onClick={() => run(() => addTournamentDay(tournament), 'Added a day. Matches that did not fit moved to it.')}>
            Add a day
          </Button>
        </div>
      )}
      {own && (
        <div>
          <Button variant="ghost" className="px-2 py-1" disabled={busy} onClick={() => run(() => setDayHours(tournament, date, null), 'Today is back to the usual hours.')}>
            Back to the usual hours
          </Button>
        </div>
      )}
      {done && <div className="text-sm text-gold">{done}</div>}
      <ErrorNote message={error} />
    </Panel>
  );
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
