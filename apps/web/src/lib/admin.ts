import {
  generateBracket,
  scheduleMatches,
  tournamentWindows,
  type Match,
  type ScheduleResult,
  type Slot,
  type Team,
  type Tournament,
  type TournamentGame,
} from '@dlc/core';
import { supabase } from './supabase';

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Build the bracket for one game, give every match a slot, and save it. */
export async function generateFixtures(tournament: Tournament, tg: TournamentGame, teams: Team[]): Promise<ScheduleResult> {
  const drafts = generateBracket(teams.map((t) => ({ teamId: t.id, seed: t.seed })));
  const schedule = scheduleMatches(drafts, {
    windows: tournamentWindows(tournament),
    matchMinutes: tg.match_minutes,
    bufferMinutes: tg.buffer_minutes,
    stations: tg.stations,
  });
  const slotOf = new Map(schedule.slots.map((s) => [s.id, s]));
  const payload = drafts.map((d) => {
    const s = slotOf.get(d.id);
    return {
      ...d,
      station: s?.station ?? null,
      scheduled_start: s ? iso(s.start) : null,
      scheduled_end: s ? iso(s.end) : null,
    };
  });
  await rpc('replace_bracket', { p_tournament_game_id: tg.id, p_matches: payload });
  return schedule;
}

/** Recompute times for matches that have not started, from now on. */
export async function reflowSchedule(tournament: Tournament, tg: TournamentGame, matches: Match[]): Promise<ScheduleResult> {
  const schedule = scheduleMatches(matches, {
    windows: tournamentWindows(tournament),
    matchMinutes: tg.match_minutes,
    bufferMinutes: tg.buffer_minutes,
    stations: tg.stations,
    now: Date.now(),
  });
  await rpc('update_schedule', {
    p_items: schedule.slots.map((s) => ({ id: s.id, station: s.station, scheduled_start: iso(s.start), scheduled_end: iso(s.end) })),
  });
  return schedule;
}

/** Preview how the current fixtures fit without saving anything. */
export function previewSchedule(tournament: Tournament, tg: TournamentGame, matches: Match[]): ScheduleResult {
  return scheduleMatches(matches, {
    windows: tournamentWindows(tournament),
    matchMinutes: tg.match_minutes,
    bufferMinutes: tg.buffer_minutes,
    stations: tg.stations,
  });
}

export const startMatch = (id: string) => rpc('start_match', { p_match_id: id });
/** Scored games pick the winner from the score, so they pass no winner. */
export const endMatch = (id: string, winnerId: string | null = null) => rpc('end_match', { p_match_id: id, p_winner_id: winnerId });
export const scorePoint = (id: string, side: 'a' | 'b', delta: 1 | -1) => rpc('score_point', { p_match_id: id, p_side: side, p_delta: delta });
export const reopenMatch = (id: string) => rpc('reopen_match', { p_match_id: id });
export const swapSlots = (a: { matchId: string; slot: Slot }, b: { matchId: string; slot: Slot }) =>
  rpc('swap_slots', { p_match_a: a.matchId, p_slot_a: a.slot, p_match_b: b.matchId, p_slot_b: b.slot });

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
