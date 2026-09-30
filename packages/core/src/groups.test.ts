import { describe, expect, it } from 'vitest';
import { assignGroups, describeGroupSetup, generateGroupStage, groupStandings, knockoutFromQualifiers, qualifiers, roundRobin } from './groups';
import { scheduleMatches } from './schedule';
import type { Match } from './types';

const entrants = (n: number) => Array.from({ length: n }, (_, i) => ({ teamId: `t${i + 1}`, seed: i + 1 }));
let counter = 0;
const newId = () => `g${++counter}`;

describe('roundRobin', () => {
  it.each([2, 3, 4, 5, 6])('pairs every team with every other exactly once (%i teams)', (n) => {
    const ids = Array.from({ length: n }, (_, i) => `t${i}`);
    const days = roundRobin(ids);
    const pairs = days.flat().map(([a, b]) => [a, b].sort().join('-'));
    expect(pairs).toHaveLength((n * (n - 1)) / 2);
    expect(new Set(pairs).size).toBe(pairs.length);
    // Nobody plays twice on one matchday.
    for (const day of days) expect(new Set(day.flat()).size).toBe(day.length * 2);
  });
});

describe('assignGroups', () => {
  it('spreads top seeds across groups and keeps sizes within one', () => {
    const groups = assignGroups(entrants(10), 3);
    expect([1, 2, 3].map((g) => [...groups.values()].filter((x) => x === g).length).sort()).toEqual([3, 3, 4]);
    expect(new Set(['t1', 't2', 't3'].map((t) => groups.get(t))).size).toBe(3);
  });
  it('refuses groups that are too small', () => {
    expect(() => assignGroups(entrants(5), 3)).toThrow();
  });
});

describe('group stage to knockout', () => {
  it('ranks by wins, then score difference, and seeds group winners first', () => {
    const { groups, matches } = generateGroupStage(entrants(9), 3, { newId });
    expect(matches).toHaveLength(9); // three groups of three: 3 matches each
    const teams = [...groups].map(([id, g]) => ({ id, name: id, group_no: g }));
    // The lower team number always wins; the margin grows with the gap.
    const played = matches.map((m) => {
      const a = Number(m.team_a_id!.slice(1));
      const b = Number(m.team_b_id!.slice(1));
      const aWins = a < b;
      return {
        ...m,
        status: 'completed' as const,
        winner_id: aWins ? m.team_a_id : m.team_b_id,
        score_a: aWins ? 1 + Math.abs(a - b) : 0,
        score_b: aWins ? 0 : 1 + Math.abs(a - b),
      };
    });
    const table = groupStandings(teams, played);
    expect([...table.keys()]).toEqual([1, 2, 3]);
    for (const list of table.values()) {
      expect(list.map((r) => r.won)).toEqual([2, 1, 0]);
      expect(list[0].played).toBe(2);
    }
    // 3 group winners + 1 wildcard = 4-team knockout, no byes.
    const through = qualifiers(table, 1, 1);
    expect(through).toHaveLength(4);
    expect(through.slice(0, 3).sort()).toEqual(['t1', 't2', 't3']);
    const ko = knockoutFromQualifiers(through, { newId });
    expect(ko).toHaveLength(3);
    expect(ko.every((m) => m.stage === 'knockout')).toBe(true);
    expect(ko.filter((m) => m.is_bye)).toHaveLength(0);
  });

  it('gives byes when the qualifiers are not a power of two', () => {
    const ko = knockoutFromQualifiers(['a', 'b', 'c', 'd', 'e', 'f'], { newId });
    expect(ko.filter((m) => m.is_bye)).toHaveLength(2);
    expect(describeGroupSetup(9, 3, 2, 0)).toContain('2 byes');
  });
});

describe('scheduleMatches with teams', () => {
  it('never books a team into two overlapping group matches', () => {
    const { matches } = generateGroupStage(entrants(4), 1, { newId });
    const start = Date.UTC(2026, 0, 1, 10);
    const r = scheduleMatches(matches as unknown as Match[], {
      windows: [{ day: 1, start, end: start + 12 * 3600_000 }],
      matchMinutes: 10,
      bufferMinutes: 0,
      stations: 4,
    });
    const byId = new Map(matches.map((m) => [m.id, m]));
    for (const a of r.slots) {
      for (const b of r.slots) {
        if (a.id >= b.id) continue;
        const ma = byId.get(a.id)!;
        const mb = byId.get(b.id)!;
        const shared = [ma.team_a_id, ma.team_b_id].some((t) => t === mb.team_a_id || t === mb.team_b_id);
        if (shared) expect(a.end <= b.start || b.end <= a.start).toBe(true);
      }
    }
  });
});
