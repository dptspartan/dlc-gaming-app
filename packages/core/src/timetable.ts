import { MINUTE, tournamentWindows, type DayWindow } from './time';
import type { Match, Tournament, TournamentGame } from './types';

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
>;

export interface TimetableOptions {
  windows: DayWindow[];
  /** Stations at the venue, numbered 1..stations. */
  stations: number;
  games: Map<string, TimetableGame>;
  /** Minutes called players have to arrive before the match can start. */
  callMinutes: number;
  /** Nothing new is placed before this instant (ms). */
  now?: number;
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
  tournament: Pick<Tournament, 'start_date' | 'days' | 'daily_start' | 'daily_end' | 'timezone' | 'stations' | 'call_minutes'>,
  tgames: Iterable<TournamentGame>,
  now?: number,
): TimetableOptions {
  return { windows: tournamentWindows(tournament), stations: tournament.stations, games: timetableGames(tgames), callMinutes: tournament.call_minutes, now };
}

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);
export const matchStations = (m: Pick<Match, 'station' | 'stations'>): number[] => (m.stations?.length ? m.stations : m.station ? [m.station] : []);

/**
 * Place every queued match (pending or ready) on the stations. Called and
 * live matches keep their stations until they are expected to finish.
 * Among the matches that could go next, the one that can start earliest wins,
 * then group stage before knockout, lower rounds, game order and position.
 * A match never starts before its feeder matches (plus break) are done, a
 * team is never in two places at once, and a knockout after groups waits for
 * the whole group stage.
 */
export function scheduleTournament(matches: TimetableMatch[], options: TimetableOptions): TimetableResult {
  const { windows, stations, games } = options;
  if (windows.length === 0) throw new Error('The tournament needs at least one day');
  if (stations < 1) throw new Error('At least one station is needed');
  const lastClose = windows[windows.length - 1].end;
  const floor = Math.max(windows[0].start, options.now ?? -Infinity);
  const now = options.now ?? floor;
  const game = (m: TimetableMatch) =>
    games.get(m.tournament_game_id) ?? { matchMinutes: 20, bufferMinutes: 5, stationsRequired: 1, allowedStations: null, order: 0 };

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
    if (m.is_bye) {
      readyAt.set(m.id, -Infinity);
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

  const feeders = new Map<string, string[]>();
  for (const m of matches) {
    if (m.next_match_id) feeders.set(m.next_match_id, [...(feeders.get(m.next_match_id) ?? []), m.id]);
  }
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
  const allowedFor = (g: TimetableGame) => (g.allowedStations ?? allStations).filter((s) => s >= 1 && s <= stations);
  const slots: TimetableSlot[] = [];
  const unplaced: string[] = [];
  let todo = matches.filter((m) => {
    if (m.is_bye || (m.status !== 'pending' && m.status !== 'ready')) return false;
    const g = game(m);
    if (allowedFor(g).length >= Math.max(1, g.stationsRequired)) return true;
    unplaced.push(m.id);
    return false;
  });

  while (todo.length) {
    let best: { m: TimetableMatch; start: number; overflow: boolean; picks: number[] } | null = null;
    for (const m of todo) {
      const g = game(m);
      const deps = feeders.get(m.id) ?? [];
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
      // The stations that free up first (lowest number on ties).
      const picks = allowedFor(g)
        .sort((a, b) => Math.max(stationFree[a - 1], earliest) - Math.max(stationFree[b - 1], earliest) || a - b)
        .slice(0, Math.max(1, g.stationsRequired));
      const { start, overflow } = fit(Math.max(earliest, ...picks.map((s) => stationFree[s - 1])), g.matchMinutes * MINUTE);
      if (!best || start < best.start || (start === best.start && rank(m, games) < rank(best.m, games))) best = { m, start, overflow, picks };
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
    todo = todo.filter((x) => x.id !== done);
  }

  const finishesAt = slots.length ? Math.max(...slots.map((s) => s.end)) : null;
  const overflowMinutes = finishesAt != null && finishesAt > lastClose ? Math.ceil((finishesAt - lastClose) / MINUTE) : 0;
  return { slots, fits: !slots.some((s) => s.overflow) && unplaced.length === 0, overflowMinutes, finishesAt, unplaced };
}

function rank(m: TimetableMatch, games: Map<string, TimetableGame>): number {
  // Smaller is earlier: group stage, then round, then game, then position.
  return (m.stage === 'group' ? 0 : 1) * 1e9 + m.round * 1e6 + (games.get(m.tournament_game_id)?.order ?? 0) * 1e3 + m.position;
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
