import {
  generateGroupStage,
  groupStandings,
  knockoutFor,
  knockoutFromQualifiers,
  moveInQueue,
  qualifiers,
  seriesFor,
  timetableOptions,
  tournamentTimetable,
  withRoundLegs,
  type Game,
  type Match,
  type Slot,
  type StageMatchDraft,
  type StuckReason,
  type Team,
  type TimetableResult,
  type Tournament,
  type TournamentGame,
} from '@dlc/core';
import { refreshTimetable } from './actions';
import { rpc, supabase } from './supabase';

/**
 * Setting up a tournament from the phone: fixtures, legs, players and the
 * timetable order. Mirrors the web admin (apps/web/src/lib/admin.ts).
 */

const iso = (ms: number) => new Date(ms).toISOString();

async function must<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

/** Knockout rounds a game will play, the final included (the loser bracket doesn't count). */
function knockoutRoundsOf(matches: Pick<Match, 'stage' | 'round'>[]) {
  return Math.max(0, ...matches.filter((m) => m.stage === 'knockout').map((m) => m.round));
}

/** New matches, in the shape the timetable needs, each with its series from the game's plan. */
function queued(tg: TournamentGame, drafts: StageMatchDraft[]) {
  const rounds = knockoutRoundsOf(drafts);
  return drafts.map((d) => ({
    ...d,
    loser_next_match_id: d.loser_next_match_id ?? null,
    loser_next_slot: d.loser_next_slot ?? null,
    ...seriesFor(tg.plan, d, rounds),
    tournament_game_id: tg.id,
    station: null,
    stations: null,
    called_at: null,
    not_before: null,
    started_at: null,
    ended_at: null,
  }));
}

function slotsFor<T extends { id: string }>(rows: T[], result: TimetableResult) {
  const slotOf = new Map(result.slots.map((s) => [s.id, s]));
  return rows.map((d) => {
    const s = slotOf.get(d.id);
    return { ...d, station: s?.station ?? null, stations: s?.stations ?? null, scheduled_start: s ? iso(s.start) : null, scheduled_end: s ? iso(s.end) : null };
  });
}

/** Save the timetable slots of existing matches (only queued ones change). */
async function saveSlots(result: TimetableResult, only?: Set<string>) {
  const items = result.slots
    .filter((s) => !only || only.has(s.id))
    .map((s) => ({ id: s.id, station: s.station, stations: s.stations, scheduled_start: iso(s.start), scheduled_end: iso(s.end) }));
  if (items.length) await rpc('update_schedule', { p_items: items });
}

/** How the queued matches fit, without saving anything; null when it can't be worked out. */
export function previewTimetable(tournament: Tournament, tgames: TournamentGame[], matches: Match[], catalog: Iterable<Game>): TimetableResult | null {
  try {
    return tournamentTimetable(matches, timetableOptions(tournament, tgames, Date.now(), catalog), tournament.auto_times);
  } catch {
    return null;
  }
}

/** Re-apply a game's plan to its matches that have not started, then rebuild the timetable. */
export async function applyPlan(tg: TournamentGame, matches: Match[]) {
  const own = matches.filter((m) => m.tournament_game_id === tg.id);
  const rounds = knockoutRoundsOf(own);
  const items = own
    .filter((m) => !m.is_bye && (m.status === 'pending' || m.status === 'ready' || m.status === 'called'))
    .map((m) => ({ id: m.id, ...seriesFor(tg.plan, m, rounds) }));
  if (items.length) await rpc('set_series', { p_items: items });
  await refreshTimetable(tg.tournament_id);
}

/** Set how many legs the round `m` is in plays, save it in the game's plan and re-plan the matches not started. */
export async function setRoundLegs(tg: TournamentGame, matches: Match[], m: Pick<Match, 'stage' | 'round' | 'round_code'>, bestOf: number) {
  const plan = withRoundLegs(tg.plan, m, knockoutRoundsOf(matches.filter((x) => x.tournament_game_id === tg.id)), bestOf);
  await must(supabase.from('tournament_games').update({ plan }).eq('id', tg.id));
  await applyPlan({ ...tg, plan }, matches);
}

/**
 * Build the fixtures for one game and fit them into the tournament timetable
 * next to the other games. A knockout game gets its bracket; a group game gets
 * its groups and round-robin matches, and its knockout is built later.
 */
export async function generateFixtures(
  tournament: Tournament,
  tgames: TournamentGame[],
  tg: TournamentGame,
  teams: Team[],
  allMatches: Match[],
  catalog: Iterable<Game>,
): Promise<TimetableResult> {
  const entrants = teams.map((t) => ({ teamId: t.id, seed: t.seed }));
  const others = allMatches.filter((m) => m.tournament_game_id !== tg.id);
  let drafts: StageMatchDraft[];
  let groups: { team_id: string; group_no: number }[] | undefined;
  if (tg.format === 'groups') {
    const stage = generateGroupStage(entrants, tg.group_count);
    drafts = stage.matches;
    groups = [...stage.groups].map(([team_id, group_no]) => ({ team_id, group_no }));
  } else {
    drafts = knockoutFor(entrants, { double: tg.plan?.double_elim });
  }
  const rows = queued(tg, drafts);
  const result = tournamentTimetable([...others, ...rows], timetableOptions(tournament, tgames, Date.now(), catalog), tournament.auto_times);
  await rpc('replace_bracket', { p_tournament_game_id: tg.id, p_matches: slotsFor(rows, result), p_groups: groups ?? null });
  await saveSlots(result, new Set(others.map((m) => m.id)));
  return result;
}

/** Who goes through from the group tables, best first. */
export function groupQualifiers(tg: TournamentGame, teams: Team[], matches: Match[]) {
  const name = new Map(teams.map((t) => [t.id, t.name]));
  return qualifiers(groupStandings(teams, matches), tg.advance_per_group, tg.wildcards, (id) => name.get(id) ?? '');
}

/** Build (or rebuild) a group game's knockout from the finished group tables. */
export async function buildKnockout(
  tournament: Tournament,
  tgames: TournamentGame[],
  tg: TournamentGame,
  teams: Team[],
  allMatches: Match[],
  catalog: Iterable<Game>,
): Promise<TimetableResult> {
  const own = allMatches.filter((m) => m.tournament_game_id === tg.id);
  const through = groupQualifiers(tg, teams, own);
  if (through.length < 2) throw new Error('At least two teams need to go through to play a knockout');
  const rows = queued(tg, knockoutFromQualifiers(through, { double: tg.plan?.double_elim }));
  const keep = allMatches.filter((m) => m.tournament_game_id !== tg.id || m.stage === 'group');
  const result = tournamentTimetable([...keep, ...rows], timetableOptions(tournament, tgames, Date.now(), catalog), tournament.auto_times);
  await rpc('replace_bracket', { p_tournament_game_id: tg.id, p_matches: slotsFor(rows, result), p_stage: 'knockout' });
  await saveSlots(result, new Set(keep.map((m) => m.id)));
  return result;
}

/**
 * Move a queued match one place earlier or later in the timetable, then
 * rebuild the timetable around it. Throws, saying why, when it can't move.
 */
export async function moveMatch(
  tournament: Tournament,
  tgames: TournamentGame[],
  matches: Match[],
  id: string,
  direction: 'earlier' | 'later',
  catalog: Iterable<Game>,
  teamName: (id: string) => string,
): Promise<TimetableResult> {
  const moved = moveInQueue(matches, timetableOptions(tournament, tgames, Date.now(), catalog), id, direction);
  if ('stuck' in moved) throw new Error(stuckMessage(moved.stuck, direction, teamName));
  await must(supabase.from('matches').update({ queue_key: moved.key }).eq('id', id));
  for (const [matchId, notBefore] of moved.notBefore) await must(supabase.from('matches').update({ not_before: notBefore }).eq('id', matchId));
  await saveSlots(moved.result);
  return moved.result;
}

function stuckMessage(stuck: StuckReason, direction: 'earlier' | 'later', teamName: (id: string) => string): string {
  const head = `This match can't go any ${direction}`;
  switch (stuck.kind) {
    case 'edge':
      return direction === 'earlier' ? `${head}: it's already the first match.` : `${head}: nothing after it can take its place.`;
    case 'round':
      return `${head}: it waits for the earlier round of its game to finish.`;
    case 'team':
      return `${head}: ${teamName(stuck.teamId)} is still playing in the match before it.`;
    case 'station':
      return `${head}: its fixtures sheet puts it on station ${stuck.station}, which is busy until then.`;
    case 'set_time':
      return `${head}: it has a set time. Use Reschedule to change or clear it.`;
    default:
      return `${head}: no other match can swap places with it.`;
  }
}

async function thenReflow<T>(tournamentId: string, action: Promise<T>): Promise<T> {
  const out = await action;
  await refreshTimetable(tournamentId).catch(() => undefined);
  return out;
}

/** Put a player into one side of a match that has not started (a late sign-up, or a swap with a player still waiting). */
export const replacePlayer = (m: Pick<Match, 'id' | 'tournament_id'>, slot: Slot, teamId: string) =>
  thenReflow(m.tournament_id, rpc('replace_player', { p_match_id: m.id, p_slot: slot, p_team_id: teamId }));
/** Take a player out of a game after the fixtures are out; their matches go to the replacement, or wait with an empty side. */
export const withdrawPlayer = (tournamentId: string, teamId: string, replacementId: string | null) =>
  thenReflow(tournamentId, rpc('withdraw_player', { p_team_id: teamId, p_replacement_id: replacementId }));
export const swapSlots = (a: { matchId: string; slot: Slot }, b: { matchId: string; slot: Slot }) =>
  rpc('swap_slots', { p_match_a: a.matchId, p_slot_a: a.slot, p_match_b: b.matchId, p_slot_b: b.slot });

export const listAdmins = async () => (await rpc('list_admins', {})) as { user_id: string; email: string }[];

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
