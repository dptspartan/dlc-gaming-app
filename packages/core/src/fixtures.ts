import { addDays, zonedToUtc } from './time';
import type { Match, Team, Tournament, TournamentGame } from './types';

/**
 * Fixtures an organiser uploads one day at a time, for one stage, instead of
 * generating the whole bracket. Each stage has a fixed knockout round so the
 * stages order themselves; winners are not moved on automatically, the next
 * day's fixtures are uploaded once that day's pairings are known.
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
  playin: 'PRE',
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

/** "Round of 16", "r16", "Quarter-finals"… → the stage code, or null. */
export function parseRoundCode(input: string): RoundCode | null {
  return ALIASES[input.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? null;
}

export const FIXTURE_COLUMNS = ['stage', 'date', 'time', 'station', 'side_a', 'side_b'] as const;

/** A CSV the organiser can fill in: header plus one example row per stage of the first day. */
export function fixturesTemplate(date: string, teams: Pick<Team, 'name'>[]): string {
  const [a = 'Player one', b = 'Player two', c = 'Player three', d = 'Player four'] = teams.map((t) => t.name);
  return [FIXTURE_COLUMNS.join(','), `R16,${date},18:00,1,${a},${b}`, `R16,${date},,,${c},${d}`, `QF,${date},20:00,,TBD,TBD`].join('\n') + '\n';
}

export interface FixtureRow {
  /** 1-based line in the file, for error messages. */
  line: number;
  round_code: RoundCode;
  /** Event-local date, YYYY-MM-DD. */
  date: string;
  /** Event-local time, HH:MM, when the file gives one. */
  time: string | null;
  station: number | null;
  team_a_id: string | null;
  team_b_id: string | null;
}

export interface FixtureIssue {
  line: number;
  message: string;
}

export interface ParsedFixtures {
  rows: FixtureRow[];
  errors: FixtureIssue[];
}

type Ctx = {
  tournament: Pick<Tournament, 'start_date' | 'days' | 'stations'>;
  tg: Pick<TournamentGame, 'allowed_stations'>;
  teams: Pick<Team, 'id' | 'name'>[];
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

/**
 * Read an uploaded fixtures CSV. Every problem is reported against its line so
 * the organiser can fix the file; rows with errors are left out of `rows`.
 */
export function parseFixturesCsv(text: string, ctx: Ctx): ParsedFixtures {
  const errors: FixtureIssue[] = [];
  const rows: FixtureRow[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const headerAt = lines.findIndex((l) => l.trim() !== '');
  if (headerAt < 0) return { rows, errors: [{ line: 1, message: 'The file is empty.' }] };

  const header = splitLine(lines[headerAt]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const col = Object.fromEntries(FIXTURE_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<(typeof FIXTURE_COLUMNS)[number], number>;
  const missing = (['stage', 'date', 'side_a', 'side_b'] as const).filter((c) => col[c] < 0);
  if (missing.length) {
    return { rows, errors: [{ line: headerAt + 1, message: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Expected: ${FIXTURE_COLUMNS.join(', ')}.` }] };
  }

  const byName = new Map(ctx.teams.map((t) => [t.name.trim().toLowerCase(), t.id]));
  const firstDay = ctx.tournament.start_date;
  const lastDay = addDays(firstDay, Math.max(1, ctx.tournament.days) - 1);
  const allowed = ctx.tg.allowed_stations?.length ? ctx.tg.allowed_stations : null;
  const seenTeam = new Map<string, number>();
  const seenSlot = new Map<string, number>();

  for (let i = headerAt + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    const line = i + 1;
    const cells = splitLine(raw);
    const get = (c: (typeof FIXTURE_COLUMNS)[number]) => (col[c] >= 0 ? cells[col[c]] ?? '' : '');
    const issues: string[] = [];

    const round_code = parseRoundCode(get('stage'));
    if (!round_code) issues.push(`Unknown stage "${get('stage')}". Use PRE, R32, R16, QF, SF or F.`);

    const date = get('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) issues.push(`Date "${date}" is not YYYY-MM-DD.`);
    else if (date < firstDay || date > lastDay) issues.push(`${date} is outside the tournament (${firstDay} to ${lastDay}).`);

    const timeRaw = get('time');
    let time: string | null = null;
    if (timeRaw) {
      const t = /^(\d{1,2}):(\d{2})$/.exec(timeRaw);
      if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) issues.push(`Time "${timeRaw}" is not HH:MM.`);
      else time = `${t[1].padStart(2, '0')}:${t[2]}`;
    }

    const stationRaw = get('station');
    let station: number | null = null;
    if (stationRaw) {
      const n = Number(stationRaw);
      if (!Number.isInteger(n) || n < 1 || n > ctx.tournament.stations) issues.push(`Station "${stationRaw}" does not exist (1 to ${ctx.tournament.stations}).`);
      else if (allowed && !allowed.includes(n)) issues.push(`Station ${n} is not one this game can use (${allowed.join(', ')}).`);
      else station = n;
    }

    const side = (v: string): string | null | undefined => {
      if (isTbd(v)) return null;
      const id = byName.get(v.toLowerCase());
      if (!id) issues.push(`"${v}" is not a player or team in this game.`);
      return id;
    };
    const team_a_id = side(get('side_a'));
    const team_b_id = side(get('side_b'));
    if (team_a_id && team_a_id === team_b_id) issues.push(`"${get('side_a')}" cannot play themselves.`);

    if (issues.length === 0 && round_code) {
      for (const id of [team_a_id, team_b_id]) {
        if (!id) continue;
        const key = `${round_code}|${date}|${id}`;
        const prev = seenTeam.get(key);
        if (prev) issues.push(`${ctx.teams.find((t) => t.id === id)?.name} already plays this stage that day (line ${prev}).`);
        else seenTeam.set(key, line);
      }
      if (time && station) {
        const key = `${date}|${time}|${station}`;
        const prev = seenSlot.get(key);
        if (prev) issues.push(`Station ${station} already has a match at ${time} (line ${prev}).`);
        else seenSlot.set(key, line);
      }
    }

    if (issues.length) errors.push(...issues.map((message) => ({ line, message })));
    else rows.push({ line, round_code: round_code!, date, time, station, team_a_id: team_a_id ?? null, team_b_id: team_b_id ?? null });
  }

  if (rows.length === 0 && errors.length === 0) errors.push({ line: headerAt + 1, message: 'The file has a header but no fixtures.' });
  return { rows, errors };
}

/**
 * When an uploaded fixture may start: its time from the file, or the start of
 * that day's play, so the timetable never pulls it into an earlier day.
 */
export function fixtureNotBefore(row: Pick<FixtureRow, 'date' | 'time'>, tournament: Pick<Tournament, 'daily_start' | 'timezone'>): Date {
  return zonedToUtc(row.date, row.time ?? tournament.daily_start, tournament.timezone);
}

/** Whether a match came from an uploaded day rather than a generated bracket. */
export const isUploaded = (m: Pick<Match, 'round_code'>) => m.round_code != null;
