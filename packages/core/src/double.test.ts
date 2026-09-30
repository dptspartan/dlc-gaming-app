import { describe, expect, it } from 'vitest';
import { generateDoubleElim } from './double';
import { knockoutRounds, matchLabel, type StageMatchDraft } from './groups';
import { planStage } from './plan';
import { scheduleTournament } from './timetable';

let counter = 0;
const newId = () => `m${++counter}`;
const teams = (n: number) => Array.from({ length: n }, (_, i) => ({ teamId: `t${i + 1}`, seed: i + 1 }));

/** Play the whole bracket the way the database does, the lower seed number always winning. */
function play(drafts: StageMatchDraft[]) {
  const byId = new Map(drafts.map((m) => [m.id, { ...m }]));
  const losses = new Map<string, number>();
  let played = 0;
  let champion: string | null = null;
  const finish = (id: string, winner: string) => {
    const m = byId.get(id)!;
    m.status = 'completed';
    m.winner_id = winner;
    const loser = m.team_a_id === winner ? m.team_b_id : m.team_a_id;
    if (loser) losses.set(loser, (losses.get(loser) ?? 0) + 1);
    if (loser && m.loser_next_match_id) place(m.loser_next_match_id, m.loser_next_slot!, loser);
    if (m.next_match_id) place(m.next_match_id, m.next_slot!, winner);
    else champion = winner;
  };
  const place = (id: string, slot: 'a' | 'b', team: string) => {
    const n = byId.get(id)!;
    expect(n.status).toBe('pending');
    if (slot === 'a') n.team_a_id = team;
    else n.team_b_id = team;
    if (n.is_bye) finish(n.id, team);
    else if (n.team_a_id && n.team_b_id) n.status = 'ready';
  };
  for (;;) {
    const ready = [...byId.values()].filter((m) => m.status === 'ready');
    if (!ready.length) break;
    for (const m of ready) {
      const seed = (t: string) => Number(t.slice(1));
      played++;
      finish(m.id, seed(m.team_a_id!) < seed(m.team_b_id!) ? m.team_a_id! : m.team_b_id!);
    }
  }
  return { byId, losses, played, champion: champion as string | null };
}

describe('double elimination', () => {
  it.each([3, 4, 5, 6, 7, 8, 11, 16])('runs %i teams to a champion, everyone else out after two losses', (n) => {
    const drafts = generateDoubleElim(teams(n), { newId });
    const { byId, losses, played, champion } = play(drafts);
    expect(champion).toBe('t1');
    // Upper bracket n-1 results, loser bracket n-2, and the final.
    expect(played).toBe(2 * n - 2);
    expect([...byId.values()].every((m) => m.status === 'completed')).toBe(true);
    const final = [...byId.values()].find((m) => m.stage === 'knockout' && !m.next_match_id)!;
    const runnerUp = final.team_a_id === 't1' ? final.team_b_id : final.team_a_id;
    for (let i = 2; i <= n; i++) {
      const t = `t${i}`;
      // Only the runner-up can go out with one loss: the final is a single series.
      if (t === runnerUp) expect([1, 2]).toContain(losses.get(t));
      else expect(losses.get(t)).toBe(2);
    }
  });

  it('labels upper, lower and final rounds', () => {
    const drafts = generateDoubleElim(teams(8), { newId });
    const rounds = knockoutRounds(drafts.map((d) => ({ ...d, tournament_game_id: 'g' }))).get('g')!;
    expect(rounds).toBe(4);
    const label = (stage: string, round: number) => matchLabel(drafts.find((d) => d.stage === stage && d.round === round)!, rounds);
    expect(label('knockout', 1)).toBe('Upper quarter-final');
    expect(label('knockout', 3)).toBe('Upper final');
    expect(label('knockout', 4)).toBe('Final');
    expect(label('losers', 1)).toBe('Lower round 1');
    expect(label('losers', 4)).toBe('Lower final');
    expect(planStage({ stage: 'losers', round: 4 }, rounds)).toBe('losers');
    expect(planStage({ stage: 'knockout', round: 3 }, rounds)).toBe('semi');
  });

  it('is a plain final with two teams', () => {
    const drafts = generateDoubleElim(teams(2), { newId });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].stage).toBe('knockout');
  });

  it('schedules loser bracket matches after the matches their teams come from', () => {
    const drafts = generateDoubleElim(teams(6), { newId });
    const start = Date.UTC(2026, 0, 1, 10);
    const r = scheduleTournament(
      drafts.map((d) => ({ ...d, tournament_game_id: 'g', station: null, stations: null, called_at: null, not_before: null, started_at: null, ended_at: null })),
      {
        windows: [{ day: 1, start, end: start + 12 * 3600_000 }],
        stations: 4,
        callMinutes: 5,
        games: new Map([['g', { matchMinutes: 10, bufferMinutes: 0, stationsRequired: 1, allowedStations: null, order: 0 }]]),
      },
    );
    expect(r.unplaced).toEqual([]);
    const at = new Map(r.slots.map((s) => [s.id, s]));
    // Every match that isn't a bye gets a slot, after every match that feeds it.
    const real = drafts.filter((d) => !d.is_bye);
    expect(r.slots).toHaveLength(real.length);
    const byId = new Map(drafts.map((d) => [d.id, d]));
    const feedsInto = (from: StageMatchDraft, to: string): boolean =>
      [from.next_match_id, from.loser_next_match_id].some((id) => id && (id === to || (byId.get(id)!.is_bye && feedsInto(byId.get(id)!, to))));
    for (const m of real)
      for (const f of real) if (feedsInto(f, m.id)) expect(at.get(m.id)!.start).toBeGreaterThanOrEqual(at.get(f.id)!.end);
  });
});
