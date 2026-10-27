import type { Match, Slot } from './types';

type LineupMatch = Pick<
  Match,
  'id' | 'tournament_game_id' | 'team_a_id' | 'team_b_id' | 'winner_id' | 'status' | 'is_bye' | 'next_match_id' | 'next_slot' | 'loser_next_match_id' | 'loser_next_slot' | 'match_code'
>;

/**
 * Where a player stands in their game's fixtures, for line-up changes:
 * free (in no match yet, e.g. a late sign-up), waiting (one match, not
 * started) or playing (has played, is playing or plays more than one match).
 */
export type Placement = { kind: 'free' } | { kind: 'waiting'; match: LineupMatch } | { kind: 'playing'; match: LineupMatch };

export function placementOf(teamId: string, tournamentGameId: string, matches: Iterable<LineupMatch>): Placement {
  const own = [...matches].filter((m) => m.tournament_game_id === tournamentGameId && [m.team_a_id, m.team_b_id, m.winner_id].includes(teamId));
  if (!own.length) return { kind: 'free' };
  const [first] = own;
  if (own.length === 1 && !first.is_bye && (first.status === 'pending' || first.status === 'ready')) return { kind: 'waiting', match: first };
  return { kind: 'playing', match: own.find((m) => m.status !== 'completed') ?? first };
}

/** The earlier match whose result fills this side of a match, if any (its place can't be handed out). */
export function feederOf(match: Pick<Match, 'id'>, slot: Slot, matches: Iterable<LineupMatch>): LineupMatch | undefined {
  for (const m of matches) {
    if ((m.next_match_id === match.id && m.next_slot === slot) || (m.loser_next_match_id === match.id && m.loser_next_slot === slot)) return m;
  }
  return undefined;
}

/** Players can change in a match that is not a bye and has not started. */
export const lineupEditable = (m: Pick<Match, 'status' | 'is_bye'>) => !m.is_bye && (m.status === 'pending' || m.status === 'ready' || m.status === 'called');
