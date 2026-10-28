import { timetableOptions, tournamentTimetable, type DayHours, type Game, type Match, type Tournament, type TournamentGame } from '@dlc/core';
import { rpc, supabase } from './supabase';

type MatchRef = Pick<Match, 'id' | 'tournament_id'>;

/** Give every queued match a station and a time again, from now. Runs after anything moves the queue. */
export async function refreshTimetable(tournamentId: string) {
  const [t, tg, m, g] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', tournamentId).single(),
    supabase.from('tournament_games').select('*').eq('tournament_id', tournamentId),
    supabase.from('matches').select('*').eq('tournament_id', tournamentId),
    supabase.from('games').select('*'),
  ]);
  const err = t.error ?? tg.error ?? m.error ?? g.error;
  if (err) throw new Error(err.message);
  const tournament = t.data as Tournament;
  const result = tournamentTimetable(m.data as Match[], timetableOptions(tournament, tg.data as TournamentGame[], Date.now(), g.data as Game[]), tournament.auto_times);
  const iso = (ms: number) => new Date(ms).toISOString();
  const items = result.slots.map((s) => ({ id: s.id, station: s.station, stations: s.stations, scheduled_start: iso(s.start), scheduled_end: iso(s.end) }));
  if (items.length) await rpc('update_schedule', { p_items: items });
  return result;
}

async function thenReflow<T>(tournamentId: string, action: Promise<T>): Promise<T> {
  const out = await action;
  // The action itself worked; the timetable catches up on the next change if this fails.
  await refreshTimetable(tournamentId).catch(() => undefined);
  return out;
}

export const callMatch = (m: MatchRef, station: number) => thenReflow(m.tournament_id, rpc('call_match', { p_match_id: m.id, p_station: station }));
/** Back to the queue; a delay lets the next match go first. */
export const uncallMatch = (m: MatchRef, delayMinutes = 0) =>
  thenReflow(m.tournament_id, rpc('uncall_match', { p_match_id: m.id, p_delay_minutes: delayMinutes }));
/** Keep a queued match back until a time (null lets it go again). */
export const holdMatch = (m: MatchRef, until: Date | null) =>
  thenReflow(m.tournament_id, rpc('hold_match', { p_match_id: m.id, p_not_before: until?.toISOString() ?? null }));
export const startMatch = (m: MatchRef) => thenReflow(m.tournament_id, rpc('start_match', { p_match_id: m.id }));
/** Ends the leg being played (the match, for a single game); a walkover hands over the whole series. */
export const endMatch = (m: MatchRef, winnerId: string | null, walkover = false) =>
  thenReflow(m.tournament_id, rpc('end_match', { p_match_id: m.id, p_winner_id: winnerId, p_walkover: walkover }));
/** End a level score match (or leg) on penalties: the higher shoot-out score wins. */
export const endOnPenalties = (m: MatchRef, penA: number, penB: number) =>
  thenReflow(m.tournament_id, rpc('end_on_penalties', { p_match_id: m.id, p_pen_a: penA, p_pen_b: penB }));
export const reopenMatch = (m: MatchRef) => thenReflow(m.tournament_id, rpc('reopen_match', { p_match_id: m.id }));
/** Any amount in a score game (+50 kills), one round at a time in a rounds game. */
export async function scorePoint(m: MatchRef, side: 'a' | 'b', delta: number) {
  const out = (await rpc('score_point', { p_match_id: m.id, p_side: side, p_delta: delta })) as Match;
  if (out?.status === 'completed') await refreshTimetable(m.tournament_id).catch(() => undefined);
  return out;
}
/** Give a queued match a set start time (null: back to the usual order); the other matches move round it. */
export const rescheduleMatch = (m: MatchRef, at: Date | null) =>
  thenReflow(m.tournament_id, rpc('reschedule_match', { p_match_id: m.id, p_at: at?.toISOString() ?? null }));
/** Change one day's hours (null: back to the daily hours): run it late, or stop it early so the rest moves on. */
export async function setDayHours(t: Pick<Tournament, 'id' | 'day_hours'>, date: string, hours: DayHours | null) {
  const day_hours = { ...(t.day_hours ?? {}) };
  if (hours) day_hours[date] = hours;
  else delete day_hours[date];
  const { error } = await supabase.from('tournaments').update({ day_hours }).eq('id', t.id);
  if (error) throw new Error(error.message);
  await refreshTimetable(t.id);
}
