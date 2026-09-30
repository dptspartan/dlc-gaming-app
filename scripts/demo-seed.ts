// Prints SQL that replaces ALL tournaments and games with the "DLC Demo Cup",
// a tournament caught mid-event that shows every format and scoring case:
//   EA FC 26      goals, 3 groups (4/4/3, odd group count), top 1 + 1 wildcard; group stage in progress
//   Tekken 8      rounds (best of 5), straight knockout, 6 players in random pairs (2 byes); round 1 in progress
//   Call of Duty  rounds (best of 5), 2 groups of 3, top 2 through; groups and semis done, final live
//   Street Fighter 6  winner only, 2 groups of 4, top 2 through; finished with a champion
// The venue has 8 shared stations. FIFA plays on 1-4, Tekken on 5-6, Call of Duty
// takes two stations per match (5-8); players are being called to two stations
// (one of them late) and the timetable places every queued match across all games.
// Usage: npx tsx scripts/demo-seed.ts > /tmp/seed.sql, then run it in the Supabase SQL editor.
import { randomUUID } from 'node:crypto';
import {
  knockoutFor,
  generateGroupStage,
  groupStandings,
  knockoutFromQualifiers,
  qualifiers,
  legGameId,
  legsToWin,
  scheduleTournament,
  seriesFor,
  seriesMinutes,
  timetableGames,
  tournamentWindows,
  type Match,
  type StageMatchDraft,
  type StagePlan,
  type TournamentGame,
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
  stations: 8,
  call_minutes: 5,
};
const allStations = Array.from({ length: tournament.stations }, (_, i) => i + 1);

type Scoring = 'none' | 'goals' | 'rounds';
interface GameSpec {
  name: string;
  cover: string;
  team_size: number;
  minutes: number;
  scoring: Scoring;
  best_of: number | null;
  stationsRequired: number;
  allowed: number[] | null;
  format: 'knockout' | 'groups';
  group_count: number;
  advance_per_group: number;
  wildcards: number;
  /** Best-of per stage; final legs name the game each is played on. */
  plan: { group?: number; knockout?: number; semi?: number; final?: number; finalGames?: string[]; double?: boolean };
  players: string[];
  /** Plays the game up to the moment the demo shows. */
  play: (g: Sim) => void;
}

type SimMatch = StageMatchDraft &
  Pick<Match, 'score_a' | 'score_b' | 'best_of' | 'leg_games' | 'legs' | 'series_a' | 'series_b'> & {
    started_at: number | null;
    ended_at: number | null;
    called_at: number | null;
    stations: number[] | null;
  };

const gameId = new Map<string, string>();
const specOf = (id: string) => games.find((g) => gameId.get(g.name) === id)!;
/** The plan in the app's shape, with game ids for the final legs. */
const planOf = (spec: GameSpec): StagePlan => {
  const p = spec.plan;
  const rule = (n?: number) => (n ? { best_of: n } : undefined);
  return {
    group: rule(p.group),
    knockout: rule(p.knockout),
    semi: rule(p.semi),
    final: p.final ? { best_of: p.final, games: p.finalGames?.map((n) => (n === spec.name ? null : gameId.get(n)!)) } : undefined,
    double_elim: p.double || undefined,
  };
};

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
    const rounds = Math.max(0, ...drafts.filter((d) => d.stage === 'knockout').map((d) => d.round));
    this.matches.push(
      ...drafts.map((d) => ({
        ...d,
        loser_next_match_id: d.loser_next_match_id ?? null,
        loser_next_slot: d.loser_next_slot ?? null,
        ...seriesFor(planOf(this.spec), d, rounds),
        legs: [],
        series_a: 0,
        series_b: 0,
        score_a: null,
        score_b: null,
        started_at: null,
        ended_at: null,
        called_at: null,
        stations: null,
      })),
    );
  }
  /** The game a leg of this match is played on. */
  legSpec(m: SimMatch, leg: number) {
    return specOf(legGameId(m, leg, gameId.get(this.spec.name)!));
  }
  get = (id: string) => this.matches.find((m) => m.id === id)!;
  /** Matches that can be played now, in schedule order. */
  playable(stage?: Match['stage']) {
    return this.matches
      .filter((m) => !m.is_bye && m.status === 'ready' && (!stage || m.stage === stage))
      .sort((a, b) => a.round - b.round || a.position - b.position);
  }
  private score(winnerIsA: boolean, spec = this.spec): [number | null, number | null] {
    const { scoring, best_of } = spec;
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
    const loser = winner === m.team_a_id ? m.team_b_id! : m.team_a_id!;
    // A series: the winner takes most legs, the loser some, in a shuffled order.
    const need = legsToWin(m.best_of);
    const order = [...Array(need).fill(winner), ...Array(Math.floor(random() * need)).fill(loser)];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    // The deciding leg is always the winner's.
    const last = order.lastIndexOf(winner);
    [order[last], order[order.length - 1]] = [order[order.length - 1], order[last]];
    for (const w of order.slice(0, order.length)) this.playLeg(m, w);
    if (m.best_of === 1) [m.score_a, m.score_b] = [m.legs[0].score_a, m.legs[0].score_b];
    else [m.score_a, m.score_b] = [m.series_a, m.series_b];
    m.status = 'completed';
    m.winner_id = winner;
    m.stations = this.lane(this.played % this.lanes);
    this.played++;
    if (m.loser_next_match_id) this.place(m.loser_next_match_id, m.loser_next_slot!, loser);
    if (m.next_match_id) this.place(m.next_match_id, m.next_slot!, winner);
    else if (m.stage === 'knockout') this.champion = winner;
  }
  /** A team moves on; a loser-bracket bye passes it straight through, as the database does. */
  place(id: string, slot: 'a' | 'b', team: string) {
    const n = this.get(id);
    if (slot === 'a') n.team_a_id = team;
    else n.team_b_id = team;
    if (n.is_bye && n.status === 'pending') {
      n.status = 'completed';
      n.winner_id = team;
      if (n.next_match_id) this.place(n.next_match_id, n.next_slot!, team);
    } else if (n.team_a_id && n.team_b_id && n.status === 'pending') n.status = 'ready';
  }
  /** One finished leg, won by `w`, scored the way its game is. */
  playLeg(m: SimMatch, w: string) {
    const spec = this.legSpec(m, m.legs.length);
    const [sa, sb] = this.score(w === m.team_a_id, spec);
    m.legs.push({ game_id: gameId.get(spec.name)!, winner_id: w, score_a: sa, score_b: sb });
    if (w === m.team_a_id) m.series_a++;
    else m.series_b++;
  }
  /** Stations one match can take at once, side by side. */
  get lanes() {
    return Math.floor((this.spec.allowed ?? allStations).length / this.spec.stationsRequired);
  }
  lane(k: number) {
    const r = this.spec.stationsRequired;
    return (this.spec.allowed ?? allStations).slice(k * r, k * r + r);
  }
  /** Players called to a station a few minutes ago. */
  call(m: SimMatch, lane: number, minutesAgo: number) {
    m.status = 'called';
    m.stations = this.lane(lane);
    m.called_at = now - minutesAgo * MIN;
  }
  /** Start a match a few minutes ago, part-way through. */
  start(m: SimMatch, lane: number) {
    m.status = 'live';
    m.stations = this.lane(lane);
    m.started_at = now - (3 + Math.floor(random() * 6)) * MIN;
    // A series is part-way through: side A has taken the first leg.
    if (m.best_of > 1) this.playLeg(m, m.team_a_id!);
    const { scoring, best_of } = this.legSpec(m, m.legs.length);
    [m.score_a, m.score_b] = [null, null];
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
    this.add(knockoutFromQualifiers(through, { newId: randomUUID, double: this.spec.plan.double }));
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
    stationsRequired: 1,
    allowed: [1, 2, 3, 4],
    format: 'groups',
    group_count: 3,
    advance_per_group: 1,
    wildcards: 1,
    // The final is a three-game series across different games.
    plan: { semi: 3, final: 3, finalGames: ['EA FC 26', 'Tekken 8', 'Street Fighter 6'] },
    players: ['Ace', 'Blaze', 'Cypher', 'Drift', 'Echo', 'Fury', 'Ghost', 'Havoc', 'Ion', 'Jinx', 'Kilo'],
    play: (g) => {
      // Matchdays 1 and 2 done, two matchday 3 games live, one called, the rest waiting.
      g.playable('group').filter((m) => m.round <= 2).forEach((m) => g.finish(m));
      g.playable('group').slice(0, 2).forEach((m, i) => g.start(m, i));
      g.call(g.playable('group')[0], 2, 2);
    },
  },
  {
    name: 'Tekken 8',
    cover: 'tekken-8.svg',
    team_size: 1,
    minutes: 10,
    scoring: 'rounds',
    best_of: 5,
    stationsRequired: 1,
    allowed: [5, 6],
    format: 'knockout',
    group_count: 2,
    advance_per_group: 2,
    wildcards: 0,
    // Double elimination: first-round losers drop into the loser bracket.
    plan: { semi: 3, final: 5, double: true },
    players: ['Kaz', 'Jin', 'Nina', 'Law', 'King', 'Hwo'],
    play: (g) => {
      // Upper round 1 and one upper semi played; a loser bracket match live, the other upper semi called and running late.
      g.playable('knockout').forEach((m) => g.finish(m));
      g.finish(g.playable('knockout')[0]);
      g.start(g.playable('losers')[0], 0);
      g.call(g.playable('knockout')[0], 1, 6);
    },
  },
  {
    name: 'Call of Duty',
    cover: 'call-of-duty.svg',
    team_size: 4,
    minutes: 30,
    scoring: 'rounds',
    best_of: 5,
    stationsRequired: 2,
    allowed: [5, 6, 7, 8],
    format: 'groups',
    group_count: 2,
    advance_per_group: 2,
    wildcards: 0,
    plan: { final: 3 },
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
      g.start(g.playable('knockout')[0], 1);
    },
  },
  {
    name: 'Street Fighter 6',
    cover: 'street-fighter-6.svg',
    team_size: 1,
    minutes: 8,
    scoring: 'none',
    best_of: null,
    stationsRequired: 1,
    allowed: null,
    format: 'groups',
    group_count: 2,
    advance_per_group: 2,
    wildcards: 0,
    // Finished: a winner-only final played across two games.
    plan: { final: 3, finalGames: ['Street Fighter 6', 'Tekken 8', 'Street Fighter 6'] },
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
  `insert into public.tournaments (id, name, slug, start_date, days, daily_start, daily_end, timezone, status, stations, call_minutes) values\n${values([
    [
      tournament.id, tournament.name, tournament.slug, tournament.start_date, tournament.days, tournament.daily_start, tournament.daily_end, tournament.timezone, 'live',
      tournament.stations, tournament.call_minutes,
    ],
  ])};`,
);

for (const spec of games) gameId.set(spec.name, randomUUID());
const catalog = new Map(games.map((g) => [gameId.get(g.name)!, { default_match_minutes: g.minutes }]));

const played = games.map((spec, order) => {
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
    g.add(knockoutFor(entrants, { newId: randomUUID, random, double: spec.plan.double }));
  }
  spec.play(g);

  // Played matches: back to back on each lane, ending just before now.
  const step = (spec.minutes + 5) * MIN;
  const done = g.matches.filter((m) => m.status === 'completed' && !m.is_bye);
  const perLane = Math.ceil(done.length / g.lanes);
  done.forEach((m, i) => {
    const slot = Math.floor(i / g.lanes);
    m.started_at = now - (perLane - slot) * step - 10 * MIN;
    m.ended_at = m.started_at + spec.minutes * Math.max(1, m.legs.length) * MIN;
  });
  const tg = {
    id: tgId,
    game_id: gameId.get(spec.name)!,
    match_minutes: spec.minutes,
    buffer_minutes: 5,
    stations_required: spec.stationsRequired,
    allowed_stations: spec.allowed,
    created_at: new Date(now + order * 1000).toISOString(),
  };
  return { spec, tg, teams, g };
});

// One timetable for the whole venue: every queued match gets a station and a time.
const timetable = scheduleTournament(
  played.flatMap(({ tg, g }) =>
    g.matches.map((m) => ({
      ...m,
      tournament_game_id: tg.id,
      station: m.stations?.[0] ?? null,
      called_at: iso(m.called_at),
      not_before: null,
      started_at: iso(m.started_at),
      ended_at: iso(m.ended_at),
    })),
  ),
  {
    windows: tournamentWindows(tournament),
    stations: tournament.stations,
    callMinutes: tournament.call_minutes,
    games: timetableGames(played.map((p) => p.tg as unknown as TournamentGame)),
    now,
    minutes: (m) => {
      const tg = played.find((p) => p.tg.id === m.tournament_game_id)!.tg;
      return (m.best_of ?? 1) > 1 ? seriesMinutes({ best_of: m.best_of ?? 1, leg_games: m.leg_games ?? null }, tg, catalog) : undefined;
    },
  },
);
const slot = new Map(timetable.slots.map((s) => [s.id, s]));
if (timetable.unplaced.length) throw new Error(`${timetable.unplaced.length} matches could not be placed`);

const intArr = (xs: number[] | null | undefined) => (xs?.length ? `array[${xs.join(',')}]::int[]` : 'null');

const uuidArr = (xs: (string | null)[] | null | undefined) => (xs?.length ? `array[${xs.map(q).join(',')}]::uuid[]` : 'null');
const json = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;

for (const { spec, tg, teams, g } of played) {
  const gid = gameId.get(spec.name)!;
  const status = g.champion ? 'finished' : 'live';
  out.push(
    `insert into public.games (id, name, team_size, default_match_minutes, scoring, best_of, cover_url) values\n${values([
      [gid, spec.name, spec.team_size, spec.minutes, spec.scoring, spec.best_of, `${SITE}/games/${spec.cover}`],
    ])};`,
    `insert into public.tournament_games (id, tournament_id, game_id, match_minutes, buffer_minutes, stations_required, allowed_stations, status, format, group_count, advance_per_group, wildcards, created_at, plan) values\n(${[
      tg.id, tournament.id, gid, spec.minutes, 5, spec.stationsRequired,
    ].map(q).join(', ')}, ${intArr(spec.allowed)}, ${[status, spec.format, spec.group_count, spec.advance_per_group, spec.wildcards, tg.created_at].map(q).join(', ')}, ${json(JSON.parse(JSON.stringify(planOf(spec))))});`,
    `insert into public.teams (id, tournament_id, tournament_game_id, name, members, group_no) values\n${teams
      .map((t) => `(${[t.id, tournament.id, tg.id].map(q).join(', ')}, ${q(t.name)}, ${arr(t.members)}, ${q(g.groups.get(t.id) ?? null)})`)
      .join(',\n')};`,
    `insert into public.matches (id, tournament_id, tournament_game_id, stage, group_no, round, position, team_a_id, team_b_id, next_match_id, next_slot, loser_next_match_id, loser_next_slot, status, is_bye, winner_id, score_a, score_b, station, stations, called_at, scheduled_start, scheduled_end, started_at, ended_at, best_of, leg_games, legs, series_a, series_b) values\n${g.matches
      .map((m) => {
        const s = slot.get(m.id);
        const stations = s?.stations ?? m.stations;
        const begin = m.status === 'called' ? m.called_at! + tournament.call_minutes * MIN : m.started_at;
        const start = s?.start ?? begin;
        const end = s?.end ?? (begin != null ? begin + spec.minutes * Math.max(1, m.best_of) * MIN : null);
        const head = [m.id, tournament.id, tg.id, m.stage, m.group_no, m.round, m.position, m.team_a_id, m.team_b_id, m.next_match_id, m.next_slot, m.loser_next_match_id, m.loser_next_slot, m.status, m.is_bye];
        const tail = [m.winner_id, m.score_a, m.score_b, stations?.[0] ?? null];
        const times = [iso(m.called_at), iso(start), iso(end), iso(m.started_at), iso(m.is_bye && m.status === 'completed' ? now - 60 * MIN : m.ended_at)];
        const series = `${m.best_of}, ${uuidArr(m.leg_games)}, ${json(m.legs)}, ${m.series_a}, ${m.series_b}`;
        return `(${[...head, ...tail].map(q).join(', ')}, ${intArr(m.is_bye ? null : stations)}, ${times.map(q).join(', ')}, ${series})`;
      })
      .join(',\n')};`,
  );
  if (g.champion) out.push(`update public.tournament_games set champion_team_id = ${q(g.champion)} where id = ${q(tg.id)};`);
}
out.push('commit;');
console.log(out.join('\n'));
