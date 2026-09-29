import type { Game } from './types';

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
