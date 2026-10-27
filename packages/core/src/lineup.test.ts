import { describe, expect, it } from 'vitest';
import { feederOf, lineupEditable, placementOf } from './lineup';
import type { Match } from './types';

const m = (o: Partial<Match>): Match =>
  ({
    id: 'm',
    tournament_game_id: 'fc',
    team_a_id: null,
    team_b_id: null,
    winner_id: null,
    status: 'pending',
    is_bye: false,
    next_match_id: null,
    next_slot: null,
    loser_next_match_id: null,
    loser_next_slot: null,
    match_code: null,
    ...o,
  }) as Match;

const matches = [
  m({ id: 'pi1', team_a_id: 'x', team_b_id: 'y', winner_id: 'x', status: 'completed', next_match_id: 'r1', next_slot: 'a', match_code: 'FC-PI-01' }),
  m({ id: 'pi8', team_a_id: 'subhan', team_b_id: 'zammad', status: 'ready', next_match_id: 'r4', next_slot: 'a', match_code: 'FC-PI-08' }),
  m({ id: 'bye', team_a_id: 'b', winner_id: 'b', is_bye: true, status: 'completed', next_match_id: 'r1', next_slot: 'b' }),
  m({ id: 'r1', team_a_id: 'x', team_b_id: 'b', status: 'ready', match_code: 'FC-R32-01' }),
  m({ id: 'r4', match_code: 'FC-R32-04' }),
  m({ id: 'tk', tournament_game_id: 'tekken', team_a_id: 'saad', status: 'ready' }),
];

describe('placementOf', () => {
  it('finds a late sign-up free, even when they play another game', () => {
    expect(placementOf('saad', 'fc', matches)).toEqual({ kind: 'free' });
  });
  it('finds a player waiting for their only match', () => {
    expect(placementOf('subhan', 'fc', matches)).toMatchObject({ kind: 'waiting', match: { id: 'pi8' } });
  });
  it('counts a winner moving on, a loser and a bye as playing', () => {
    expect(placementOf('x', 'fc', matches)).toMatchObject({ kind: 'playing', match: { id: 'r1' } });
    expect(placementOf('y', 'fc', matches)).toMatchObject({ kind: 'playing', match: { id: 'pi1' } });
    expect(placementOf('b', 'fc', matches)).toMatchObject({ kind: 'playing', match: { id: 'r1' } });
  });
});

describe('feederOf', () => {
  it('names the earlier match that fills a side', () => {
    expect(feederOf({ id: 'r4' }, 'a', matches)?.match_code).toBe('FC-PI-08');
    expect(feederOf({ id: 'r4' }, 'b', matches)).toBeUndefined();
    expect(feederOf({ id: 'pi8' }, 'a', matches)).toBeUndefined();
  });
});

describe('lineupEditable', () => {
  it('allows matches that have not started, but not byes', () => {
    expect(lineupEditable({ status: 'called', is_bye: false })).toBe(true);
    expect(lineupEditable({ status: 'live', is_bye: false })).toBe(false);
    expect(lineupEditable({ status: 'pending', is_bye: true })).toBe(false);
  });
});
