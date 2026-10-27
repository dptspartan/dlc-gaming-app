import { addDays, zonedToUtc } from './time';
import type { Match, Slot, Team, Tournament, TournamentGame } from './types';

/**
 * Fixtures an organiser uploads as CSV, one sheet at a time, instead of
 * generating the whole bracket. Each stage has a fixed knockout round so the
 * stages order themselves. A side can be a player or "Winner of FC-PI-03":
 * those link the matches, so a winner moves on as soon as the result is in.
 */

export const ROUND_CODES = ['PRE', 'R32', 'R16', 'QF', 'SF', 'F'] as const;
export type RoundCode = (typeof ROUND_CODES)[number];

export const ROUND_LABEL: Record<RoundCode, string> = {
  PRE: 'Preliminary',
  R32: 'Round of 32',
  R16: 'Round of 16',
  QF: 'Quarter-final',
  SF: 'Semi-final',
  F: 'Final',
};

/** Knockout round of each stage, so a game's columns sort Preliminary → Final. */
export const ROUND_NUMBER: Record<RoundCode, number> = { PRE: 1, R32: 2, R16: 3, QF: 4, SF: 5, F: 6 };

const ALIASES: Record<string, RoundCode> = {
  pre: 'PRE',
  prelim: 'PRE',
  prelims: 'PRE',
  preliminary: 'PRE',
  preliminaries: 'PRE',
  playin: 'PRE',
  preliminaryplayin: 'PRE',
  r32: 'R32',
  roundof32: 'R32',
  last32: 'R32',
  r16: 'R16',
  roundof16: 'R16',
  last16: 'R16',
  qf: 'QF',
  quarter: 'QF',
  quarters: 'QF',
  quarterfinal: 'QF',
  quarterfinals: 'QF',
  sf: 'SF',
  semi: 'SF',
  semis: 'SF',
  semifinal: 'SF',
  semifinals: 'SF',
  f: 'F',
  final: 'F',
};

const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "Round of 16", "Preliminary / play-in", "Quarterfinal"… → the stage code, or null. */
export function parseRoundCode(input: string): RoundCode | null {
  return ALIASES[squash(input)] ?? null;
}

/**
 * Header names each column is known by: ours, and the ones organisers' sheets
 * use ("Player / qualifier A", "Planned day", "Setup", "Wave"…), compared
 * without case, spaces or punctuation.
 */
const HEADERS = {
  stage: ['stage', 'round'],
  code: ['matchid', 'matchcode', 'match', 'id', 'code'],
  date: ['date', 'day', 'plannedday', 'targetday'],
  time: ['time', 'start', 'starttime', 'matchstart', 'kickoff'],
  station: ['station'],
  setup: ['setup'],
  wave: ['wave', 'targetslot', 'slot'],
  side_a: ['sidea', 'playera', 'teama', 'playerqualifiera', 'playerasource', 'playerorqualifiera'],
  side_b: ['sideb', 'playerb', 'teamb', 'playerqualifierb', 'playerbsource', 'playerorqualifierb'],
} as const;
type Column = keyof typeof HEADERS;

/** A CSV the organiser can fill in, showing every column and a winner link. */
export function fixturesTemplate(teams: Pick<Team, 'name'>[]): string {
  const cell = (v: string) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const [a = 'Player one', b = 'Player two', c = 'Player three', d = 'Player four', e = 'Player five'] = teams.map((t) => cell(t.name));
  return (
    [
      'Round,Match ID,Player A,Player B,Setup,Planned day,Wave',
      `Preliminary,PI-01,${a},${b},Setup 1,Monday,Wave 1`,
      `Preliminary,PI-02,${c},${d},Setup 1,Monday,Wave 2`,
      `Round of 32,R32-01,Winner of PI-01,${e},Setup 1,Tuesday,Wave 1`,
      `Round of 32,R32-02,Winner of PI-02,TBD,Setup 1,Tuesday,Wave 2`,
    ].join('\n') + '\n'
  );
}

export interface FixtureRow {
  /** 1-based line in the file, for error messages. */
  line: number;
  round_code: RoundCode;
  /** The sheet's match id (FC-PI-03), when it has one. */
  match_code: string | null;
  /** Event-local date, YYYY-MM-DD. */
  date: string;
  /** Event-local time, HH:MM, when the file gives one. */
  time: string | null;
  /** Order within the day ("Wave 3"), when the file gives one. */
  wave: number | null;
  station: number | null;
  team_a_id: string | null;
  team_b_id: string | null;
  /** Match whose winner takes the side ("Winner of FC-PI-03"). */
  a_from: string | null;
  b_from: string | null;
}

export interface FixtureIssue {
  line: number;
  message: string;
}

export interface ParsedFixtures {
  rows: FixtureRow[];
  errors: FixtureIssue[];
  /** Player names the game does not have yet (to offer adding them). */
  unknownNames: string[];
}

type Ctx = {
  tournament: Pick<Tournament, 'start_date' | 'days' | 'stations'>;
  tg: Pick<TournamentGame, 'allowed_stations'>;
  teams: Pick<Team, 'id' | 'name'>[];
  /** Day for rows without one (a sheet with no day column). */
  defaultDate?: string | null;
  /** Match codes already uploaded for this game, for "Winner of …" across files. */
  existingCodes?: Iterable<string>;
};

/** Split one CSV line, honouring double-quoted fields ("Smith, J"). */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

const isTbd = (v: string) => v === '' || /^(tbd|tba|-|\?)$/i.test(v);
const WINNER = /^winner\s+(?:of\s+)?([a-z0-9][a-z0-9_-]*)$/i;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const firstNumber = (v: string) => {
  const m = /\d+/.exec(v);
  return m ? Number(m[0]) : null;
};

/** "17:30", "17:30:00", "5:30 PM" or "5:30:00 pm" (as spreadsheets export times) → "17:30", or null. */
function parseClock(raw: string): string | null {
  const t = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i.exec(raw.trim());
  if (!t) return null;
  let h = Number(t[1]);
  const m = Number(t[2]);
  const pm = t[3]?.toLowerCase().startsWith('p');
  if (t[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (pm ? 12 : 0);
  }
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** The tournament date for "2026-11-02", "Monday" or "Thursday (Friday buffer)", or an error. */
function resolveDay(raw: string, dates: string[]): { date?: string; error?: string } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    if (Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) return { error: `Date "${raw}" is not YYYY-MM-DD.` };
    return dates.includes(raw) ? { date: raw } : { error: `${raw} is outside the tournament (${dates[0]} to ${dates[dates.length - 1]}).` };
  }
  const word = raw.toLowerCase().match(/[a-z]+/)?.[0] ?? '';
  const wd = WEEKDAYS.findIndex((d) => word.length >= 3 && d.startsWith(word));
  if (wd < 0) return { error: `Day "${raw}" is not a date (YYYY-MM-DD) or a weekday.` };
  const date = dates.find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === wd);
  if (!date) return { error: `${WEEKDAYS[wd][0].toUpperCase()}${WEEKDAYS[wd].slice(1)} is not one of the tournament days (${dates[0]} to ${dates[dates.length - 1]}).` };
  return { date };
}

/**
 * Read one uploaded fixtures sheet (CSV). Every problem is reported against
 * its line so the organiser can fix the file; rows with errors are left out
 * of `rows`.
 */
export function parseFixturesCsv(text: string, ctx: Ctx): ParsedFixtures {
  const errors: FixtureIssue[] = [];
  const rows: FixtureRow[] = [];
  const unknown = new Set<string>();
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const headerAt = lines.findIndex((l) => l.trim() !== '');
  if (headerAt < 0) return { rows, errors: [{ line: 1, message: 'The file is empty.' }], unknownNames: [] };

  const header = splitLine(lines[headerAt]).map(squash);
  const col = Object.fromEntries(
    (Object.keys(HEADERS) as Column[]).map((c) => [c, header.findIndex((h) => (HEADERS[c] as readonly string[]).includes(h))]),
  ) as Record<Column, number>;
  const missing = (['stage', 'side_a', 'side_b'] as const).filter((c) => col[c] < 0);
  if (missing.length) {
    const names = { stage: 'Round (or stage)', side_a: 'Player A', side_b: 'Player B' };
    return {
      rows,
      errors: [{ line: headerAt + 1, message: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.map((c) => names[c]).join(', ')}.` }],
      unknownNames: [],
    };
  }

  const byName = new Map(ctx.teams.map((t) => [t.name.trim().toLowerCase(), t.id]));
  const dates = Array.from({ length: Math.max(1, ctx.tournament.days) }, (_, i) => addDays(ctx.tournament.start_date, i));
  const allowed = ctx.tg.allowed_stations?.length ? ctx.tg.allowed_stations : null;
  const seenTeam = new Map<string, number>();
  const seenSlot = new Map<string, number>();
  const seenCode = new Map<string, number>();
  const seenFrom = new Map<string, number>();
  const pending: { row: FixtureRow; refs: [string, string][] }[] = [];

  for (let i = headerAt + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '' || splitLine(raw).every((c) => c === '')) continue;
    const line = i + 1;
    const cells = splitLine(raw);
    const get = (c: Column) => (col[c] >= 0 ? cells[col[c]] ?? '' : '');
    const issues: string[] = [];

    const round_code = parseRoundCode(get('stage'));
    if (!round_code) issues.push(`Unknown round "${get('stage')}". Use Preliminary, Round of 32, Round of 16, Quarterfinal, Semifinal or Final.`);

    const codeRaw = get('code');
    const match_code = codeRaw ? codeRaw.toUpperCase() : null;
    if (match_code && !/^[A-Z0-9][A-Z0-9_-]*$/.test(match_code)) issues.push(`Match ID "${codeRaw}" may only use letters, numbers, - and _.`);
    else if (match_code) {
      const prev = seenCode.get(match_code);
      if (prev) issues.push(`Match ID ${match_code} is used twice (line ${prev}).`);
      else seenCode.set(match_code, line);
    }

    const dayRaw = get('date');
    let date: string | null = null;
    if (dayRaw) {
      const d = resolveDay(dayRaw, dates);
      if (d.error) issues.push(d.error);
      else date = d.date!;
    } else if (ctx.defaultDate) date = ctx.defaultDate;
    else issues.push('No day for this match. Add a day column, or pick a day for rows without one.');

    const timeRaw = get('time');
    let time: string | null = null;
    if (timeRaw) {
      time = parseClock(timeRaw);
      if (!time) issues.push(`Time "${timeRaw}" is not a time like 17:30 or 5:30 PM.`);
    }

    const waveRaw = get('wave');
    const wave = waveRaw ? firstNumber(waveRaw) : null;
    if (waveRaw && wave == null) issues.push(`Wave "${waveRaw}" has no number.`);

    // "Station 3" is a venue station; "Setup 2" is the game's second station.
    let station: number | null = null;
    const stationRaw = get('station');
    const setupRaw = get('setup');
    if (stationRaw) {
      const n = Number(stationRaw);
      if (!Number.isInteger(n) || n < 1 || n > ctx.tournament.stations) issues.push(`Station "${stationRaw}" does not exist (1 to ${ctx.tournament.stations}).`);
      else if (allowed && !allowed.includes(n)) issues.push(`Station ${n} is not one this game can use (${allowed.join(', ')}).`);
      else station = n;
    } else if (setupRaw) {
      const n = firstNumber(setupRaw);
      const list = allowed ?? Array.from({ length: ctx.tournament.stations }, (_, k) => k + 1);
      if (n == null || n < 1) issues.push(`Setup "${setupRaw}" has no number.`);
      else if (n > list.length) issues.push(`"${setupRaw}" but this game has ${list.length} station${list.length > 1 ? 's' : ''} (${list.join(', ')}).`);
      else station = list[n - 1];
    }

    const refs: [string, string][] = [];
    const side = (v: string): { team: string | null; from: string | null } => {
      if (isTbd(v)) return { team: null, from: null };
      const w = WINNER.exec(v);
      if (w) {
        const from = w[1].toUpperCase();
        refs.push([from, v]);
        return { team: null, from };
      }
      const id = byName.get(v.toLowerCase());
      if (!id) {
        issues.push(`"${v}" is not a player or team in this game.`);
        unknown.add(v);
      }
      return { team: id ?? null, from: null };
    };
    const a = side(get('side_a'));
    const b = side(get('side_b'));
    if (a.team && a.team === b.team) issues.push(`"${get('side_a')}" cannot play themselves.`);
    if (a.from && a.from === b.from) issues.push(`Both sides are the winner of ${a.from}.`);

    if (issues.length === 0 && round_code && date) {
      for (const id of [a.team, b.team]) {
        if (!id) continue;
        const key = `${round_code}|${date}|${id}`;
        const prev = seenTeam.get(key);
        if (prev) issues.push(`${ctx.teams.find((t) => t.id === id)?.name} already plays this round that day (line ${prev}).`);
        else seenTeam.set(key, line);
      }
      if (time && station) {
        const key = `${date}|${time}|${station}`;
        const prev = seenSlot.get(key);
        if (prev) issues.push(`Station ${station} already has a match at ${time} (line ${prev}).`);
        else seenSlot.set(key, line);
      }
      for (const [from] of refs) {
        const prev = seenFrom.get(from);
        if (prev) issues.push(`The winner of ${from} is already placed on line ${prev}.`);
        else seenFrom.set(from, line);
      }
    }

    if (issues.length) errors.push(...issues.map((message) => ({ line, message })));
    else {
      const row: FixtureRow = {
        line,
        round_code: round_code!,
        match_code,
        date: date!,
        time,
        wave,
        station,
        team_a_id: a.team,
        team_b_id: b.team,
        a_from: a.from,
        b_from: b.from,
      };
      pending.push({ row, refs });
    }
  }

  // A winner link must name a match in this sheet or one already uploaded, from an earlier round.
  const existing = new Set(ctx.existingCodes ?? []);
  const roundOf = new Map(pending.filter((p) => p.row.match_code).map((p) => [p.row.match_code!, ROUND_NUMBER[p.row.round_code]]));
  for (const { row, refs } of pending) {
    const issues: string[] = [];
    for (const [from, text] of refs) {
      if (!roundOf.has(from) && !existing.has(from) && !seenCode.has(from)) issues.push(`"${text}": there is no match ${from} in this file or already uploaded.`);
      else if (roundOf.has(from) && roundOf.get(from)! >= ROUND_NUMBER[row.round_code]) issues.push(`"${text}": ${from} is not in an earlier round.`);
    }
    if (issues.length) errors.push(...issues.map((message) => ({ line: row.line, message })));
    else rows.push(row);
  }
  errors.sort((x, y) => x.line - y.line);

  if (rows.length === 0 && errors.length === 0) errors.push({ line: headerAt + 1, message: 'The file has a header but no fixtures.' });
  return { rows, errors, unknownNames: [...unknown] };
}

/**
 * When an uploaded fixture may start: its time from the file, or the start of
 * that day's play, so the timetable never pulls it into an earlier day.
 */
export function fixtureNotBefore(row: Pick<FixtureRow, 'date' | 'time'>, tournament: Pick<Tournament, 'daily_start' | 'timezone'>): Date {
  return zonedToUtc(row.date, row.time ?? tournament.daily_start, tournament.timezone);
}

/** Upload order: by day, then wave, then the sheet's own order. */
export const fixtureOrder = (x: FixtureRow, y: FixtureRow) =>
  x.date.localeCompare(y.date) || (x.wave ?? Infinity) - (y.wave ?? Infinity) || x.line - y.line;

/** Whether a match came from an uploaded sheet rather than a generated bracket. */
export const isUploaded = (m: Pick<Match, 'round_code'>) => m.round_code != null;

/** A side's name: the player, "Winner FC-PI-03" while a linked match is undecided, else TBD. */
export function sideName(m: Partial<Pick<Match, 'a_from' | 'b_from' | 'is_bye'>>, slot: 'a' | 'b', team: string | null | undefined): string {
  if (team) return team;
  const from = slot === 'a' ? m.a_from : m.b_from;
  if (from) return `Winner ${from}`;
  return m.is_bye ? 'Bye' : 'TBD';
}

export interface WinnerLink {
  from: string;
  to: string;
  slot: Slot;
}

/**
 * Where each decided match's winner went, for the bracket's connecting lines:
 * its next-match link, or, for uploaded sheets where the next round was
 * uploaded with the winners' names instead of "Winner of …", the game's next
 * uploaded round that has the winner in it.
 */
export function winnerLinks(
  matches: Pick<Match, 'id' | 'tournament_game_id' | 'round' | 'position' | 'round_code' | 'status' | 'winner_id' | 'next_match_id' | 'next_slot' | 'team_a_id' | 'team_b_id'>[],
): WinnerLink[] {
  const out: WinnerLink[] = [];
  const taken = new Set<string>();
  for (const m of matches) {
    if (m.winner_id && m.status !== 'pending' && m.next_match_id && m.next_slot) {
      out.push({ from: m.id, to: m.next_match_id, slot: m.next_slot });
      taken.add(`${m.next_match_id}|${m.next_slot}`);
    }
  }
  for (const m of matches) {
    if (!m.round_code || m.next_match_id || !m.winner_id || m.status !== 'completed') continue;
    const target = matches
      .filter((t) => t.tournament_game_id === m.tournament_game_id && t.round_code && t.round > m.round && (t.team_a_id === m.winner_id || t.team_b_id === m.winner_id))
      .sort((x, y) => x.round - y.round || x.position - y.position)[0];
    if (!target) continue;
    const slot: Slot = target.team_a_id === m.winner_id ? 'a' : 'b';
    if (taken.has(`${target.id}|${slot}`)) continue;
    taken.add(`${target.id}|${slot}`);
    out.push({ from: m.id, to: target.id, slot });
  }
  return out;
}
