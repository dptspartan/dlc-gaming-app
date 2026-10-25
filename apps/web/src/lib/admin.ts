import {
  generateGroupStage,
  groupStandings,
  knockoutFor,
  knockoutFromQualifiers,
  qualifiers,
  scheduleTournament,
  seriesFor,
  timetableOptions,
  type Game,
  type Match,
  type Slot,
  type StageMatchDraft,
  type Team,
  type TimetableMatch,
  type TimetableResult,
  type Tournament,
  type TournamentGame,
} from '@dlc/core';
import { must, supabase } from './supabase';

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

const iso = (ms: number) => new Date(ms).toISOString();

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

/** Knockout rounds a game will play, the final included (the loser bracket doesn't count). */
function knockoutRoundsOf(matches: Pick<Match, 'stage' | 'round'>[]) {
  return Math.max(0, ...matches.filter((m) => m.stage === 'knockout').map((m) => m.round));
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

/**
 * Build the fixtures for one game and fit them into the tournament timetable
 * next to the other games (whose queued matches move to make room).
 * A knockout game gets its bracket (random pairs unless seeded); a group game
 * gets its groups and round-robin matches, and its knockout is built later.
 */
export async function generateFixtures(
  tournament: Tournament,
  tgames: TournamentGame[],
  tg: TournamentGame,
  teams: Team[],
  allMatches: Match[],
  catalog?: Iterable<Game>,
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
  const result = scheduleTournament([...others, ...rows], timetableOptions(tournament, tgames, Date.now(), catalog));
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
  catalog?: Iterable<Game>,
): Promise<TimetableResult> {
  const own = allMatches.filter((m) => m.tournament_game_id === tg.id);
  const through = groupQualifiers(tg, teams, own);
  if (through.length < 2) throw new Error('At least two teams need to go through to play a knockout');
  const rows = queued(tg, knockoutFromQualifiers(through, { double: tg.plan?.double_elim }));
  const keep = allMatches.filter((m) => m.tournament_game_id !== tg.id || m.stage === 'group');
  const result = scheduleTournament([...keep, ...rows], timetableOptions(tournament, tgames, Date.now(), catalog));
  await rpc('replace_bracket', { p_tournament_game_id: tg.id, p_matches: slotsFor(rows, result), p_stage: 'knockout' });
  await saveSlots(result, new Set(keep.map((m) => m.id)));
  return result;
}

/** Rebuild the whole timetable from now: every queued match gets a station and a time. */
export async function reflowTournament(tournament: Tournament, tgames: TournamentGame[], matches: TimetableMatch[], catalog?: Iterable<Game>): Promise<TimetableResult> {
  const result = scheduleTournament(matches, timetableOptions(tournament, tgames, Date.now(), catalog));
  await saveSlots(result);
  return result;
}

/** Fetch the latest state and rebuild the timetable; run after anything changes the queue. */
export async function refreshTimetable(tournamentId: string): Promise<TimetableResult> {
  const [tournament, tgames, matches, games] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', tournamentId).single().then(must),
    supabase.from('tournament_games').select('*').eq('tournament_id', tournamentId).then(must),
    supabase.from('matches').select('*').eq('tournament_id', tournamentId).then(must),
    supabase.from('games').select('*').then(must),
  ]);
  return reflowTournament(tournament as Tournament, tgames as TournamentGame[], matches as Match[], games as Game[]);
}

/** How the queued matches fit, without saving anything. */
export function previewTimetable(tournament: Tournament, tgames: TournamentGame[], matches: TimetableMatch[], catalog?: Iterable<Game>): TimetableResult {
  return scheduleTournament(matches, timetableOptions(tournament, tgames, Date.now(), catalog));
}

/** Run a match action, then rebuild the timetable so the queue moves on. */
async function thenReflow<T>(tournamentId: string, action: Promise<T>): Promise<T> {
  const out = await action;
  try {
    await refreshTimetable(tournamentId);
  } catch {
    // The action itself worked; the timetable catches up on the next change.
  }
  return out;
}

export const callMatch = (m: Pick<Match, 'id' | 'tournament_id'>, station: number) =>
  thenReflow(m.tournament_id, rpc('call_match', { p_match_id: m.id, p_station: station }));
/** Back to the queue; a delay keeps it out of the way so the next match goes first. */
export const uncallMatch = (m: Pick<Match, 'id' | 'tournament_id'>, delayMinutes = 0) =>
  thenReflow(m.tournament_id, rpc('uncall_match', { p_match_id: m.id, p_delay_minutes: delayMinutes }));
export const holdMatch = (m: Pick<Match, 'id' | 'tournament_id'>, until: Date | null) =>
  thenReflow(m.tournament_id, rpc('hold_match', { p_match_id: m.id, p_not_before: until?.toISOString() ?? null }));
export const listAdmins = async () => (await rpc('list_admins', {})) as { user_id: string; email: string }[];

type MatchRef = Pick<Match, 'id' | 'tournament_id'>;
export const startMatch = (m: MatchRef) => thenReflow(m.tournament_id, rpc('start_match', { p_match_id: m.id }));
/**
 * End the leg being played (the match, for a single game); the series ends
 * once a side has won most legs. Scored legs pick the winner from the score.
 * A walkover hands the whole series to the winner.
 */
export const endMatch = (m: MatchRef, winnerId: string | null = null, walkover = false) =>
  thenReflow(m.tournament_id, rpc('end_match', { p_match_id: m.id, p_winner_id: winnerId, p_walkover: walkover }));
/** A best-of match ends by itself on the deciding round; the queue moves on then. */
export async function scorePoint(m: MatchRef, side: 'a' | 'b', delta: 1 | -1) {
  const out = (await rpc('score_point', { p_match_id: m.id, p_side: side, p_delta: delta })) as Match;
  if (out?.status === 'completed') await refreshTimetable(m.tournament_id).catch(() => undefined);
  return out;
}
export const reopenMatch = (m: MatchRef) => thenReflow(m.tournament_id, rpc('reopen_match', { p_match_id: m.id }));
export const swapSlots = (a: { matchId: string; slot: Slot }, b: { matchId: string; slot: Slot }) =>
  rpc('swap_slots', { p_match_a: a.matchId, p_slot_a: a.slot, p_match_b: b.matchId, p_slot_b: b.slot });

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
