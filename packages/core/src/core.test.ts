import { describe, expect, it } from 'vitest';
import { generateBracket, roundName, seedOrder, type MatchDraft } from './bracket';
import { findTeamConflicts, scheduleMatches } from './schedule';
import { tournamentWindows, zonedToUtc } from './time';
import { gridFor } from './layout';
import { roundsToWin, scoringLabel } from './scoring';

const teams = (n: number) => Array.from({ length: n }, (_, i) => ({ teamId: `t${i + 1}`, seed: i + 1 }));
let counter = 0;
const newId = () => `m${++counter}`;

/** Play every match with team A winning, the way end_match does. */
function playOut(matches: MatchDraft[]): string {
  const byId = new Map(matches.map((m) => [m.id, { ...m }]));
  const sorted = [...byId.values()].sort((a, b) => a.round - b.round || a.position - b.position);
  let champion = '';
  for (const m of sorted) {
    if (m.is_bye) continue;
    expect(m.team_a_id && m.team_b_id).toBeTruthy();
    const winner = m.team_a_id!;
    if (m.next_match_id) {
      const next = byId.get(m.next_match_id)!;
      if (m.next_slot === 'a') next.team_a_id = winner;
      else next.team_b_id = winner;
    } else champion = winner;
  }
  return champion;
}

describe('seedOrder', () => {
  it('pairs top seeds with bottom seeds', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
  });
});

describe('generateBracket', () => {
  it.each([2, 3, 5, 8, 13, 16])('builds a playable bracket for %i teams', (n) => {
    const matches = generateBracket(teams(n), { newId });
    const size = 2 ** Math.ceil(Math.log2(n));
    expect(matches).toHaveLength(size - 1);
    const finals = matches.filter((m) => !m.next_match_id);
    expect(finals).toHaveLength(1);
    expect(matches.filter((m) => m.is_bye)).toHaveLength(size - n);
    // Every team appears exactly once in round one.
    const r1 = matches.filter((m) => m.round === 1).flatMap((m) => [m.team_a_id, m.team_b_id]).filter(Boolean);
    expect(new Set(r1).size).toBe(n);
    expect(playOut(matches)).toBe('t1');
  });

  it('gives byes to the top seeds and moves them to round two', () => {
    const matches = generateBracket(teams(5), { newId });
    const byes = matches.filter((m) => m.is_bye);
    expect(byes.map((m) => m.winner_id).sort()).toEqual(['t1', 't2', 't3']);
    const r2 = matches.filter((m) => m.round === 2);
    expect(r2.flatMap((m) => [m.team_a_id, m.team_b_id]).filter(Boolean).sort()).toEqual(['t1', 't2', 't3']);
    expect(r2.filter((m) => m.status === 'ready')).toHaveLength(1);
  });

  it('rejects too few or duplicate teams', () => {
    expect(() => generateBracket(teams(1))).toThrow();
    expect(() => generateBracket([{ teamId: 'a' }, { teamId: 'a' }])).toThrow();
  });

  it('names rounds from the end', () => {
    expect(roundName(4, 4)).toBe('Final');
    expect(roundName(3, 4)).toBe('Semi-final');
    expect(roundName(2, 4)).toBe('Quarter-final');
    expect(roundName(1, 4)).toBe('Round 1');
  });
});

describe('time', () => {
  it('converts wall time in a zone to UTC', () => {
    expect(zonedToUtc('2026-10-01', '10:00', 'Asia/Karachi').toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(zonedToUtc('2026-07-01', '10:00', 'Europe/London').toISOString()).toBe('2026-07-01T09:00:00.000Z');
  });
});

describe('scheduleMatches', () => {
  const tournament = { start_date: '2026-10-01', days: 2, daily_start: '10:00', daily_end: '12:00', timezone: 'UTC' };
  const windows = tournamentWindows(tournament);

  it('respects rounds, stations and daily hours', () => {
    const matches = generateBracket(teams(8), { newId });
    const result = scheduleMatches(matches, { windows, matchMinutes: 30, bufferMinutes: 10, stations: 2 });
    expect(result.fits).toBe(true);
    const at = (id: string) => result.slots.find((s) => s.id === id)!;
    for (const m of matches) {
      if (!m.next_match_id) continue;
      expect(at(m.next_match_id).start).toBeGreaterThanOrEqual(at(m.id).end + 10 * 60_000);
    }
    // Four first-round matches on two stations: two waves.
    const r1 = matches.filter((m) => m.round === 1).map((m) => at(m.id));
    expect(new Set(r1.map((s) => s.start)).size).toBe(2);
    for (const s of result.slots) {
      const w = windows.find((w) => s.start >= w.start && s.end <= w.end);
      expect(w).toBeTruthy();
    }
  });

  it('rolls into the next day and reports overflow', () => {
    const matches = generateBracket(teams(16), { newId });
    const tight = scheduleMatches(matches, { windows, matchMinutes: 30, bufferMinutes: 0, stations: 1 });
    expect(tight.fits).toBe(false);
    expect(tight.overflowMinutes).toBeGreaterThan(0);
    const days = new Set(tight.slots.filter((s) => !s.overflow).map((s) => windows.findIndex((w) => s.start >= w.start && s.end <= w.end)));
    expect(days).toEqual(new Set([0, 1]));
  });

  it('skips byes and played matches when reflowing', () => {
    const matches = generateBracket(teams(3), { newId });
    const played = matches.map((m) => (m.round === 1 && !m.is_bye ? { ...m, status: 'completed' as const, ended_at: '2026-10-01T10:45:00Z' } : m));
    const result = scheduleMatches(played, { windows, matchMinutes: 30, bufferMinutes: 5, stations: 1, now: Date.parse('2026-10-01T10:40:00Z') });
    expect(result.slots).toHaveLength(1);
    expect(new Date(result.slots[0].start).toISOString()).toBe('2026-10-01T10:50:00.000Z');
  });
});

describe('findTeamConflicts', () => {
  it('flags overlapping slots for one team', () => {
    const base = { status: 'ready' as const, team_b_id: 'x' };
    const c = findTeamConflicts([
      { ...base, id: '1', team_a_id: 'a', scheduled_start: '2026-10-01T10:00:00Z', scheduled_end: '2026-10-01T10:30:00Z' },
      { ...base, id: '2', team_a_id: 'a', scheduled_start: '2026-10-01T10:20:00Z', scheduled_end: '2026-10-01T10:50:00Z', team_b_id: 'y' },
    ]);
    expect(c.map((x) => x.teamId).sort()).toEqual(['a']);
  });
});

describe('gridFor', () => {
  it('adapts to the number of live matches', () => {
    expect(gridFor(1).cols).toBe(1);
    expect(gridFor(2)).toMatchObject({ cols: 2, rows: 1 });
    expect(gridFor(4)).toMatchObject({ cols: 2, rows: 2 });
    expect(gridFor(5)).toMatchObject({ cols: 3, rows: 2 });
    expect(gridFor(12).pageSize).toBe(9);
  });
});

describe('scoring', () => {
  it('needs a majority of rounds to win a best-of match', () => {
    expect(roundsToWin(5)).toBe(3);
    expect(roundsToWin(3)).toBe(2);
    expect(roundsToWin(1)).toBe(1);
  });
  it('labels each scoring mode', () => {
    expect(scoringLabel({ scoring: 'rounds', best_of: 5 })).toBe('Best of 5');
    expect(scoringLabel({ scoring: 'goals', best_of: null })).toBe('Live score');
    expect(scoringLabel({ scoring: 'none', best_of: null })).toBe('Winner only');
  });
});
