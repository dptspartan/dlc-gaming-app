import {
  generateBracket,
  generateGroupStage,
  groupStandings,
  knockoutFromQualifiers,
  qualifiers,
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

const scheduleOptions = (tournament: Tournament, tg: TournamentGame, now?: number) => ({
  windows: tournamentWindows(tournament),
  matchMinutes: tg.match_minutes,
  bufferMinutes: tg.buffer_minutes,
  stations: tg.stations,
  now,
});

function withSlots<T extends { id: string }>(drafts: T[], schedule: ScheduleResult) {
  const slotOf = new Map(schedule.slots.map((s) => [s.id, s]));
  return drafts.map((d) => {
    const s = slotOf.get(d.id);
    return { ...d, station: s?.station ?? null, scheduled_start: s ? iso(s.start) : null, scheduled_end: s ? iso(s.end) : null };
  });
}

/**
 * Build the fixtures for one game, give every match a slot, and save them.
 * A knockout game gets its bracket (random pairs unless seeded); a group game
 * gets its groups and round-robin matches, and its knockout is built later
 * from the group tables.
 */
export async function generateFixtures(tournament: Tournament, tg: TournamentGame, teams: Team[]): Promise<ScheduleResult> {
  const entrants = teams.map((t) => ({ teamId: t.id, seed: t.seed }));
  if (tg.format === 'groups') {
    const { groups, matches } = generateGroupStage(entrants, tg.group_count);
    const schedule = scheduleMatches(matches, scheduleOptions(tournament, tg));
    await rpc('replace_bracket', {
      p_tournament_game_id: tg.id,
      p_matches: withSlots(matches, schedule),
      p_groups: [...groups].map(([team_id, group_no]) => ({ team_id, group_no })),
    });
    return schedule;
  }
  const drafts = generateBracket(entrants).map((d) => ({ ...d, stage: 'knockout' as const, group_no: null }));
  const schedule = scheduleMatches(drafts, scheduleOptions(tournament, tg));
  await rpc('replace_bracket', { p_tournament_game_id: tg.id, p_matches: withSlots(drafts, schedule) });
  return schedule;
}

/** Who goes through from the group tables, best first. */
export function groupQualifiers(tg: TournamentGame, teams: Team[], matches: Match[]) {
  const name = new Map(teams.map((t) => [t.id, t.name]));
  return qualifiers(groupStandings(teams, matches), tg.advance_per_group, tg.wildcards, (id) => name.get(id) ?? '');
}

/** Build (or rebuild) a group game's knockout from the finished group tables. */
export async function buildKnockout(tournament: Tournament, tg: TournamentGame, teams: Team[], matches: Match[]): Promise<ScheduleResult> {
  const through = groupQualifiers(tg, teams, matches);
  if (through.length < 2) throw new Error('At least two teams need to go through to play a knockout');
  const drafts = knockoutFromQualifiers(through);
  const lastGroupEnd = Math.max(0, ...matches.filter((m) => m.stage === 'group').map((m) => new Date(m.ended_at ?? m.scheduled_end ?? 0).getTime()));
  const schedule = scheduleMatches(drafts, scheduleOptions(tournament, tg, Math.max(Date.now(), lastGroupEnd)));
  await rpc('replace_bracket', { p_tournament_game_id: tg.id, p_matches: withSlots(drafts, schedule), p_stage: 'knockout' });
  return schedule;
}

/** Recompute times for matches that have not started, from now on. */
export async function reflowSchedule(tournament: Tournament, tg: TournamentGame, matches: Match[]): Promise<ScheduleResult> {
  const schedule = scheduleMatches(matches, scheduleOptions(tournament, tg, Date.now()));
  await rpc('update_schedule', {
    p_items: schedule.slots.map((s) => ({ id: s.id, station: s.station, scheduled_start: iso(s.start), scheduled_end: iso(s.end) })),
  });
  return schedule;
}

/** Preview how the current fixtures fit without saving anything. */
export function previewSchedule(tournament: Tournament, tg: TournamentGame, matches: Match[]): ScheduleResult {
  return scheduleMatches(matches, scheduleOptions(tournament, tg));
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
