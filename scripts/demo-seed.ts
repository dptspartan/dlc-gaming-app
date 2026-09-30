// Prints SQL that replaces ALL tournaments and games with the "DLC Demo Cup",
// a tournament caught mid-event that shows every format and scoring case:
//   EA FC 26      goals, 3 groups (4/4/3, odd group count), top 1 + 1 wildcard; group stage in progress
//   Tekken 8      rounds (best of 5), straight knockout, 6 players in random pairs (2 byes); round 1 in progress
//   Call of Duty  rounds (best of 5), 2 groups of 3, top 2 through; groups and semis done, final live
//   Street Fighter 6  winner only, 2 groups of 4, top 2 through; finished with a champion
// Usage: npx tsx scripts/demo-seed.ts > /tmp/seed.sql, then run it in the Supabase SQL editor.
import { randomUUID } from 'node:crypto';
import {
  generateBracket,
  generateGroupStage,
  groupStandings,
  knockoutFromQualifiers,
  qualifiers,
  scheduleMatches,
  tournamentWindows,
  type Match,
  type StageMatchDraft,
} from '../packages/core/src/index';

const SITE = 'https://dptspartan.github.io/dlc-gaming-app';
const MIN = 60_000;
const now = Date.now();

// Seeded random so the demo is the same every run.
let state = 20260930;
const random = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const q = (v: unknown) => (v == null ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const arr = (xs: string[]) => `array[${xs.map(q).join(',')}]::text[]`;
const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());
const values = (rows: unknown[][]) => rows.map((r) => `(${r.map(q).join(', ')})`).join(',\n');

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date(now));
const tournament = {
  id: randomUUID(),
  name: 'DLC Demo Cup',
  slug: 'demo-cup',
  start_date: today,
  days: 2,
  daily_start: '10:00',
  daily_end: '23:30',
  timezone: 'Asia/Karachi',
};
const windows = tournamentWindows(tournament);

type Scoring = 'none' | 'goals' | 'rounds';
interface GameSpec {
  name: string;
  cover: string;
  team_size: number;
  minutes: number;
  scoring: Scoring;
  best_of: number | null;
  stations: number;
  format: 'knockout' | 'groups';
  group_count: number;
  advance_per_group: number;
  wildcards: number;
  players: string[];
  /** Plays the game up to the moment the demo shows. */
  play: (g: Sim) => void;
}

type SimMatch = StageMatchDraft & Pick<Match, 'score_a' | 'score_b'> & { started_at: number | null; ended_at: number | null; station: number | null };

/** A game being played: its teams, matches and a clock of results. */
class Sim {
  matches: SimMatch[] = [];
  groups = new Map<string, number>();
  strength = new Map<string, number>();
  private played = 0;
  champion: string | null = null;
  constructor(
    readonly spec: GameSpec,
    readonly teams: { id: string; name: string }[],
  ) {
    teams.forEach((t, i) => this.strength.set(t.id, teams.length - i + random() * 3));
  }
  add(drafts: StageMatchDraft[]) {
    this.matches.push(...drafts.map((d) => ({ ...d, score_a: null, score_b: null, started_at: null, ended_at: null, station: null })));
  }
  get = (id: string) => this.matches.find((m) => m.id === id)!;
  /** Matches that can be played now, in schedule order. */
  playable(stage?: 'group' | 'knockout') {
    return this.matches
      .filter((m) => !m.is_bye && m.status === 'ready' && (!stage || m.stage === stage))
      .sort((a, b) => a.round - b.round || a.position - b.position);
  }
  private score(winnerIsA: boolean): [number | null, number | null] {
    const { scoring, best_of } = this.spec;
    if (scoring === 'none') return [null, null];
    let w: number, l: number;
    if (scoring === 'rounds') {
      w = Math.ceil((best_of ?? 3) / 2);
      l = Math.floor(random() * w);
    } else {
      l = Math.floor(random() * 3);
      w = l + 1 + Math.floor(random() * 3);
    }
    return winnerIsA ? [w, l] : [l, w];
  }
  /** Play a match to the end, most results in the past, one after another per station. */
  finish(m: SimMatch) {
    const a = this.strength.get(m.team_a_id!)! + random() * 4;
    const b = this.strength.get(m.team_b_id!)! + random() * 4;
    const winner = a >= b ? m.team_a_id! : m.team_b_id!;
    [m.score_a, m.score_b] = this.score(winner === m.team_a_id);
    m.status = 'completed';
    m.winner_id = winner;
    m.station = (this.played % this.spec.stations) + 1;
    this.played++;
    if (m.next_match_id) {
      const n = this.get(m.next_match_id);
      if (m.next_slot === 'a') n.team_a_id = winner;
      else n.team_b_id = winner;
      if (n.team_a_id && n.team_b_id && n.status === 'pending') n.status = 'ready';
    } else if (m.stage === 'knockout') {
      this.champion = winner;
    }
  }
  /** Start a match a few minutes ago, part-way through. */
  start(m: SimMatch) {
    m.status = 'live';
    m.started_at = now - (3 + Math.floor(random() * 6)) * MIN;
    const { scoring, best_of } = this.spec;
    if (scoring === 'goals') [m.score_a, m.score_b] = [Math.floor(random() * 3), Math.floor(random() * 3)];
    if (scoring === 'rounds') {
      const need = Math.ceil((best_of ?? 3) / 2);
      [m.score_a, m.score_b] = [need - 1, Math.floor(random() * need)];
    }
  }
  standings() {
    const teams = this.teams.map((t) => ({ ...t, group_no: this.groups.get(t.id) ?? null }));
    return groupStandings(teams, this.matches as unknown as Match[]);
  }
  buildKnockout() {
    const name = new Map(this.teams.map((t) => [t.id, t.name]));
    const through = qualifiers(this.standings(), this.spec.advance_per_group, this.spec.wildcards, (id) => name.get(id) ?? '');
    this.add(knockoutFromQualifiers(through, { newId: randomUUID }));
  }
}

const games: GameSpec[] = [
  {
    name: 'EA FC 26',
    cover: 'ea-fc-26.svg',
    team_size: 1,
    minutes: 15,
    scoring: 'goals',
    best_of: null,
    stations: 3,
    format: 'groups',
    group_count: 3,
    advance_per_group: 1,
    wildcards: 1,
    players: ['Ace', 'Blaze', 'Cypher', 'Drift', 'Echo', 'Fury', 'Ghost', 'Havoc', 'Ion', 'Jinx', 'Kilo'],
    play: (g) => {
      // Matchdays 1 and 2 done, two matchday 3 games live, the rest waiting.
      g.playable('group').filter((m) => m.round <= 2).forEach((m) => g.finish(m));
      g.playable('group').slice(0, 2).forEach((m) => g.start(m));
    },
  },
  {
    name: 'Tekken 8',
    cover: 'tekken-8.svg',
    team_size: 1,
    minutes: 10,
    scoring: 'rounds',
    best_of: 5,
    stations: 2,
    format: 'knockout',
    group_count: 2,
    advance_per_group: 2,
    wildcards: 0,
    players: ['Kaz', 'Jin', 'Nina', 'Law', 'King', 'Hwo'],
    play: (g) => {
      const [first, second] = g.playable();
      g.finish(first);
      g.start(second);
    },
  },
  {
    name: 'Call of Duty',
    cover: 'call-of-duty.svg',
    team_size: 4,
    minutes: 30,
    scoring: 'rounds',
    best_of: 5,
    stations: 1,
    format: 'groups',
    group_count: 2,
    advance_per_group: 2,
    wildcards: 0,
    players: [
      'Night Owls: Hawk, Shade, Talon, Mist',
      'Glitch: Byte, Pixel, Static, Lag',
      'Red Vipers: Fang, Venom, Coil, Strike',
      'Iron Wolves: Grit, Anvil, Forge, Rust',
      'Neon Five: Volt, Flux, Ray, Prism',
      'Dark Matter: Void, Nebula, Quark, Pulse',
    ],
    play: (g) => {
      g.playable('group').forEach((m) => g.finish(m));
      g.buildKnockout();
      g.playable('knockout').forEach((m) => g.finish(m));
      g.start(g.playable('knockout')[0]);
    },
  },
  {
    name: 'Street Fighter 6',
    cover: 'street-fighter-6.svg',
    team_size: 1,
    minutes: 8,
    scoring: 'none',
    best_of: null,
    stations: 2,
    format: 'groups',
    group_count: 2,
    advance_per_group: 2,
    wildcards: 0,
    players: ['Ryu', 'Chun-Li', 'Luke', 'Juri', 'Ken', 'Cammy', 'Guile', 'Zangief'],
    play: (g) => {
      g.playable('group').forEach((m) => g.finish(m));
      g.buildKnockout();
      for (let ms = g.playable('knockout'); ms.length; ms = g.playable('knockout')) ms.forEach((m) => g.finish(m));
    },
  },
];

const out: string[] = ['-- Demo data (scripts/demo-seed.ts): replaces every tournament and game.', 'begin;'];
out.push(
  'delete from public.matches;',
  'update public.tournament_games set champion_team_id = null;',
  'delete from public.teams;',
  'delete from public.tournament_games;',
  'delete from public.tournaments;',
  'delete from public.games;',
);
out.push(
  `insert into public.tournaments (id, name, slug, start_date, days, daily_start, daily_end, timezone, status) values\n${values([
    [tournament.id, tournament.name, tournament.slug, tournament.start_date, tournament.days, tournament.daily_start, tournament.daily_end, tournament.timezone, 'live'],
  ])};`,
);

for (const spec of games) {
  const gameId = randomUUID();
  const tgId = randomUUID();
  const teams = spec.players.map((line) => {
    const [name, rest] = line.split(':');
    return { id: randomUUID(), name: name.trim(), members: rest ? rest.split(',').map((s) => s.trim()) : [] };
  });
  const g = new Sim(spec, teams);
  // No seeds: groups and knockout pairs are drawn at random, as in the app.
  const entrants = teams.map((t) => ({ teamId: t.id, seed: null }));
  if (spec.format === 'groups') {
    const stage = generateGroupStage(entrants, spec.group_count, { newId: randomUUID, random });
    g.groups = stage.groups;
    g.add(stage.matches);
  } else {
    g.add(generateBracket(entrants, { newId: randomUUID, random }).map((d) => ({ ...d, stage: 'knockout' as const, group_no: null })));
  }
  spec.play(g);

  // Played matches: back to back on each station, ending just before now.
  const step = (spec.minutes + 5) * MIN;
  const done = g.matches.filter((m) => m.status === 'completed' && !m.is_bye);
  const perStation = Math.ceil(done.length / spec.stations);
  done.forEach((m, i) => {
    const slot = Math.floor(i / spec.stations);
    m.started_at = now - (perStation - slot) * step - 10 * MIN;
    m.ended_at = m.started_at + spec.minutes * MIN;
  });
  g.matches.filter((m) => m.status === 'live').forEach((m, i) => (m.station = i + 1));
  const schedule = scheduleMatches(
    g.matches.map((m) => ({ ...m, started_at: iso(m.started_at), ended_at: iso(m.ended_at) })),
    { windows, matchMinutes: spec.minutes, bufferMinutes: 5, stations: spec.stations, now },
  );
  const slot = new Map(schedule.slots.map((s) => [s.id, s]));

  const status = g.champion ? 'finished' : 'live';
  out.push(
    `insert into public.games (id, name, team_size, default_match_minutes, scoring, best_of, cover_url) values\n${values([
      [gameId, spec.name, spec.team_size, spec.minutes, spec.scoring, spec.best_of, `${SITE}/games/${spec.cover}`],
    ])};`,
    `insert into public.tournament_games (id, tournament_id, game_id, match_minutes, buffer_minutes, stations, status, format, group_count, advance_per_group, wildcards) values\n${values([
      [tgId, tournament.id, gameId, spec.minutes, 5, spec.stations, status, spec.format, spec.group_count, spec.advance_per_group, spec.wildcards],
    ])};`,
    `insert into public.teams (id, tournament_id, tournament_game_id, name, members, group_no) values\n${teams
      .map((t) => `(${[t.id, tournament.id, tgId].map(q).join(', ')}, ${q(t.name)}, ${arr(t.members)}, ${q(g.groups.get(t.id) ?? null)})`)
      .join(',\n')};`,
    `insert into public.matches (id, tournament_id, tournament_game_id, stage, group_no, round, position, team_a_id, team_b_id, next_match_id, next_slot, status, is_bye, winner_id, score_a, score_b, station, scheduled_start, scheduled_end, started_at, ended_at) values\n${values(
      g.matches.map((m) => {
        const s = slot.get(m.id);
        const start = s?.start ?? m.started_at;
        const end = s?.end ?? (m.started_at != null ? m.started_at + spec.minutes * MIN : null);
        return [
          m.id, tournament.id, tgId, m.stage, m.group_no, m.round, m.position, m.team_a_id, m.team_b_id, m.next_match_id, m.next_slot, m.status, m.is_bye,
          m.winner_id, m.score_a, m.score_b, s?.station ?? m.station, iso(start), iso(end), iso(m.started_at), iso(m.is_bye ? now - 60 * MIN : m.ended_at),
        ];
      }),
    )};`,
  );
  if (g.champion) out.push(`update public.tournament_games set champion_team_id = ${q(g.champion)} where id = ${q(tgId)};`);
}
out.push('commit;');
console.log(out.join('\n'));
