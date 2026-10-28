import { MINUTE, tournamentWindows, zonedDate, type DayHours, type DayWindow } from './time';
import { seriesMinutes } from './plan';
import type { Game, Match, Tournament, TournamentGame } from './types';

/**
 * The tournament timetable: every game's matches placed on the venue's
 * shared stations. It is rebuilt at runtime (after a call, a start, a result,
 * a skip), so the next match in line always goes to the next free station.
 */

export interface TimetableGame {
  matchMinutes: number;
  bufferMinutes: number;
  /** Stations one match takes at once. */
  stationsRequired: number;
  /** Stations the game can use; null = any. */
  allowedStations: number[] | null;
  /** Order of the game in the tournament, to break ties. */
  order: number;
}

export type TimetableMatch = Pick<
  Match,
  | 'id'
  | 'tournament_game_id'
  | 'stage'
  | 'round'
  | 'position'
  | 'next_match_id'
  | 'status'
  | 'is_bye'
  | 'team_a_id'
  | 'team_b_id'
  | 'station'
  | 'stations'
  | 'called_at'
  | 'not_before'
  | 'started_at'
  | 'ended_at'
> &
  Partial<Pick<Match, 'best_of' | 'leg_games' | 'loser_next_match_id' | 'station_locked' | 'round_code' | 'fixture_day' | 'queue_key' | 'time_locked'>>;

export interface TimetableOptions {
  windows: DayWindow[];
  /** Stations at the venue, numbered 1..stations. */
  stations: number;
  games: Map<string, TimetableGame>;
  /** Minutes called players have to arrive before the match can start. */
  callMinutes: number;
  /** Nothing new is placed before this instant (ms). */
  now?: number;
  /** Minutes a match takes when it differs from its game's (a best-of series). */
  minutes?: (m: TimetableMatch) => number | undefined;
}

export interface TimetableSlot {
  id: string;
  /** Main station, and every station the match takes. */
  station: number;
  stations: number[];
  start: number;
  end: number;
  overflow: boolean;
}

export interface TimetableResult {
  slots: TimetableSlot[];
  fits: boolean;
  overflowMinutes: number;
  finishesAt: number | null;
  /** Matches that could not be placed (e.g. a game needs more stations than exist). */
  unplaced: string[];
}

export function timetableGames(tgames: Iterable<TournamentGame>): Map<string, TimetableGame> {
  const list = [...tgames].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return new Map(
    list.map((tg, i) => [
      tg.id,
      {
        matchMinutes: tg.match_minutes,
        bufferMinutes: tg.buffer_minutes,
        stationsRequired: tg.stations_required,
        allowedStations: tg.allowed_stations?.length ? tg.allowed_stations : null,
        order: i,
      },
    ]),
  );
}

export function timetableOptions(
  tournament: Pick<Tournament, 'start_date' | 'days' | 'daily_start' | 'daily_end' | 'timezone' | 'stations' | 'call_minutes'> & Partial<Pick<Tournament, 'day_hours'>>,
  tgames: Iterable<TournamentGame>,
  now?: number,
  catalog?: Iterable<Game>,
): TimetableOptions {
  const list = [...tgames];
  const byId = new Map(list.map((tg) => [tg.id, tg]));
  const games = catalog ? new Map([...catalog].map((g) => [g.id, g])) : undefined;
  const minutes = (m: TimetableMatch) => {
    const tg = byId.get(m.tournament_game_id);
    return tg && (m.best_of ?? 1) > 1 ? seriesMinutes({ best_of: m.best_of ?? 1, leg_games: m.leg_games ?? null }, tg, games) : undefined;
  };
  return { windows: tournamentWindows(tournament), stations: tournament.stations, games: timetableGames(list), callMinutes: tournament.call_minutes, now, minutes };
}

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);
export const matchStations = (m: Pick<Match, 'station' | 'stations'>): number[] => (m.stations?.length ? m.stations : m.station ? [m.station] : []);
/** The start time an organizer set for a queued match, or null. */
export const setTime = (m: TimetableMatch): number | null =>
  m.time_locked && !m.is_bye && (m.status === 'pending' || m.status === 'ready') ? ms(m.not_before) : null;

/**
 * Place every queued match (pending or ready) on the stations. Called and
 * live matches keep their stations until they are expected to finish.
 * Among the matches that could go next, the one that can start earliest wins,
 * then group stage before knockout, lower rounds, game order and position.
 * A match never starts before its feeder matches (plus break) are done, a
 * team is never in two places at once, and a knockout after groups waits for
 * the whole group stage. A match with a set time (time_locked) gets its
 * stations held at that time first, and other matches go round it.
 */
export function scheduleTournament(matches: TimetableMatch[], options: TimetableOptions): TimetableResult {
  const { windows, stations, games } = options;
  if (windows.length === 0) throw new Error('The tournament needs at least one day');
  if (stations < 1) throw new Error('At least one station is needed');
  const lastClose = windows[windows.length - 1].end;
  const floor = Math.max(windows[0].start, options.now ?? -Infinity);
  const now = options.now ?? floor;
  const base = (m: TimetableMatch) =>
    games.get(m.tournament_game_id) ?? { matchMinutes: 20, bufferMinutes: 5, stationsRequired: 1, allowedStations: null, order: 0 };
  const game = (m: TimetableMatch): TimetableGame => {
    const g = base(m);
    const own = options.minutes?.(m);
    return own ? { ...g, matchMinutes: own } : g;
  };

  const stationFree = Array.from({ length: stations }, () => floor);
  const readyAt = new Map<string, number>();
  const teamFree = new Map<string, number>();
  const book = (m: TimetableMatch, until: number) => {
    for (const t of [m.team_a_id, m.team_b_id]) if (t) teamFree.set(t, Math.max(teamFree.get(t) ?? -Infinity, until));
  };
  const occupy = (list: number[], until: number) => {
    for (const s of list) if (s >= 1 && s <= stations) stationFree[s - 1] = Math.max(stationFree[s - 1], until);
  };

  for (const m of matches) {
    const g = game(m);
    const duration = g.matchMinutes * MINUTE;
    const buffer = g.bufferMinutes * MINUTE;
    if (m.is_bye && m.status === 'completed') {
      readyAt.set(m.id, -Infinity);
    } else if (m.is_bye) {
      // A loser-bracket bye waiting for its one team: ready when its feeders are (below).
    } else if (m.status === 'completed') {
      const end = (ms(m.ended_at) ?? floor) + buffer;
      readyAt.set(m.id, end);
      book(m, end);
    } else if (m.status === 'live' || m.status === 'called') {
      const start = m.status === 'live' ? ms(m.started_at) ?? now : Math.max((ms(m.called_at) ?? now) + options.callMinutes * MINUTE, now);
      const end = Math.max(start + duration, now) + buffer;
      readyAt.set(m.id, end);
      book(m, end);
      occupy(matchStations(m), end);
    }
  }

  // A match waits for the matches its teams come from: winners, and in a double elimination losers too.
  const feeders = new Map<string, string[]>();
  for (const m of matches) {
    for (const to of [m.next_match_id, m.loser_next_match_id]) if (to) feeders.set(to, [...(feeders.get(to) ?? []), m.id]);
  }
  // A waiting bye passes its team straight on, so look through it to the matches behind it.
  const waitingBye = new Set(matches.filter((m) => m.is_bye && m.status !== 'completed').map((m) => m.id));
  const depsOf = (id: string): string[] => (feeders.get(id) ?? []).flatMap((f) => (waitingBye.has(f) ? depsOf(f) : [f]));
  // Uploaded days have no feeder links, so a stage waits for the same game's earlier stages that day.
  const uploadedDay = new Map<string, TimetableMatch[]>();
  for (const m of matches) {
    if (m.round_code && m.fixture_day) {
      const key = `${m.tournament_game_id}|${m.fixture_day}`;
      uploadedDay.set(key, [...(uploadedDay.get(key) ?? []), m]);
    }
  }
  const earlierStages = (m: TimetableMatch): string[] =>
    m.round_code && m.fixture_day
      ? (uploadedDay.get(`${m.tournament_game_id}|${m.fixture_day}`) ?? []).filter((x) => x.round < m.round && !(x.is_bye && x.status === 'completed')).map((x) => x.id)
      : [];
  const groupMatches = new Map<string, string[]>();
  for (const m of matches) {
    if (m.stage === 'group') groupMatches.set(m.tournament_game_id, [...(groupMatches.get(m.tournament_game_id) ?? []), m.id]);
  }

  const fit = (earliest: number, duration: number): { start: number; overflow: boolean } => {
    for (const w of windows) {
      if (earliest >= w.end) continue;
      const start = Math.max(earliest, w.start);
      if (start + duration <= w.end) return { start, overflow: false };
    }
    return { start: Math.max(earliest, lastClose), overflow: true };
  };

  const allStations = Array.from({ length: stations }, (_, i) => i + 1);
  const exists = (s: number) => s >= 1 && s <= stations;
  // A game's stations that still exist; when too few are left (the venue lost stations), any station.
  const gameStations = (g: TimetableGame) => {
    const list = (g.allowedStations ?? allStations).filter(exists);
    return list.length >= Math.max(1, g.stationsRequired) ? list : allStations;
  };
  // An uploaded fixture with a station keeps it, unless that station is gone; everything else may use any of its game's stations.
  const locked = (m: TimetableMatch) => m.station_locked && matchStations(m).length > 0 && matchStations(m).every(exists);
  const allowedFor = (g: TimetableGame, m: TimetableMatch) => (locked(m) ? matchStations(m) : gameStations(g));
  const needed = (g: TimetableGame, m: TimetableMatch) => (locked(m) ? matchStations(m).length : Math.max(1, g.stationsRequired));
  const slots: TimetableSlot[] = [];
  const unplaced: string[] = [];
  let todo = matches.filter((m) => {
    if (m.is_bye || (m.status !== 'pending' && m.status !== 'ready')) return false;
    const g = game(m);
    if (allowedFor(g, m).length >= needed(g, m)) return true;
    unplaced.push(m.id);
    return false;
  });

  // Matches with a set time hold their stations (and players) at that time; everything else fits round them.
  interface Hold {
    id: string;
    stations: number[];
    teams: string[];
    start: number;
    /** End plus break. */
    end: number;
  }
  const holds = new Map<string, Hold>();
  for (const m of todo.filter((x) => setTime(x) != null).sort((a, b) => setTime(a)! - setTime(b)!)) {
    const g = game(m);
    const at = Math.max(setTime(m)!, floor);
    const end = at + (g.matchMinutes + g.bufferMinutes) * MINUTE;
    const clash = (s: number) => [...holds.values()].some((h) => h.stations.includes(s) && at < h.end && h.start < end);
    const picks = allowedFor(g, m)
      .sort((a, b) => Number(clash(a)) - Number(clash(b)) || Math.max(stationFree[a - 1], at) - Math.max(stationFree[b - 1], at) || a - b)
      .slice(0, needed(g, m));
    holds.set(m.id, { id: m.id, stations: picks, teams: [m.team_a_id, m.team_b_id].filter((t): t is string => !!t), start: at, end });
  }
  const placed = new Set<string>();
  // The earliest start from `from` on these stations that fits the hours and stays clear of every set-time match still to come.
  const clearOfHolds = (m: TimetableMatch, list: number[], from: number, g: TimetableGame) => {
    const duration = g.matchMinutes * MINUTE;
    const span = duration + g.bufferMinutes * MINUTE;
    const teams = [m.team_a_id, m.team_b_id].filter(Boolean);
    let at = fit(from, duration);
    for (let i = 0; i <= holds.size; i++) {
      const s = at.start;
      const hit = [...holds.values()].filter(
        (h) => h.id !== m.id && !placed.has(h.id) && s < h.end && h.start < s + span && (h.stations.some((x) => list.includes(x)) || h.teams.some((t) => teams.includes(t))),
      );
      if (!hit.length) return at;
      at = fit(Math.max(...hit.map((h) => h.end)), duration);
    }
    return at;
  };
  const inHours = (start: number, duration: number) => windows.some((w) => start >= w.start && start + duration <= w.end);

  while (todo.length) {
    let best: { m: TimetableMatch; start: number; overflow: boolean; picks: number[] } | null = null;
    for (const m of todo) {
      const g = game(m);
      const deps = [...depsOf(m.id), ...earlierStages(m)];
      if (deps.some((id) => !readyAt.has(id))) continue;
      const groups = m.stage !== 'group' ? groupMatches.get(m.tournament_game_id) ?? [] : [];
      if (groups.some((id) => !readyAt.has(id))) continue;
      const earliest = Math.max(
        floor,
        ms(m.not_before) ?? -Infinity,
        ...deps.map((id) => readyAt.get(id)!),
        ...groups.map((id) => readyAt.get(id)!),
        ...[m.team_a_id, m.team_b_id].map((t) => (t ? teamFree.get(t) ?? -Infinity : -Infinity)),
      );
      const hold = holds.get(m.id);
      let start: number;
      let overflow: boolean;
      let picks: number[];
      if (hold) {
        // A set time: its own stations, at that time (later only if its players or stations aren't free yet).
        picks = hold.stations;
        start = Math.max(earliest, ...picks.map((s) => stationFree[s - 1]));
        overflow = !inHours(start, g.matchMinutes * MINUTE);
      } else {
        // The stations that free up first (lowest number on ties).
        const opens = (s: number) => clearOfHolds(m, [s], Math.max(stationFree[s - 1], earliest), g).start;
        picks = allowedFor(g, m)
          .map((s) => [s, holds.size ? opens(s) : Math.max(stationFree[s - 1], earliest)] as const)
          .sort((a, b) => a[1] - b[1] || a[0] - b[0])
          .slice(0, needed(g, m))
          .map(([s]) => s);
        ({ start, overflow } = clearOfHolds(m, picks, Math.max(earliest, ...picks.map((s) => stationFree[s - 1])), g));
      }
      if (!best || start < best.start || (start === best.start && before(m, best.m, games))) best = { m, start, overflow, picks };
    }
    if (!best) {
      // Waiting on something that can never be placed.
      unplaced.push(...todo.map((m) => m.id));
      break;
    }
    const g = game(best.m);
    const end = best.start + g.matchMinutes * MINUTE;
    const picks = [...best.picks].sort((a, b) => a - b);
    occupy(picks, end + g.bufferMinutes * MINUTE);
    readyAt.set(best.m.id, end + g.bufferMinutes * MINUTE);
    book(best.m, end + g.bufferMinutes * MINUTE);
    slots.push({ id: best.m.id, station: picks[0], stations: picks, start: best.start, end, overflow: best.overflow });
    const done = best.m.id;
    placed.add(done);
    todo = todo.filter((x) => x.id !== done);
  }

  const finishesAt = slots.length ? Math.max(...slots.map((s) => s.end)) : null;
  const overflowMinutes = finishesAt != null && finishesAt > lastClose ? Math.ceil((finishesAt - lastClose) / MINUTE) : 0;
  return { slots, fits: !slots.some((s) => s.overflow) && unplaced.length === 0, overflowMinutes, finishesAt, unplaced };
}

/**
 * The timetable with automatic time changes off: a queued match with a
 * planned time and station keeps them, however late the matches before it
 * run. Only matches without a plan get their place from scheduleTournament.
 */
export function plannedTimetable(matches: TimetableMatch[], options: TimetableOptions): TimetableResult {
  const auto = scheduleTournament(matches, options);
  const byId = new Map(matches.map((m) => [m.id, m]));
  const minutes = (m: TimetableMatch) => options.minutes?.(m) ?? options.games.get(m.tournament_game_id)?.matchMinutes ?? 20;
  const lastClose = options.windows[options.windows.length - 1].end;
  const slots = auto.slots.map((s) => {
    const m = byId.get(s.id);
    const start = ms(m?.not_before);
    const stations = m ? matchStations(m) : [];
    if (!m || m.is_bye || (m.status !== 'pending' && m.status !== 'ready') || start == null || !stations.length) return s;
    const end = start + minutes(m) * MINUTE;
    return { id: s.id, station: stations[0], stations, start, end, overflow: end > lastClose };
  });
  const finishesAt = slots.length ? Math.max(...slots.map((s) => s.end)) : null;
  const overflowMinutes = finishesAt != null && finishesAt > lastClose ? Math.ceil((finishesAt - lastClose) / MINUTE) : 0;
  return { slots, fits: !slots.some((s) => s.overflow) && auto.unplaced.length === 0, overflowMinutes, finishesAt, unplaced: auto.unplaced };
}

/** The tournament's timetable, moving times automatically unless the organiser turned that off. */
export const tournamentTimetable = (matches: TimetableMatch[], options: TimetableOptions, autoTimes = true): TimetableResult =>
  autoTimes ? scheduleTournament(matches, options) : plannedTimetable(matches, options);

function rank(m: TimetableMatch, games: Map<string, TimetableGame>): number {
  // Smaller is earlier: group stage, then round, then game, then position.
  return (m.stage === 'group' ? 0 : 1) * 1e9 + m.round * 1e6 + (games.get(m.tournament_game_id)?.order ?? 0) * 1e3 + m.position;
}

/**
 * Which of two matches that could start at the same time goes first (smaller
 * first): the organizer's own order when they moved it, else rank.
 */
export function queueKey(m: TimetableMatch, games: Map<string, TimetableGame>): number {
  return m.queue_key ?? rank(m, games);
}

const before = (a: TimetableMatch, b: TimetableMatch, games: Map<string, TimetableGame>) =>
  queueKey(a, games) < queueKey(b, games) || (queueKey(a, games) === queueKey(b, games) && rank(a, games) < rank(b, games));

/** Why a match can't move: what holds it where it is. */
export type StuckReason =
  | { kind: 'edge' }
  | { kind: 'round' }
  | { kind: 'team'; teamId: string }
  | { kind: 'station'; station: number }
  | { kind: 'set_time' }
  | { kind: 'other' };

/** What a move saves: the match's new queue_key and any start times (not_before) it swaps. */
export interface QueueMove {
  key: number;
  notBefore: Map<string, string | null>;
  result: TimetableResult;
}

/**
 * Move a match one place earlier (or later) in the timetable: just before
 * (after) the first queued neighbour whose turn it can take, so the rest of
 * the queue keeps its order. When its start time (an uploaded sheet's time,
 * or a skip) is what holds it, it swaps start times with that neighbour.
 * Returns why it can't move when nothing it could pass is in the way.
 */
export function moveInQueue<M extends TimetableMatch>(
  matches: M[],
  options: TimetableOptions,
  id: string,
  direction: 'earlier' | 'later',
  among: (m: M) => boolean = () => true,
): QueueMove | { stuck: StuckReason } {
  const { games } = options;
  const target = matches.find((m) => m.id === id);
  if (!target) return { stuck: { kind: 'other' } };
  if (setTime(target) != null) return { stuck: { kind: 'set_time' } };
  const base = scheduleTournament(matches, options);
  const slotOf = (r: TimetableResult) => new Map(r.slots.map((s) => [s.id, s]));
  const at = slotOf(base);
  const place = (s: TimetableSlot | undefined) => (s ? s.start * 100 + s.station : Infinity);
  const queue = matches
    .filter((m) => at.has(m.id) && (m.id === id || among(m)))
    .sort((a, b) => place(at.get(a.id)) - place(at.get(b.id)));
  const i = queue.findIndex((m) => m.id === id);
  if (i < 0) return { stuck: { kind: 'other' } };
  const own = queueKey(target, games);
  const keys = matches.filter((m) => m.id !== id && at.has(m.id)).map((m) => queueKey(m, games));
  const later = direction === 'later';
  const step = later ? 1 : -1;
  const time = (iso: string | null) => (iso ? new Date(iso).getTime() : null);
  for (let j = i + step; j >= 0 && j < queue.length; j += step) {
    const other = queue[j];
    const pass = queueKey(other, games);
    const next = later ? Math.min(...keys.filter((k) => k > pass)) : Math.max(...keys.filter((k) => k < pass));
    // Already ahead of (behind) it in the queue: only the start times can change places.
    const key = (later ? own > pass : own < pass) ? own : Number.isFinite(next) ? (pass + next) / 2 : pass + step;
    // Its own start time holds it back (forward): take the neighbour's, and give it ours when both have one.
    const mine = time(target.not_before);
    const theirs = time(other.not_before);
    const notBefore = new Map<string, string | null>();
    if (mine != null && (theirs == null || (later ? mine < theirs : mine > theirs))) {
      notBefore.set(id, other.not_before);
      if (theirs != null) notBefore.set(other.id, target.not_before);
    }
    if (key === own && notBefore.size === 0) continue;
    const result = scheduleTournament(
      matches.map((m) => (m.id === id ? { ...m, queue_key: key } : m)).map((m) => (notBefore.has(m.id) ? { ...m, not_before: notBefore.get(m.id)! } : m)),
      options,
    );
    const moved = place(slotOf(result).get(id));
    if (later ? moved > place(at.get(id)) : moved < place(at.get(id))) return { key, notBefore, result };
  }
  return { stuck: stuckReason(matches, options, target, at, later, later ? i === queue.length - 1 : i === 0) };
}

function stuckReason<M extends TimetableMatch>(
  matches: M[],
  options: TimetableOptions,
  target: M,
  at: Map<string, TimetableSlot>,
  later: boolean,
  edge: boolean,
): StuckReason {
  if (later || edge) return { kind: 'edge' };
  const feeds = matches.some(
    (m) =>
      m.status !== 'completed' &&
      m.tournament_game_id === target.tournament_game_id &&
      (m.next_match_id === target.id ||
        m.loser_next_match_id === target.id ||
        (!!target.round_code && m.fixture_day === target.fixture_day && !!m.round_code && m.round < target.round)),
  );
  if (feeds) return { kind: 'round' };
  const start = at.get(target.id)?.start ?? Infinity;
  for (const m of matches) {
    if (m.id === target.id || m.is_bye || m.status === 'completed') continue;
    const busy = m.status === 'live' || m.status === 'called' || (at.get(m.id)?.start ?? Infinity) < start;
    if (!busy) continue;
    const team = [target.team_a_id, target.team_b_id].find((t) => t && (t === m.team_a_id || t === m.team_b_id));
    if (team) return { kind: 'team', teamId: team };
  }
  const list = matchStations(target);
  if (target.station_locked && list.length > 0 && list.every((s) => s >= 1 && s <= options.stations)) return { kind: 'station', station: list[0] };
  return { kind: 'other' };
}

/** What a reschedule saves, and how it changes the timetable. */
export interface Reschedule {
  result: TimetableResult;
  /** Where the match lands (null when it can't be placed). */
  slot: TimetableSlot | null;
  /** Other queued matches whose time or station changes. */
  shifted: string[];
}

/**
 * Plan a queued match at a set time (null: back to the usual order) and
 * rebuild the timetable round it, without saving. The match takes the time
 * unless its players or the round it waits for aren't done by then; other
 * matches move out of its way.
 */
export function rescheduleInTimetable<M extends TimetableMatch>(matches: M[], options: TimetableOptions, id: string, at: number | null): Reschedule {
  const before = new Map(scheduleTournament(matches, options).slots.map((s) => [s.id, s]));
  const result = scheduleTournament(
    matches.map((m) => (m.id === id ? { ...m, not_before: at == null ? null : new Date(at).toISOString(), time_locked: at != null } : m)),
    options,
  );
  const shifted = result.slots
    .filter((s) => {
      if (s.id === id) return false;
      const was = before.get(s.id);
      return !was || was.start !== s.start || was.station !== s.station;
    })
    .map((s) => s.id);
  return { result, slot: result.slots.find((s) => s.id === id) ?? null, shifted };
}

/** Of the planned matches, which still play inside a day's hours and which spill past its close. */
export function splitAtClose(result: TimetableResult, day: DayWindow): { today: TimetableSlot[]; later: TimetableSlot[] } {
  const today = result.slots.filter((s) => s.start < day.end && s.end <= day.end && s.end > day.start);
  const later = result.slots.filter((s) => s.end > day.end);
  return { today, later };
}

type DayTournament = Parameters<typeof timetableOptions>[0];

/** The tournament day it is now (event time zone), or null outside the tournament. */
export function todayOf(t: DayTournament, now = Date.now()): DayWindow | null {
  const date = zonedDate(now, t.timezone);
  return tournamentWindows(t).find((w) => w.date === date) ?? null;
}

export interface DayPreview {
  day: DayWindow;
  /** Queued matches that play inside the day's hours. */
  today: number;
  /** Queued matches that move to a later day. */
  later: number;
  /** Queued matches that run past the last day (no day left for them). */
  beyond: number;
  result: TimetableResult;
}

/**
 * How the rest of a day plays out with other hours for it (undefined keeps
 * its hours; null goes back to the daily hours): what still plays that day
 * and what moves on. Nothing is saved.
 */
export function previewDay(
  t: DayTournament,
  tgames: Iterable<TournamentGame>,
  matches: TimetableMatch[],
  date: string,
  hours?: DayHours | null,
  now = Date.now(),
  catalog?: Iterable<Game>,
): DayPreview | null {
  const day_hours = { ...(t.day_hours ?? {}) };
  if (hours) day_hours[date] = hours;
  else if (hours === null) delete day_hours[date];
  const tournament = { ...t, day_hours };
  const options = timetableOptions(tournament, tgames, now, catalog);
  const day = options.windows.find((w) => w.date === date);
  if (!day) return null;
  const result = scheduleTournament(matches, options);
  const lastClose = options.windows[options.windows.length - 1].end;
  const { today, later } = splitAtClose(result, day);
  const beyond = result.slots.filter((s) => s.overflow && s.end > lastClose).length;
  return { day, today: today.length, later: later.length - beyond, beyond, result };
}

/** What each station is doing now and what it plays next, from a saved timetable. */
export interface StationState<M> {
  station: number;
  /** Called or live match on this station. */
  current: M | null;
  /** Queued matches planned here, soonest first. */
  queue: M[];
}

export function stationBoard<M extends Pick<Match, 'status' | 'station' | 'stations' | 'scheduled_start' | 'is_bye'>>(
  matches: Iterable<M>,
  stations: number,
): StationState<M>[] {
  const board = Array.from({ length: stations }, (_, i): StationState<M> => ({ station: i + 1, current: null, queue: [] }));
  for (const m of matches) {
    if (m.is_bye) continue;
    const list = matchStations(m);
    if (m.status === 'called' || m.status === 'live') {
      for (const s of list) if (board[s - 1]) board[s - 1].current = m;
    } else if ((m.status === 'ready' || m.status === 'pending') && m.station && board[m.station - 1]) {
      board[m.station - 1].queue.push(m);
    }
  }
  for (const b of board) b.queue.sort((x, y) => (x.scheduled_start ?? '9').localeCompare(y.scheduled_start ?? '9'));
  return board;
}

/** Seconds left for called players to reach their station (negative once late). */
export function callSecondsLeft(m: Pick<Match, 'called_at'>, callMinutes: number, now = Date.now()): number | null {
  const at = ms(m.called_at);
  return at == null ? null : Math.round((at + callMinutes * MINUTE - now) / 1000);
}

export function countdown(seconds: number): string {
  const s = Math.abs(seconds);
  return `${seconds < 0 ? '-' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "Station 3", or "Stations 1 + 2" for a match that takes more than one. */
export function stationLabel(m: Pick<Match, 'station' | 'stations'>): string {
  const list = matchStations(m);
  if (list.length === 0) return '';
  return list.length === 1 ? `Station ${list[0]}` : `Stations ${[...list].sort((a, b) => a - b).join(' + ')}`;
}
