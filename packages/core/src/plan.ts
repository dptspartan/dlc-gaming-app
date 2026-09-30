import { roundsToWin } from './scoring';
import type { Game, Match, SeriesRule, StagePlan, TournamentGame } from './types';

export type PlanStage = keyof StagePlan;

/** Which part of the plan a match follows. */
export function planStage(m: Pick<Match, 'stage' | 'round'>, knockoutRounds: number): PlanStage {
  if (m.stage === 'group') return 'group';
  if (m.round >= knockoutRounds) return 'final';
  if (m.round === knockoutRounds - 1) return 'semi';
  return 'knockout';
}

/** The series a match plays: semis fall back to the knockout rule; everything else to a single game. */
export function seriesRule(plan: StagePlan | null | undefined, stage: PlanStage): SeriesRule {
  const rule = plan?.[stage] ?? (stage === 'semi' ? plan?.knockout : undefined);
  const bestOf = rule?.best_of && rule.best_of % 2 === 1 ? rule.best_of : 1;
  return { best_of: bestOf, games: stage === 'final' ? rule?.games : undefined };
}

/** best_of and leg games for a new or re-planned match. */
export function seriesFor(plan: StagePlan | null | undefined, m: Pick<Match, 'stage' | 'round'>, knockoutRounds: number) {
  const rule = seriesRule(plan, planStage(m, knockoutRounds));
  const games = rule.games?.slice(0, rule.best_of);
  return { best_of: rule.best_of, leg_games: games?.some(Boolean) ? games : null };
}

/** Legs a side needs to win the series. */
export const legsToWin = (bestOf: number) => roundsToWin(Math.max(1, bestOf));

/** Game of a leg (0-based); defaults to the tournament game's own game. */
export function legGameId(m: Pick<Match, 'leg_games'>, leg: number, ownGameId: string): string {
  return m.leg_games?.[leg] ?? ownGameId;
}

/** The leg being played now (0-based). */
export const currentLeg = (m: Pick<Match, 'legs' | 'best_of'>) => Math.min(m.legs?.length ?? 0, Math.max(1, m.best_of) - 1);

export const isSeries = (m: Pick<Match, 'best_of'> | undefined) => (m?.best_of ?? 1) > 1;

/** Minutes a whole series can take: every leg, each at its game's length. */
export function seriesMinutes(
  m: Pick<Match, 'best_of' | 'leg_games'>,
  tg: Pick<TournamentGame, 'game_id' | 'match_minutes'>,
  games?: Map<string, Pick<Game, 'default_match_minutes'>>,
): number {
  let total = 0;
  for (let i = 0; i < Math.max(1, m.best_of ?? 1); i++) {
    const id = legGameId(m, i, tg.game_id);
    total += id === tg.game_id ? tg.match_minutes : games?.get(id)?.default_match_minutes ?? tg.match_minutes;
  }
  return total;
}

/** "Best of 3", with the games when the legs differ. */
export function describeSeries(m: Pick<Match, 'best_of' | 'leg_games'>, ownGameId: string, name: (gameId: string) => string): string {
  if ((m.best_of ?? 1) <= 1) return '';
  const ids = Array.from({ length: m.best_of }, (_, i) => legGameId(m, i, ownGameId));
  const mixed = ids.some((id) => id !== ownGameId);
  return mixed ? `Best of ${m.best_of}: ${ids.map(name).join(', ')}` : `Best of ${m.best_of}`;
}
