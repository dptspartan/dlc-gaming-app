import { scheduleTournament, timetableOptions, type Match, type Tournament, type TournamentGame } from '@dlc/core';
import { rpc, supabase } from './supabase';

type MatchRef = Pick<Match, 'id' | 'tournament_id'>;

/** Give every queued match a station and a time again, from now. Runs after anything moves the queue. */
export async function refreshTimetable(tournamentId: string) {
  const [t, tg, m] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', tournamentId).single(),
    supabase.from('tournament_games').select('*').eq('tournament_id', tournamentId),
    supabase.from('matches').select('*').eq('tournament_id', tournamentId),
  ]);
  const err = t.error ?? tg.error ?? m.error;
  if (err) throw new Error(err.message);
  const result = scheduleTournament(m.data as Match[], timetableOptions(t.data as Tournament, tg.data as TournamentGame[], Date.now()));
  const iso = (ms: number) => new Date(ms).toISOString();
  const items = result.slots.map((s) => ({ id: s.id, station: s.station, stations: s.stations, scheduled_start: iso(s.start), scheduled_end: iso(s.end) }));
  if (items.length) await rpc('update_schedule', { p_items: items });
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
export const endMatch = (m: MatchRef, winnerId: string | null) => thenReflow(m.tournament_id, rpc('end_match', { p_match_id: m.id, p_winner_id: winnerId }));
export const reopenMatch = (m: MatchRef) => thenReflow(m.tournament_id, rpc('reopen_match', { p_match_id: m.id }));
export async function scorePoint(m: MatchRef, side: 'a' | 'b', delta: 1 | -1) {
  const out = (await rpc('score_point', { p_match_id: m.id, p_side: side, p_delta: delta })) as Match;
  if (out?.status === 'completed') await refreshTimetable(m.tournament_id).catch(() => undefined);
  return out;
}
