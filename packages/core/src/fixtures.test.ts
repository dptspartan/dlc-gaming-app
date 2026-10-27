import { describe, expect, it } from 'vitest';
import { fixtureNotBefore, fixturesTemplate, parseFixturesCsv, parseRoundCode, sideName, feederMatch, feederSides, sideOrContenders, bracketColumns, winnerLinks, type FixtureRow } from './fixtures';
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
type Options = Partial<Parameters<typeof parseFixturesCsv>[1]>;
const parse = (body: string, over: Options = {}) => parseFixturesCsv(`stage,date,time,station,side_a,side_b\n${body}`, { ...ctx, ...over });

describe('parseRoundCode', () => {
  it('reads codes and the ways organisers write them', () => {
    expect(
      ['PRE', 'Preliminary / play-in', 'prelims', 'r32', 'Round of 32', 'last 16', 'QF', 'Quarterfinal', 'semis', 'Semifinal', 'F', 'Final'].map(parseRoundCode),
    ).toEqual(['PRE', 'PRE', 'PRE', 'R32', 'R32', 'R16', 'QF', 'QF', 'SF', 'SF', 'F', 'F']);
    expect(parseRoundCode('round 3')).toBeNull();
  });
});

const row = (over: Partial<FixtureRow>): FixtureRow => ({
  line: 2,
  round_code: 'R16',
  match_code: null,
  date: '2026-11-02',
  time: null,
  wave: null,
  station: null,
  team_a_id: null,
  team_b_id: null,
  a_from: null,
  b_from: null,
  ...over,
});

describe('parseFixturesCsv: plain CSV', () => {
  it('reads dates, optional time and station, TBD sides and quoted names', () => {
    const r = parse(['R16,2026-11-02,18:00,1,Fury,Kilo', 'r16,2026-11-02,,,drift,"Smith, J"', 'QF,2026-11-02,9:30,,TBD,'].join('\n'));
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      row({ line: 2, time: '18:00', station: 1, team_a_id: 'fury', team_b_id: 'kilo' }),
      row({ line: 3, team_a_id: 'drift', team_b_id: 'smith' }),
      row({ line: 4, round_code: 'QF', time: '09:30' }),
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
      [2, 'Unknown round "R8". Use Preliminary, Round of 32, Round of 16, Quarterfinal, Semifinal or Final.'],
      [3, '2026-11-09 is outside the tournament (2026-11-02 to 2026-11-03).'],
      [4, 'Time "25:00" is not a time like 17:30 or 5:30 PM.'],
      [4, 'Station "9" does not exist (1 to 4).'],
      [4, '"Nobody" is not a player or team in this game.'],
      [5, '"Ghost" cannot play themselves.'],
      [7, 'Kilo already plays this round that day (line 6).'],
      [7, 'Station 2 already has a match at 18:00 (line 6).'],
    ]);
    expect(r.rows.map((x) => x.line)).toEqual([6]);
    expect(r.unknownNames).toEqual(['Nobody']);
  });

  it('only allows the stations the game can use', () => {
    const r = parse('SF,2026-11-03,,3,Fury,Kilo', { tg: { allowed_stations: [1, 2] } });
    expect(r.errors[0].message).toBe('Station 3 is not one this game can use (1, 2).');
  });

  it('needs the round and both player columns', () => {
    expect(parseFixturesCsv('stage,side_a\nR16,Fury', ctx).errors[0].message).toBe('Missing column: Player B.');
    expect(parseFixturesCsv('', ctx).errors[0].message).toBe('The file is empty.');
    expect(parseFixturesCsv('stage,date,side_a,side_b\n', ctx).errors[0].message).toBe('The file has a header but no fixtures.');
  });
});

describe('parseFixturesCsv: organisers\' sheets', () => {
  // Columns and wording as in the club's fixtures workbook (made-up names).
  const sheet = (header: string, body: string[], over: Options = {}) => parseFixturesCsv([header, ...body].join('\n'), { ...ctx, ...over });

  it('reads Round / Match ID / Player A / Setup / Wave, with the day picked for the sheet', () => {
    const r = sheet(
      'Round,Match ID,Player A,Player B,Setup,Wave,Winner / score',
      ['Preliminary / play-in,FC-PI-01,Fury,Kilo,Setup 1,Wave 1 (~15 min),', 'Preliminary / play-in,FC-PI-02,Drift,Ghost,Setup 2,Wave 1 (~15 min),'],
      { defaultDate: '2026-11-02', tg: { allowed_stations: [3, 4] } },
    );
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      row({ line: 2, round_code: 'PRE', match_code: 'FC-PI-01', wave: 1, station: 3, team_a_id: 'fury', team_b_id: 'kilo' }),
      row({ line: 3, round_code: 'PRE', match_code: 'FC-PI-02', wave: 1, station: 4, team_a_id: 'drift', team_b_id: 'ghost' }),
    ]);
  });

  it('links "Winner of …" to the matches it names, in this sheet or already uploaded', () => {
    const r = sheet(
      'Round,Match ID,Player / qualifier A,Player / qualifier B,Setup,Planned day,Wave',
      ['Round of 32,TK-R32-01,Fury,Winner of TK-PI-01,Tekken Setup 1,Monday,Wave 1', 'Round of 16,TK-R16-01,Winner TK-R32-01,TBD,Tekken Setup 1,Tuesday (Wednesday buffer),Wave 2'],
      { existingCodes: ['TK-PI-01'] },
    );
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.match_code, x.date, x.wave, x.station, x.team_a_id, x.a_from, x.b_from])).toEqual([
      ['TK-R32-01', '2026-11-02', 1, 1, 'fury', null, 'TK-PI-01'],
      ['TK-R16-01', '2026-11-03', 2, 1, null, 'TK-R32-01', null],
    ]);
  });

  it('rejects links and days that cannot work', () => {
    const r = sheet('Round,Match ID,Player A,Player B,Setup,Planned day', [
      'Round of 32,R32-01,Winner of PI-09,Kilo,Setup 1,Monday',
      'Round of 16,R16-01,Winner of R32-01,Winner of R32-01,Setup 1,Monday',
      'Round of 16,R16-02,Winner R32-01,Fury,Setup 3,Friday',
      'Round of 32,R32-02,Winner of R16-02,Drift,Setup 1,Someday',
      'Round of 32,R32-01,Ghost,Fury,Setup 1,Tuesday',
    ]);
    expect(r.errors.map((e) => [e.line, e.message])).toEqual([
      [2, '"Winner of PI-09": there is no match PI-09 in this file or already uploaded.'],
      [3, 'Both sides are the winner of R32-01.'],
      [4, 'Friday is not one of the tournament days (2026-11-02 to 2026-11-03).'],
      [5, 'Day "Someday" is not a date (YYYY-MM-DD) or a weekday.'],
      [6, 'Match ID R32-01 is used twice (line 2).'],
    ]);
  });

  it('reads a Match Start column the way spreadsheets export times', () => {
    const r = sheet('Round,Match ID,Player A,Player B,Setup,Planned day,Wave,Winner / score,Match Start', [
      'Preliminary / play-in,FC-PI-01,Fury,Kilo,Setup 1,Monday,Wave 1 (~15 min),,17:30:00',
      'Preliminary / play-in,FC-PI-02,Drift,Ghost,Setup 2,Monday,Wave 1 (~15 min),,5:30 PM',
      'Preliminary / play-in,FC-PI-03,"Smith, J",TBD,Setup 1,Monday,Wave 2 (~15 min),,12:05 am',
    ]);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.time)).toEqual(['17:30', '17:30', '00:05']);
    expect(sheet('Round,Player A,Player B,Planned day,Match Start', ['Final,Fury,Kilo,Monday,13:30 PM']).errors[0].message).toBe('Time "13:30 PM" is not a time like 17:30 or 5:30 PM.');
  });

  it('names an undecided side by the match it comes from', () => {
    expect(sideName({ a_from: 'FC-PI-03' }, 'a', null)).toBe('Winner of FC-PI-03');
    expect(sideName({ a_from: 'FC-PI-03' }, 'a', 'Fury')).toBe('Fury');
    expect(sideName({ b_from: null }, 'b', null)).toBe('TBD');
  });

  it('finds the match a linked side waits on, and who can still take it', () => {
    const blank = { team_a_id: null as string | null, team_b_id: null as string | null, a_from: null as string | null, b_from: null as string | null, is_bye: false };
    const pi = { ...blank, tournament_game_id: 'fc', match_code: 'FC-PI-03', team_a_id: 'fury', team_b_id: 'kilo' };
    const other = { ...pi, tournament_game_id: 'tk' };
    const r32 = { ...blank, tournament_game_id: 'fc', match_code: 'FC-R32-01', team_a_id: 'drift', b_from: 'FC-PI-03' };
    const names: Record<string, string> = { fury: 'Fury', kilo: 'Kilo' };
    expect(feederMatch(r32, 'b', [other, pi, r32])).toBe(pi);
    expect(feederMatch(r32, 'a', [pi])).toBeUndefined();
    expect(feederMatch({ ...r32, team_b_id: 'fury' }, 'b', [pi])).toBeUndefined();
    expect(feederSides(pi, (id) => (id ? names[id] : null))).toBe('Fury or Kilo');
    expect(feederSides({ ...pi, team_b_id: null, b_from: 'FC-PI-01' }, (id) => (id ? names[id] : null))).toBe('Fury or Winner of FC-PI-01');
    const team = (id: string | null) => (id ? (names[id] ?? id) : null);
    expect(sideOrContenders(r32, 'b', [pi, r32], team)).toBe('Fury or Kilo');
    expect(sideOrContenders(r32, 'a', [pi, r32], team)).toBe('drift');
    expect(sideOrContenders({ ...r32, b_from: 'FC-PI-99' }, 'b', [pi], team)).toBe('Winner of FC-PI-99');
  });

  it('needs a day for every row, from the sheet or the upload', () => {
    const r = sheet('Round,Player A,Player B', ['Final,Fury,Kilo']);
    expect(r.errors[0].message).toBe('No day for this match. Add a day column, or pick a day for rows without one.');
  });

  it('round-trips its own template', () => {
    const r = parseFixturesCsv(fixturesTemplate(teams), ctx);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.round_code, x.match_code, x.a_from])).toEqual([
      ['PRE', 'PI-01', null],
      ['PRE', 'PI-02', null],
      ['R32', 'R32-01', 'PI-01'],
      ['R32', 'R32-02', 'PI-02'],
    ]);
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

describe('winnerLinks', () => {
  const base = { tournament_game_id: 'g', next_match_id: null, next_slot: null, winner_id: null, team_a_id: null, team_b_id: null, status: 'ready' as const };
  const m = (over: Partial<Parameters<typeof winnerLinks>[0][number]>) => ({ ...base, id: 'x', round: 1, position: 0, round_code: 'PRE' as const, ...over });

  it('follows real links, and finds the winner in the next uploaded round when there is none', () => {
    const links = winnerLinks([
      // Linked by "Winner of …".
      m({ id: 'pi1', winner_id: 'a', status: 'completed', next_match_id: 'r1', next_slot: 'b' }),
      // Next round uploaded with the winner's name: no link in the data.
      m({ id: 'pi2', position: 1, winner_id: 'c', status: 'completed', team_a_id: 'c', team_b_id: 'd' }),
      // Not played yet: no line.
      m({ id: 'pi3', position: 2, team_a_id: 'e', team_b_id: 'f' }),
      m({ id: 'r1', round: 2, round_code: 'R32', team_a_id: 'z' }),
      m({ id: 'r2', round: 2, round_code: 'R32', position: 1, team_a_id: 'y', team_b_id: 'c' }),
      // Same winner later on: only the next round counts.
      m({ id: 'r16', round: 3, round_code: 'R16', team_a_id: 'c' }),
    ]);
    expect(links).toEqual([
      { from: 'pi1', to: 'r1', slot: 'b' },
      { from: 'pi2', to: 'r2', slot: 'b' },
    ]);
  });
});

describe('bracketColumns', () => {
  const base = { tournament_game_id: 'g', next_match_id: null, next_slot: null, winner_id: null, team_a_id: null, team_b_id: null, status: 'ready' as const, round_code: 'PRE' as const };
  const m = (id: string, round: number, position: number, over: Partial<Parameters<typeof bracketColumns>[0][number]> = {}) => ({ ...base, id, round, position, ...over });

  it('orders each round by where its winners go', () => {
    const cols = bracketColumns([
      m('p0', 1, 0, { winner_id: 'c', status: 'completed', team_a_id: 'c' }), // → r1 b (by name)
      m('p1', 1, 1, { next_match_id: 'r0', next_slot: 'b' }), // → r0 b (linked, not played)
      m('p2', 1, 2), // nowhere yet
      m('p3', 1, 3, { next_match_id: 'r1', next_slot: 'a' }), // → r1 a
      m('p4', 1, 4, { next_match_id: 'r0', next_slot: 'a' }), // → r0 a
      m('r0', 2, 0, { round_code: 'R32' }),
      m('r1', 2, 1, { round_code: 'R32', team_b_id: 'c' }),
    ]);
    expect(cols.map((c) => c.map((x) => x.id))).toEqual([
      ['p4', 'p1', 'p3', 'p0', 'p2'],
      ['r0', 'r1'],
    ]);
  });
});
