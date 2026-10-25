import { describe, expect, it } from 'vitest';
import { generateBracket } from './bracket';
import { generateGroupStage, knockoutFromQualifiers } from './groups';
import { callSecondsLeft, scheduleTournament, stationBoard, type TimetableGame, type TimetableMatch } from './timetable';

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
