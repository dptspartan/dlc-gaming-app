import { describe, expect, it } from 'vitest';
import { fixtureNotBefore, fixturesTemplate, parseFixturesCsv, parseRoundCode } from './fixtures';
import { isFinal, matchLabel } from './groups';
import { planStage } from './plan';
import { scheduleTournament, type TimetableMatch } from './timetable';

const tournament = { start_date: '2026-11-02', days: 2, stations: 4, daily_start: '10:00:00', timezone: 'Asia/Karachi' };
const teams = [
  { id: 'fury', name: 'Fury' },
  { id: 'kilo', name: 'Kilo' },
  { id: 'drift', name: 'Drift' },
  { id: 'ghost', name: 'Ghost' },
  { id: 'smith', name: 'Smith, J' },
];
const ctx = { tournament, tg: { allowed_stations: null as number[] | null }, teams };
const parse = (body: string, over: Partial<typeof ctx> = {}) => parseFixturesCsv(`stage,date,time,station,side_a,side_b\n${body}`, { ...ctx, ...over });

describe('parseRoundCode', () => {
  it('reads codes and the ways organisers write them', () => {
    expect(['PRE', 'prelims', 'Play-in', 'r32', 'Round of 32', 'last 16', 'QF', 'Quarter-finals', 'semis', 'Semi-final', 'F', 'final'].map(parseRoundCode)).toEqual([
      'PRE', 'PRE', 'PRE', 'R32', 'R32', 'R16', 'QF', 'QF', 'SF', 'SF', 'F', 'F',
    ]);
    expect(parseRoundCode('round 3')).toBeNull();
  });
});

describe('parseFixturesCsv', () => {
  it('reads a day of fixtures with optional time and station, TBD sides and quoted names', () => {
    const r = parse(['R16,2026-11-02,18:00,1,Fury,Kilo', 'r16,2026-11-02,,,drift,"Smith, J"', 'QF,2026-11-02,9:30,,TBD,'].join('\n'));
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, round_code: 'R16', date: '2026-11-02', time: '18:00', station: 1, team_a_id: 'fury', team_b_id: 'kilo' },
      { line: 3, round_code: 'R16', date: '2026-11-02', time: null, station: null, team_a_id: 'drift', team_b_id: 'smith' },
      { line: 4, round_code: 'QF', date: '2026-11-02', time: '09:30', station: null, team_a_id: null, team_b_id: null },
    ]);
  });

  it('reports each problem against its line and leaves those rows out', () => {
    const r = parse(
      [
        'R8,2026-11-02,,,Fury,Kilo',
        'R16,2026-11-09,,,Fury,Kilo',
        'R16,2026-11-02,25:00,9,Fury,Nobody',
        'R16,2026-11-02,,,Ghost,Ghost',
        'R16,2026-11-02,18:00,2,Fury,Kilo',
        'R16,2026-11-02,18:00,2,Drift,Kilo',
      ].join('\n'),
    );
    expect(r.errors.map((e) => [e.line, e.message])).toEqual([
      [2, 'Unknown stage "R8". Use PRE, R32, R16, QF, SF or F.'],
      [3, '2026-11-09 is outside the tournament (2026-11-02 to 2026-11-03).'],
      [4, 'Time "25:00" is not HH:MM.'],
      [4, 'Station "9" does not exist (1 to 4).'],
      [4, '"Nobody" is not a player or team in this game.'],
      [5, '"Ghost" cannot play themselves.'],
      [7, 'Kilo already plays this stage that day (line 6).'],
      [7, 'Station 2 already has a match at 18:00 (line 6).'],
    ]);
    expect(r.rows.map((x) => x.line)).toEqual([6]);
  });

  it('only allows the stations the game can use', () => {
    const r = parse('SF,2026-11-03,,3,Fury,Kilo', { tg: { allowed_stations: [1, 2] } });
    expect(r.errors[0].message).toBe('Station 3 is not one this game can use (1, 2).');
  });

  it('needs the stage, date and both side columns', () => {
    expect(parseFixturesCsv('stage,side_a,side_b\nR16,Fury,Kilo', ctx).errors[0].message).toMatch(/^Missing column: date\./);
    expect(parseFixturesCsv('', ctx).errors[0].message).toBe('The file is empty.');
    expect(parseFixturesCsv('stage,date,side_a,side_b\n', ctx).errors[0].message).toBe('The file has a header but no fixtures.');
  });

  it('round-trips its own template', () => {
    const r = parseFixturesCsv(fixturesTemplate('2026-11-02', teams), ctx);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(3);
  });
});

describe('uploaded fixtures', () => {
  const up = (round_code: 'R16' | 'SF' | 'F') => ({ stage: 'knockout' as const, group_no: null, round: 3, next_match_id: null, round_code });

  it('are labelled by their stage and only an uploaded final crowns a champion', () => {
    expect(matchLabel(up('R16'), 3)).toBe('Round of 16');
    expect(isFinal(up('R16'))).toBe(false);
    expect(isFinal(up('F'))).toBe(true);
    // A generated bracket keeps the old rule: no next match means final.
    expect(isFinal({ stage: 'knockout', next_match_id: null })).toBe(true);
  });

  it('follow the semi and final series rules', () => {
    expect(planStage(up('SF'), 99)).toBe('semi');
    expect(planStage(up('F'), 99)).toBe('final');
    expect(planStage(up('R16'), 3)).toBe('knockout');
  });

  it('may not start before their time, or before that day opens', () => {
    expect(fixtureNotBefore({ date: '2026-11-02', time: '18:00' }, tournament).toISOString()).toBe('2026-11-02T13:00:00.000Z');
    expect(fixtureNotBefore({ date: '2026-11-03', time: null }, tournament).toISOString()).toBe('2026-11-03T05:00:00.000Z');
  });

  it('wait for the earlier stages uploaded for the same day', () => {
    const start = Date.UTC(2026, 10, 2, 5);
    const base = { tournament_game_id: 'g', stage: 'knockout' as const, next_match_id: null, is_bye: false, called_at: null, started_at: null, ended_at: null, not_before: null, station: null, stations: null };
    const qf = (id: string, position: number, a: string, b: string, day = '2026-11-02') =>
      ({ ...base, id, round: 4, position, status: 'ready' as const, team_a_id: a, team_b_id: b, round_code: 'QF' as const, fixture_day: day });
    const matches: TimetableMatch[] = [
      qf('qf1', 0, 'a', 'b'),
      qf('qf2', 1, 'c', 'd'),
      { ...base, id: 'sf', round: 5, position: 0, status: 'pending', team_a_id: null, team_b_id: null, round_code: 'SF', fixture_day: '2026-11-02' },
      // Another day's quarter-final does not hold this day's semi back.
      qf('qf-later', 2, 'e', 'f', '2026-11-03'),
    ];
    const r = scheduleTournament(matches, {
      windows: [{ day: 1, start, end: start + 8 * 3600_000 }],
      stations: 4,
      callMinutes: 5,
      games: new Map([['g', { matchMinutes: 10, bufferMinutes: 5, stationsRequired: 1, allowedStations: null, order: 0 }]]),
    });
    const at = (id: string) => r.slots.find((s) => s.id === id)!;
    expect(at('qf1').start).toBe(start);
    expect(at('qf2').start).toBe(start);
    expect(at('sf').start).toBe(start + 15 * 60_000);
  });

  it('keep a station from the file when the timetable is rebuilt', () => {
    const start = Date.UTC(2026, 10, 2, 5);
    const base = { tournament_game_id: 'g', stage: 'knockout' as const, round: 3, next_match_id: null, status: 'ready' as const, is_bye: false, called_at: null, started_at: null, ended_at: null, not_before: null };
    const matches: TimetableMatch[] = [
      { ...base, id: 'free', position: 0, team_a_id: 'a', team_b_id: 'b', station: null, stations: null },
      { ...base, id: 'locked', position: 1, team_a_id: 'c', team_b_id: 'd', station: 3, stations: [3], station_locked: true },
      { ...base, id: 'moved', position: 2, team_a_id: 'e', team_b_id: 'f', station: 3, stations: [3] },
    ];
    const r = scheduleTournament(matches, {
      windows: [{ day: 1, start, end: start + 8 * 3600_000 }],
      stations: 4,
      callMinutes: 5,
      games: new Map([['g', { matchMinutes: 10, bufferMinutes: 0, stationsRequired: 1, allowedStations: null, order: 0 }]]),
    });
    const at = (id: string) => r.slots.find((s) => s.id === id)!;
    expect(at('locked').stations).toEqual([3]);
    // Without the lock the old station is just a suggestion: it takes the next free one.
    expect(at('moved').stations).not.toEqual([3]);
  });
});
