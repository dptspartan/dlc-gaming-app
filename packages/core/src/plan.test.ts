import { describe, expect, it } from 'vitest';
import { describeSeries, legGameId, planStage, roundKey, seriesFor, seriesMinutes, withRoundLegs } from './plan';

const plan = { group: { best_of: 1 }, knockout: { best_of: 3 }, final: { best_of: 3, games: ['fifa', 'tekken', null] } };

describe('stage plan', () => {
  it('finds the stage of a match', () => {
    expect(planStage({ stage: 'group', round: 2 }, 3)).toBe('group');
    expect(planStage({ stage: 'knockout', round: 1 }, 3)).toBe('knockout');
    expect(planStage({ stage: 'knockout', round: 2 }, 3)).toBe('semi');
    expect(planStage({ stage: 'knockout', round: 3 }, 3)).toBe('final');
    expect(planStage({ stage: 'knockout', round: 1 }, 1)).toBe('final');
  });

  it('gives each match its series; semis follow the knockout rule', () => {
    expect(seriesFor(plan, { stage: 'group', round: 1 }, 3)).toEqual({ best_of: 1, leg_games: null });
    expect(seriesFor(plan, { stage: 'knockout', round: 2 }, 3)).toEqual({ best_of: 3, leg_games: null });
    expect(seriesFor(plan, { stage: 'knockout', round: 3 }, 3)).toEqual({ best_of: 3, leg_games: ['fifa', 'tekken', null] });
    expect(seriesFor({}, { stage: 'knockout', round: 3 }, 3)).toEqual({ best_of: 1, leg_games: null });
    // Even lengths are not a series.
    expect(seriesFor({ final: { best_of: 2 } }, { stage: 'knockout', round: 1 }, 1).best_of).toBe(1);
  });

  it('plays each leg on its game and sizes the series', () => {
    const m = { best_of: 3, leg_games: ['fifa', 'tekken', null] };
    expect([0, 1, 2].map((i) => legGameId(m, i, 'own'))).toEqual(['fifa', 'tekken', 'own']);
    const games = new Map([
      ['fifa', { default_match_minutes: 15 }],
      ['tekken', { default_match_minutes: 10 }],
    ]);
    expect(seriesMinutes(m, { game_id: 'own', match_minutes: 12 }, games)).toBe(15 + 10 + 12);
    expect(describeSeries(m, 'own', (id) => id.toUpperCase())).toBe('Best of 3: FIFA, TEKKEN, OWN');
    expect(describeSeries({ best_of: 5, leg_games: null }, 'own', String)).toBe('Best of 5');
  });

  it('names each round the same way however the bracket was made', () => {
    expect([1, 2, 3, 4, 5].map((round) => roundKey({ stage: 'knockout', round }, 5))).toEqual(['R32', 'R16', 'QF', 'SF', 'F']);
    expect(roundKey({ stage: 'knockout', round: 1, round_code: 'PRE' }, 6)).toBe('PRE');
    expect(roundKey({ stage: 'losers', round: 2 }, 4)).toBe('L2');
    expect(roundKey({ stage: 'group', round: 2 }, 4)).toBeNull();
  });

  it('lets a round play its own series and leaves the rest alone', () => {
    const own = { ...plan, rounds: { QF: { best_of: 5 }, L1: { best_of: 3 } } };
    expect(seriesFor(own, { stage: 'knockout', round: 2 }, 4).best_of).toBe(5);
    expect(seriesFor(own, { stage: 'knockout', round: 1, round_code: 'QF' }, 6).best_of).toBe(5);
    expect(seriesFor(own, { stage: 'knockout', round: 1 }, 4).best_of).toBe(3);
    expect(seriesFor(own, { stage: 'losers', round: 1 }, 4).best_of).toBe(3);
    expect(seriesFor({ rounds: { L1: { best_of: 5 } } }, { stage: 'losers', round: 1 }, 4).best_of).toBe(5);
    // Semis and the final keep their stage rule.
    expect(seriesFor({ rounds: { SF: { best_of: 5 }, F: { best_of: 5 } } }, { stage: 'knockout', round: 4 }, 4).best_of).toBe(1);
    // An old plan with no rounds plays exactly as before.
    expect(seriesFor(plan, { stage: 'knockout', round: 2 }, 4)).toEqual({ best_of: 3, leg_games: null });
  });

  it('sets the legs of the round a match is in', () => {
    expect(withRoundLegs(plan, { stage: 'knockout', round: 2 }, 4, 5).rounds).toEqual({ QF: { best_of: 5 } });
    expect(withRoundLegs(plan, { stage: 'knockout', round: 3 }, 4, 5).semi).toEqual({ best_of: 5 });
    expect(withRoundLegs(plan, { stage: 'knockout', round: 4 }, 4, 1).final).toEqual({ best_of: 1, games: ['fifa'] });
    expect(withRoundLegs(plan, { stage: 'group', round: 2 }, 4, 3).group).toEqual({ best_of: 3 });
    expect(withRoundLegs(plan, { stage: 'knockout', round: 2 }, 4, 5).knockout).toEqual({ best_of: 3 });
  });
});
