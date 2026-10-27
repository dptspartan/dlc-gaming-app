import type { Game, Match } from './types';

/** Rounds a side must win to take a best-of match (3 of 5, 2 of 3, ...). */
export function roundsToWin(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

export function hasLiveScore(game: Pick<Game, 'scoring'> | undefined): boolean {
  return !!game && game.scoring !== 'none';
}

/** Short label for a game's scoring, e.g. "Best of 5", "Goals", "Winner only". */
export function scoringLabel(game: Pick<Game, 'scoring' | 'best_of'>): string {
  if (game.scoring === 'rounds') return `Best of ${game.best_of}`;
  if (game.scoring === 'goals') return 'Live score';
  return 'Winner only';
}

/**
 * A result for display: "3–1", or "1–1 (4–3 pens)" when it went to penalties.
 * `winnerFirst` puts the winner's side first (results lists); otherwise side
 * A comes first. Empty when there is no score.
 */
export function scoreLine(
  m: Pick<Match, 'score_a' | 'score_b' | 'pen_a' | 'pen_b'> & Partial<Pick<Match, 'winner_id' | 'team_b_id'>>,
  winnerFirst = false,
): string {
  if (m.score_a == null || m.score_b == null) return '';
  const flip = winnerFirst && !!m.winner_id && m.winner_id === m.team_b_id;
  const [a, b] = flip ? [m.score_b, m.score_a] : [m.score_a, m.score_b];
  const pens = m.pen_a != null && m.pen_b != null ? (flip ? [m.pen_b, m.pen_a] : [m.pen_a, m.pen_b]) : null;
  return `${a}–${b}${pens ? ` (${pens[0]}–${pens[1]} pens)` : ''}`;
}
