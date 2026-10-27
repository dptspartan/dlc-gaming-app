import { describe, expect, it } from 'vitest';
import { generateBracket } from './bracket';
import { generateGroupStage, knockoutFromQualifiers } from './groups';
import { callSecondsLeft, moveInQueue, previewDay, rescheduleInTimetable, todayOf, scheduleTournament, splitAtClose, stationBoard, type TimetableGame, type TimetableMatch } from './timetable';
import { tournamentWindows } from './time';

const start = Date.UTC(2026, 0, 1, 10);
const windows = [{ day: 1, start, end: start + 12 * 3600_000 }];
const MIN = 60_000;
let n = 0;
const newId = () => `m${++n}`;
const entrants = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => ({ teamId: `${prefix}${i + 1}`, seed: i + 1 }));
const game = (over: Partial<TimetableGame> = {}): TimetableGame => ({ matchMinutes: 10, bufferMinutes: 0, stationsRequired: 1, allowedStations: null, order: 0, ...over });
const asTimetable = (tg: string, drafts: ReturnType<typeof generateBracket>, stage: 'group' | 'knockout' = 'knockout'): TimetableMatch[] =>
  drafts.map((d) => ({ ...d, tournament_game_id: tg, stage, station: null, stations: null, called_at: null, not_before: null, started_at: null, ended_at: null }));

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

describe('scheduleTournament', () => {
  it('shares stations between games and never double-books a station', () => {
    const fifa = asTimetable('fifa', generateBracket(entrants('f', 8), { newId }));
    const tekken = asTimetable('tekken', generateBracket(entrants('t', 4), { newId }));
    const r = scheduleTournament([...fifa, ...tekken], {
      windows,
      stations: 3,
      callMinutes: 5,
      games: new Map([
        ['fifa', game({ order: 0 })],
        ['tekken', game({ order: 1, matchMinutes: 5 })],
      ]),
    });
    expect(r.unplaced).toEqual([]);
    expect(r.slots).toHaveLength(7 + 3);
    for (const a of r.slots)
      for (const b of r.slots) {
        if (a.id >= b.id) continue;
        if (a.stations.some((s) => b.stations.includes(s))) expect(overlaps(a, b)).toBe(false);
      }
    // Three stations: the first wave runs three matches at once.
    expect(r.slots.filter((s) => s.start === start)).toHaveLength(3);
  });

  it('gives a two-station game two free stations at once and respects allowed stations', () => {
    const cod = asTimetable('cod', generateBracket(entrants('c', 4), { newId }));
    const r = scheduleTournament(cod, {
      windows,
      stations: 4,
      callMinutes: 5,
      games: new Map([['cod', game({ stationsRequired: 2, allowedStations: [1, 2, 3] })]]),
    });
    for (const s of r.slots) {
      expect(s.stations).toHaveLength(2);
      expect(s.stations.every((x) => x <= 3)).toBe(true);
    }
    // Only one match fits on stations 1-3 at a time with two stations each.
    const first = r.slots.filter((s) => s.start === start);
    expect(first).toHaveLength(1);
  });

  it('moves matches off a station the venue no longer has', () => {
    const drafts = asTimetable('g', generateBracket(entrants('p', 8), { newId }));
    // Uploaded with station 4, then the venue went down to 3 stations.
    drafts[0] = { ...drafts[0], station: 4, stations: [4], station_locked: true };
    drafts[1] = { ...drafts[1], station: 2, stations: [2], station_locked: true };
    const r = scheduleTournament(drafts, { windows, stations: 3, callMinutes: 5, games: new Map([['g', game()]]) });
    expect(r.unplaced).toEqual([]);
    expect(r.slots.every((s) => s.station <= 3)).toBe(true);
    expect(r.slots.find((s) => s.id === drafts[1].id)!.station).toBe(2);
  });

  it('lets a game whose only stations are gone use any station', () => {
    const drafts = asTimetable('g', generateBracket(entrants('p', 4), { newId }));
    const r = scheduleTournament(drafts, { windows, stations: 3, callMinutes: 5, games: new Map([['g', game({ allowedStations: [4] })]]) });
    expect(r.unplaced).toEqual([]);
    expect(r.slots.every((s) => s.station <= 3)).toBe(true);
  });

  it('keeps called and live matches on their stations and fills the free ones', () => {
    const drafts = asTimetable('g', generateBracket(entrants('p', 8), { newId }));
    const now = start + 30 * MIN;
    drafts[0] = { ...drafts[0], status: 'live', station: 1, stations: [1], started_at: new Date(now - 2 * MIN).toISOString() };
    drafts[1] = { ...drafts[1], status: 'called', station: 2, stations: [2], called_at: new Date(now).toISOString() };
    const r = scheduleTournament(drafts, { windows, stations: 3, callMinutes: 5, now, games: new Map([['g', game()]]) });
    const firstQueued = r.slots.filter((s) => s.start === now);
    expect(firstQueued).toHaveLength(1);
    expect(firstQueued[0].station).toBe(3);
    // Station 1 frees up when the live match is due to end (started 2 min ago, 10 min long).
    expect(r.slots.some((s) => s.station === 1 && s.start === now + 8 * MIN)).toBe(true);
  });

  it('holds a skipped match back until its not-before time', () => {
    const drafts = asTimetable('g', generateBracket(entrants('p', 4), { newId }));
    const later = start + 45 * MIN;
    drafts[0] = { ...drafts[0], not_before: new Date(later).toISOString() };
    const r = scheduleTournament(drafts, { windows, stations: 2, callMinutes: 5, games: new Map([['g', game()]]) });
    expect(r.slots.find((s) => s.id === drafts[0].id)!.start).toBe(later);
  });

  it('starts a knockout after its group stage, while another game keeps playing', () => {
    const { matches: groups } = generateGroupStage(entrants('g', 6), 2, { newId });
    const ko = knockoutFromQualifiers(['g1', 'g2', 'g3', 'g4'], { newId });
    const other = asTimetable('other', generateBracket(entrants('o', 4), { newId }));
    const r = scheduleTournament([...asTimetable('grp', groups, 'group'), ...asTimetable('grp', ko), ...other], {
      windows,
      stations: 2,
      callMinutes: 5,
      games: new Map([
        ['grp', game()],
        ['other', game({ order: 1 })],
      ]),
    });
    const at = new Map(r.slots.map((s) => [s.id, s]));
    const lastGroup = Math.max(...groups.map((m) => at.get(m.id)!.end));
    for (const m of ko.filter((x) => !x.is_bye)) expect(at.get(m.id)!.start).toBeGreaterThanOrEqual(lastGroup);
  });

  it('reports matches it cannot place', () => {
    const drafts = asTimetable('g', generateBracket(entrants('p', 2), { newId }));
    const r = scheduleTournament(drafts, { windows, stations: 1, callMinutes: 5, games: new Map([['g', game({ stationsRequired: 2 })]]) });
    expect(r.unplaced).toHaveLength(1);
    expect(r.fits).toBe(false);
  });
});

describe('stationBoard', () => {
  it('shows what each station is doing and its queue', () => {
    const board = stationBoard(
      [
        { status: 'live', station: 1, stations: [1, 2], scheduled_start: null, is_bye: false },
        { status: 'ready', station: 3, stations: [3], scheduled_start: '2026-01-01T11:00:00Z', is_bye: false },
        { status: 'ready', station: 3, stations: [3], scheduled_start: '2026-01-01T10:30:00Z', is_bye: false },
      ],
      3,
    );
    expect(board[0].current?.status).toBe('live');
    expect(board[1].current?.status).toBe('live');
    expect(board[2].queue.map((m) => m.scheduled_start)).toEqual(['2026-01-01T10:30:00Z', '2026-01-01T11:00:00Z']);
  });

  it('counts down the call', () => {
    const now = Date.UTC(2026, 0, 1, 10);
    expect(callSecondsLeft({ called_at: new Date(now - 60_000).toISOString() }, 5, now)).toBe(240);
  });
});

describe('moveInQueue', () => {
  // Eight players on two stations: four first-round matches, two at a time.
  const setup = () => {
    const matches = asTimetable('g', generateBracket(entrants('p', 8), { newId }));
    const options = { windows, stations: 2, callMinutes: 5, games: new Map([['g', game()]]) };
    const order = (ms: TimetableMatch[]) =>
      scheduleTournament(ms, options)
        .slots.sort((a, b) => a.start - b.start || a.station - b.station)
        .map((s) => s.id);
    return { matches, options, order };
  };
  const ok = (r: ReturnType<typeof moveInQueue>) => {
    if ('stuck' in r) throw new Error(`stuck: ${r.stuck.kind}`);
    return r;
  };
  const apply = (ms: TimetableMatch[], id: string, r: { key: number; notBefore: Map<string, string | null> }) =>
    ms.map((m) => ({ ...m, ...(m.id === id ? { queue_key: r.key } : {}), ...(r.notBefore.has(m.id) ? { not_before: r.notBefore.get(m.id)! } : {}) }));

  it('moves a match one place earlier and the rest of the queue moves round it', () => {
    const { matches, options, order } = setup();
    const before = order(matches);
    const fourth = before[3];
    const once = apply(matches, fourth, ok(moveInQueue(matches, options, fourth, 'earlier')));
    expect(order(once).slice(0, 4)).toEqual([before[0], before[1], before[3], before[2]]);
    // Into the first wave on the next step, ahead of the second match.
    const twice = apply(once, fourth, ok(moveInQueue(once, options, fourth, 'earlier')));
    expect(order(twice).slice(0, 4)).toEqual([before[0], before[3], before[1], before[2]]);
  });

  it('keeps the new place on a rebuild', () => {
    const { matches, options, order } = setup();
    const first = order(matches)[0];
    const saved = apply(matches, first, ok(moveInQueue(matches, options, first, 'later')));
    expect(order(saved)[1]).toBe(first);
    expect(order(saved)).toEqual(order(saved.map((m) => ({ ...m }))));
  });

  it("won't move a match ahead of the round it waits for, and says why", () => {
    const { matches, options, order } = setup();
    const ids = order(matches);
    // The final waits for both semi-finals.
    expect(moveInQueue(matches, options, ids[6], 'earlier')).toEqual({ stuck: { kind: 'round' } });
    expect(moveInQueue(matches, options, ids[0], 'earlier')).toEqual({ stuck: { kind: 'edge' } });
  });

  it('only passes the matches it is asked to', () => {
    const { matches, options, order } = setup();
    const ids = order(matches);
    const among = (m: TimetableMatch) => m.id === ids[1] || m.id === ids[3];
    const after = order(apply(matches, ids[3], ok(moveInQueue(matches, options, ids[3], 'earlier', among))));
    expect(after.indexOf(ids[3])).toBeLessThan(after.indexOf(ids[1]));
  });

  it('swaps sheet start times with the match it passes', () => {
    // An uploaded day: each match has its sheet time and station, 15 minutes apart on one station.
    const at = (min: number) => new Date(start + min * MIN).toISOString();
    const sheet: TimetableMatch[] = [0, 15, 30].map((min, i) => ({
      ...asTimetable('g', generateBracket(entrants(`s${i}`, 2), { newId }))[0],
      round_code: 'PRE',
      fixture_day: '2026-01-01',
      station: 1,
      stations: [1],
      station_locked: true,
      not_before: at(min),
    }));
    const options = { windows, stations: 3, callMinutes: 5, games: new Map([['g', game({ matchMinutes: 15 })]]) };
    const r = ok(moveInQueue(sheet, options, sheet[2].id, 'earlier'));
    expect(r.notBefore.get(sheet[2].id)).toBe(at(15));
    expect(r.notBefore.get(sheet[1].id)).toBe(at(30));
    const slot = new Map(r.result.slots.map((s) => [s.id, s.start]));
    expect(slot.get(sheet[2].id)).toBe(start + 15 * MIN);
    expect(slot.get(sheet[1].id)).toBe(start + 30 * MIN);
  });
});

describe('set times (reschedule)', () => {
  const opts = (stations = 1) => ({ windows, stations, callMinutes: 5, games: new Map([['g', game({ matchMinutes: 20, bufferMinutes: 5 })]]) });
  const four = () => asTimetable('g', generateBracket(entrants('s', 8), { newId })).filter((m) => m.round === 1);

  it('puts a match at its set time and moves the others round it', () => {
    const ms = four();
    const before = scheduleTournament(ms, opts());
    const first = before.slots.find((s) => s.start === start)!;
    // Move the first match to 11:00; the others move up and fit round it.
    const at = start + 60 * MIN;
    const r = rescheduleInTimetable(ms, opts(), first.id, at);
    expect(r.slot?.start).toBe(at);
    expect(r.shifted.length).toBeGreaterThan(0);
    const slots = r.result.slots;
    for (const a of slots) for (const b of slots) if (a.id < b.id) expect(overlaps({ start: a.start, end: a.end + 5 * MIN }, { start: b.start, end: b.end + 5 * MIN })).toBe(false);
    // Something takes 10:00 now.
    expect(slots.some((s) => s.start === start)).toBe(true);
  });

  it('moves a later match earlier and pushes the match in its way', () => {
    const ms = four();
    const before = scheduleTournament(ms, opts());
    const last = [...before.slots].sort((a, b) => b.start - a.start)[0];
    const r = rescheduleInTimetable(ms, opts(), last.id, start);
    expect(r.slot?.start).toBe(start);
    expect(r.result.slots.filter((s) => s.start === start)).toHaveLength(1);
  });

  it('keeps players out of two places at once', () => {
    const ms = four();
    const target = ms[0];
    // The final waits for the semis; two stations, so a set time can't put a player in two matches.
    const r = rescheduleInTimetable(ms, opts(2), target.id, start + 30 * MIN);
    expect(r.slot?.start).toBe(start + 30 * MIN);
    for (const s of r.result.slots) {
      if (s.id === target.id) continue;
      const m = ms.find((x) => x.id === s.id)!;
      const shares = [m.team_a_id, m.team_b_id].some((t) => t && (t === target.team_a_id || t === target.team_b_id));
      if (shares) expect(overlaps(s, r.slot!)).toBe(false);
    }
  });

  it('waits for the round before when the set time is too early', () => {
    const all = asTimetable('g', generateBracket(entrants('s', 4), { newId }));
    const final = all.find((m) => m.round === 2)!;
    const r = rescheduleInTimetable(all, opts(), final.id, start);
    // Two semis of 20 + 5 minutes on one station come first.
    expect(r.slot!.start).toBeGreaterThanOrEqual(start + 50 * MIN);
  });

  it('clearing the set time goes back to the usual order', () => {
    const ms = four();
    const base = scheduleTournament(ms, opts());
    const id = base.slots[0].id;
    const moved = ms.map((m) => (m.id === id ? { ...m, not_before: new Date(start + 90 * MIN).toISOString(), time_locked: true } : m));
    const back = rescheduleInTimetable(moved, opts(), id, null);
    expect(back.slot?.start).toBe(base.slots[0].start);
  });

  it('a match with a set time says so instead of moving in the queue', () => {
    const ms = four().map((m, i) => (i === 0 ? { ...m, status: 'ready' as const, not_before: new Date(start).toISOString(), time_locked: true } : m));
    const out = moveInQueue(ms, opts(), ms[0].id, 'later');
    expect(out).toEqual({ stuck: { kind: 'set_time' } });
  });
});

describe('day hours', () => {
  it('runs one day late and ends another early', () => {
    const w = tournamentWindows({
      start_date: '2026-01-01',
      days: 2,
      daily_start: '10:00',
      daily_end: '18:00',
      timezone: 'UTC',
      day_hours: { '2026-01-01': { end: '01:00' }, '2026-01-02': { end: '15:30' } },
    });
    expect(w[0].end).toBe(Date.UTC(2026, 0, 2, 1));
    expect(w[1].end).toBe(Date.UTC(2026, 0, 2, 15, 30));
    expect(w[0].date).toBe('2026-01-01');
  });

  it('splits what still plays today from what moves on', () => {
    const ms = asTimetable('g', generateBracket(entrants('d', 8), { newId })).filter((m) => m.round === 1);
    const day = { day: 1, start, end: start + 50 * MIN };
    const r = scheduleTournament(ms, { windows: [day, { day: 2, start: start + 24 * 3600_000, end: start + 32 * 3600_000 }], stations: 1, callMinutes: 5, games: new Map([['g', game({ matchMinutes: 20, bufferMinutes: 5 })]]) });
    const { today, later } = splitAtClose(r, day);
    expect(today).toHaveLength(2);
    expect(later).toHaveLength(2);
  });
});

describe('previewDay (end of day)', () => {
  const t = { start_date: '2026-01-01', days: 2, daily_start: '10:00', daily_end: '11:00', timezone: 'UTC', stations: 1, call_minutes: 5, day_hours: {} };
  const tg = [{ id: 'g', tournament_id: 't', game_id: 'x', match_minutes: 20, buffer_minutes: 5, stations_required: 1, allowed_stations: null, created_at: '1' }] as never[];
  const ms = () => asTimetable('g', generateBracket(entrants('e', 8), { newId })).filter((m) => m.round === 1);

  it('runs late so the rest plays today', () => {
    const now = start;
    const usual = previewDay(t, tg, ms(), '2026-01-01', undefined, now)!;
    expect(usual.today).toBe(2);
    expect(usual.later).toBe(2);
    const late = previewDay(t, tg, ms(), '2026-01-01', { end: '12:00' }, now)!;
    expect(late.today).toBe(4);
    expect(late.later).toBe(0);
  });

  it('stops for today and moves everything left to tomorrow, or past the last day', () => {
    const now = start + 5 * MIN;
    const stop = previewDay(t, tg, ms(), '2026-01-01', { end: '10:05' }, now)!;
    expect(stop.today).toBe(0);
    expect(stop.later).toBe(2);
    expect(stop.beyond).toBe(2);
    expect(todayOf(t, now)?.date).toBe('2026-01-01');
  });
});
