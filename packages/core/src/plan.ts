import { roundsToWin } from './scoring';
import type { Game, Match, SeriesRule, StagePlan, TournamentGame } from './types';

export type PlanStage = 'group' | 'knockout' | 'semi' | 'final' | 'losers';

/** Which part of the plan a match follows. In a double elimination the upper final follows the semi-final rule. */
export function planStage(m: Pick<Match, 'stage' | 'round'> & Partial<Pick<Match, 'round_code'>>, knockoutRounds: number): PlanStage {
  if (m.round_code) return m.round_code === 'F' ? 'final' : m.round_code === 'SF' ? 'semi' : 'knockout';
  if (m.stage === 'group') return 'group';
  if (m.stage === 'losers') return 'losers';
  if (m.round >= knockoutRounds) return 'final';
  if (m.round === knockoutRounds - 1) return 'semi';
  return 'knockout';
}

/**
 * The round a match belongs to, as a key for a per-round rule in the plan.
 * Uploaded rounds keep their code; generated knockout rounds are named by
 * how far they are from the final (F, SF, QF, R16, R32, R64...), so a
 * regenerated bracket keeps its rules; loser bracket rounds are L1, L2...
 * Group matches have no round key: the group rule covers them all.
 */
export function roundKey(m: Pick<Match, 'stage' | 'round'> & Partial<Pick<Match, 'round_code'>>, knockoutRounds: number): string | null {
  if (m.round_code) return m.round_code;
  if (m.stage === 'group') return null;
  if (m.stage === 'losers') return `L${m.round}`;
  const left = Math.max(0, knockoutRounds - m.round);
  return left === 0 ? 'F' : left === 1 ? 'SF' : left === 2 ? 'QF' : `R${2 ** (left + 1)}`;
}

/** The series a match plays: semis fall back to the knockout rule; everything else to a single game. */
export function seriesRule(plan: StagePlan | null | undefined, stage: PlanStage): SeriesRule {
  const rule = plan?.[stage] ?? (stage === 'semi' || stage === 'losers' ? plan?.knockout : undefined);
  const bestOf = rule?.best_of && rule.best_of % 2 === 1 ? rule.best_of : 1;
  return { best_of: bestOf, games: stage === 'final' ? rule?.games : undefined };
}

/**
 * The series a match plays. Knockout and loser bracket rounds can each have
 * their own rule (plan.rounds); semis and the final keep their stage rule.
 */
export function matchRule(plan: StagePlan | null | undefined, m: Pick<Match, 'stage' | 'round'> & Partial<Pick<Match, 'round_code'>>, knockoutRounds: number): SeriesRule {
  const stage = planStage(m, knockoutRounds);
  const own = stage === 'knockout' || stage === 'losers' ? plan?.rounds?.[roundKey(m, knockoutRounds) ?? ''] : undefined;
  return own?.best_of && own.best_of % 2 === 1 ? { best_of: own.best_of } : seriesRule(plan, stage);
}

/** best_of and leg games for a new or re-planned match. */
export function seriesFor(plan: StagePlan | null | undefined, m: Pick<Match, 'stage' | 'round'> & Partial<Pick<Match, 'round_code'>>, knockoutRounds: number) {
  const rule = matchRule(plan, m, knockoutRounds);
  const games = rule.games?.slice(0, rule.best_of);
  return { best_of: rule.best_of, leg_games: games?.some(Boolean) ? games : null };
}

/**
 * The plan with a new series length for the round a match is in: group
 * matches, semis and the final change their stage rule (the final keeps its
 * leg games), any other round gets its own rule.
 */
export function withRoundLegs(
  plan: StagePlan | null | undefined,
  m: Pick<Match, 'stage' | 'round'> & Partial<Pick<Match, 'round_code'>>,
  knockoutRounds: number,
  bestOf: number,
): StagePlan {
  const next: StagePlan = { ...plan };
  const stage = planStage(m, knockoutRounds);
  if (stage === 'final') next.final = { best_of: bestOf, games: plan?.final?.games?.slice(0, bestOf) };
  else if (stage === 'group' || stage === 'semi') next[stage] = { best_of: bestOf };
  else next.rounds = { ...plan?.rounds, [roundKey(m, knockoutRounds)!]: { best_of: bestOf } };
  return next;
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
