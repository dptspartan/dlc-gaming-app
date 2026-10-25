import { describe, expect, it } from 'vitest';
import { describeSeries, legGameId, planStage, seriesFor, seriesMinutes } from './plan';

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
});
