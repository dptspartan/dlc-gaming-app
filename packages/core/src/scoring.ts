import type { Game, Match } from './types';

/** Rounds a side must win to take a best-of match (3 of 5, 2 of 3, ...). */
export function roundsToWin(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

export function hasLiveScore(game: Pick<Game, 'scoring'> | undefined): boolean {
  return !!game && game.scoring !== 'none';
}

type ScoreRules = Pick<Game, 'scoring' | 'best_of'> & Partial<Pick<Game, 'score_label' | 'score_steps' | 'score_target' | 'low_wins' | 'penalties'>>;

/**
 * What one point of a game is called: "Goals", "Kills", "Rounds"... With `n`
 * of 1 it is singular ("Kill"), for "+1 Kill".
 */
export function scoreUnit(game: ScoreRules, n?: number): string {
  const label = game.score_label?.trim() || (game.scoring === 'rounds' ? 'Rounds' : 'Goals');
  return n === 1 && /[^s]s$/i.test(label) ? label.slice(0, -1) : label;
}

/** The amounts one tap adds, smallest first. A rounds game is always one round at a time. */
export function scoreSteps(game: ScoreRules): number[] {
  if (game.scoring !== 'goals') return [1];
  const steps = [...new Set((game.score_steps ?? []).filter((n) => Number.isInteger(n) && n > 0))].sort((x, y) => x - y);
  return steps.length ? steps : [1];
}

/** Whether a level score of this game can be settled on penalties. */
export function allowsPenalties(game: ScoreRules | undefined): boolean {
  return !!game && game.scoring === 'goals' && game.penalties !== false;
}

/** The side a score puts ahead (the lower one when lower wins), or null when level. */
export function leader(game: ScoreRules, a: number, b: number): 'a' | 'b' | null {
  if (a === b) return null;
  return (a > b) !== !!game.low_wins ? 'a' : 'b';
}

/** Short label for a game's scoring, e.g. "Best of 5", "Kills · first to 100", "Winner only". */
export function scoringLabel(game: ScoreRules): string {
  if (game.scoring === 'rounds') return `Best of ${game.best_of}${game.score_label?.trim() ? ` ${scoreUnit(game).toLowerCase()}` : ''}`;
  if (game.scoring === 'goals') {
    const extra = game.low_wins ? ' · lowest wins' : game.score_target ? ` · first to ${game.score_target}` : '';
    return scoreUnit(game) + extra;
  }
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
