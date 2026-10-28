import { formatDay, formatTime, formatWhen, MINUTE, previewDay, rescheduleInTimetable, timetableOptions, todayOf, zonedClock, zonedDate, zonedToUtc, type DayHours, type Match } from '@dlc/core';
import { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { rescheduleMatch, setDayHours } from '../lib/actions';
import type { TournamentData } from '../lib/useTournament';
import { Button, colors, ErrorText, styles } from './ui';

const plural = (n: number) => `${n} ${n === 1 ? 'match' : 'matches'}`;
const clock = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** Move a queued match to another time today (or tomorrow); the other matches move round it. */
export function RescheduleCard({ data, match }: { data: TournamentData; match: Match }) {
  const t = data.tournament!;
  const tz = t.timezone;
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();
  const options = timetableOptions(t, data.tgames, now, data.games.values());
  const today = zonedDate(now, tz);
  const tomorrow = options.windows.find((w) => w.date && w.date > today);
  const planned = Math.max(match.scheduled_start ? new Date(match.scheduled_start).getTime() : now, now);

  const confirm = (key: string, at: number | null) => {
    const p = rescheduleInTimetable(data.matches, options, match.id, at);
    const when = p.slot ? `${zonedDate(p.slot.start, tz) === today ? '' : `${formatDay(p.slot.start, tz)}, `}${formatTime(p.slot.start, tz)}` : 'no time';
    const moved = p.shifted.length ? `${plural(p.shifted.length)} move to make room.` : 'No other match moves.';
    const late = p.slot && at != null && p.slot.start > at ? `\n\nIts players or the round before aren't done by ${formatTime(at, tz)}, so this is the earliest.` : '';
    Alert.alert(at == null ? 'Clear the set time?' : `Move to ${when}?`, `${at == null ? `It goes back to ${when}. ` : ''}${moved}${late}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Move',
        onPress: async () => {
          setBusy(key);
          setError(null);
          try {
            await rescheduleMatch(match, at == null ? null : new Date(at));
            setTime('');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };
  const custom = () => {
    if (!clock.test(time)) return setError('Type the time as HH:MM, for example 16:30.');
    const at = zonedToUtc(today, time, tz).getTime();
    if (at < now - MINUTE) return setError('That time has already passed today.');
    confirm('custom', at);
  };

  return (
    <View style={[styles.card, { gap: 10 }]}>
      <Text style={styles.label}>Reschedule</Text>
      <Text style={styles.muted}>
        Planned for {formatWhen(match.scheduled_start, tz)}
        {match.time_locked ? ' (set time)' : ''}. Pick a new start and the rest of the timetable moves round it.
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[15, 30, 60].map((min) => (
          <Button key={min} title={min < 60 ? `+${min} min` : '+1 hour'} variant="ghost" style={{ flex: 1 }} busy={busy === `+${min}`} disabled={!!busy} onPress={() => confirm(`+${min}`, planned + min * MINUTE)} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          value={time}
          onChangeText={setTime}
          placeholder="Today at HH:MM"
          placeholderTextColor={colors.muted}
          keyboardType="numbers-and-punctuation"
          style={[styles.input, { flex: 1 }]}
        />
        <Button title="Set time" variant="ghost" busy={busy === 'custom'} disabled={!!busy || !time} onPress={custom} />
      </View>
      {tomorrow && <Button title={`Tomorrow, first (${formatTime(tomorrow.start, tz)})`} variant="ghost" busy={busy === 'tomorrow'} disabled={!!busy} onPress={() => confirm('tomorrow', tomorrow.start)} />}
      {match.time_locked && <Button title="Clear set time" variant="ghost" busy={busy === 'clear'} disabled={!!busy} onPress={() => confirm('clear', null)} />}
      <ErrorText message={error} />
    </View>
  );
}

/** The end of the day: run late so the rest plays tonight, or stop and move it to tomorrow. */
export function EndOfDayCard({ data }: { data: TournamentData }) {
  const t = data.tournament;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!t) return null;
  const now = Date.now();
  const day = todayOf(t, now);
  const queued = data.matches.some((m) => !m.is_bye && (m.status === 'pending' || m.status === 'ready'));
  if (!day?.date || !queued) return null;
  const date = day.date;
  const tz = t.timezone;
  const own = t.day_hours?.[date];
  const preview = (hours?: DayHours | null) => {
    try {
      return previewDay(t, data.tgames, data.matches, date, hours, now, data.games.values());
    } catch {
      return null;
    }
  };
  const current = preview();
  if (!current) return null;
  const moving = (p: NonNullable<typeof current>) =>
    [p.later > 0 && `${plural(p.later)} ${p.later === 1 ? 'moves' : 'move'} to tomorrow`, p.beyond > 0 && `${plural(p.beyond)} ${p.beyond === 1 ? 'has' : 'have'} no day left`].filter(Boolean).join(', ') || 'nothing moves on';

  const apply = (key: string, title: string, end: string | null) => {
    const p = preview(end ? { ...own, end } : null);
    Alert.alert(title, p ? `${plural(p.today)} ${p.today === 1 ? 'plays' : 'play'} today, ${moving(p)}.` : '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'OK',
        onPress: async () => {
          setBusy(key);
          setError(null);
          try {
            await setDayHours(t, date, end ? { ...own, end } : null);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };
  const later = (minutes: number) => zonedClock(day.end + minutes * MINUTE, tz);

  return (
    <View style={[styles.card, { gap: 10, marginTop: 8 }]}>
      <Text style={styles.label}>End of day</Text>
      <Text style={styles.muted}>
        Today plays until {formatTime(day.end, tz)}
        {own ? ' (changed for today)' : ''}. {current.later + current.beyond === 0 ? 'Everything left fits.' : `${plural(current.today)} still ${current.today === 1 ? 'fits' : 'fit'}, ${moving(current)}.`}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Run 1 hour late" variant="ghost" style={{ flex: 1 }} busy={busy === 'late1'} disabled={!!busy} onPress={() => apply('late1', `Play until ${later(60)}?`, later(60))} />
        <Button title="Run 2 hours late" variant="ghost" style={{ flex: 1 }} busy={busy === 'late2'} disabled={!!busy} onPress={() => apply('late2', `Play until ${later(120)}?`, later(120))} />
      </View>
      {now < day.end && (
        <Button
          title="Stop for today, rest to tomorrow"
          variant="ghost"
          busy={busy === 'stop'}
          disabled={!!busy}
          onPress={() => apply('stop', 'Stop for today?', zonedClock(Math.max(now, day.start), tz))}
        />
      )}
      {own && <Button title="Back to the usual hours" variant="ghost" busy={busy === 'reset'} disabled={!!busy} onPress={() => apply('reset', 'Back to the usual hours?', null)} />}
      <ErrorText message={error} />
    </View>
  );
}
