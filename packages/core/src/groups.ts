import { generateBracket, orderEntrants, nextPowerOfTwo, roundName, type BracketEntrant, type GenerateOptions, type MatchDraft } from './bracket';
import type { Match, Stage, Team } from './types';

/** A generated match tagged with the stage (and group) it belongs to. */
export interface StageMatchDraft extends MatchDraft {
  stage: Stage;
  group_no: number | null;
}

export const groupLetter = (n: number) => String.fromCharCode(64 + n);

export const isGroupMatch = (m: Pick<Match, 'stage'>) => m.stage === 'group';

/** The knockout final: the only match whose winner is crowned champion. */
export const isFinal = (m: Pick<Match, 'stage' | 'next_match_id'>) => m.stage !== 'group' && !m.next_match_id;

/** "Group B · Matchday 2" in the group stage, "Semi-final" etc. in the knockout. */
export function matchLabel(m: Pick<Match, 'stage' | 'group_no' | 'round'>, knockoutRounds: number): string {
  return m.stage === 'group' ? `Group ${groupLetter(m.group_no ?? 1)} · Matchday ${m.round}` : roundName(m.round, knockoutRounds);
}

/** Number of knockout rounds per tournament game (group matchdays don't count). */
export function knockoutRounds(matches: Iterable<Pick<Match, 'tournament_game_id' | 'stage' | 'round'>>): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of matches) {
    if (m.stage === 'group') continue;
    out.set(m.tournament_game_id, Math.max(out.get(m.tournament_game_id) ?? 0, m.round));
  }
  return out;
}

/**
 * Split entrants into groups: seeded teams first, spread snake-style so the
 * top seeds land in different groups, then unseeded teams at random. Group
 * sizes differ by at most one.
 */
export function assignGroups(entrants: BracketEntrant[], groupCount: number, random: () => number = Math.random): Map<string, number> {
  if (groupCount < 1) throw new Error('At least one group is needed');
  if (entrants.length < groupCount * 2) throw new Error(`${groupCount} groups need at least ${groupCount * 2} entrants`);
  const ordered = orderEntrants(entrants, random);
  const out = new Map<string, number>();
  ordered.forEach((teamId, i) => {
    const lap = Math.floor(i / groupCount);
    const col = i % groupCount;
    out.set(teamId, (lap % 2 === 0 ? col : groupCount - 1 - col) + 1);
  });
  return out;
}

/**
 * Round-robin pairings (circle method): everyone plays everyone once. With an
 * odd number of teams one team sits out each matchday.
 */
export function roundRobin(teamIds: string[]): [string, string][][] {
  const ids: (string | null)[] = teamIds.length % 2 ? [...teamIds, null] : [...teamIds];
  const n = ids.length;
  const days: [string, string][][] = [];
  for (let d = 0; d < n - 1; d++) {
    const day: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i];
      const b = ids[n - 1 - i];
      if (a && b) day.push(d % 2 ? [b, a] : [a, b]);
    }
    days.push(day);
    // Keep the first team fixed and rotate the rest.
    ids.splice(1, 0, ids.pop()!);
  }
  return days;
}

/**
 * Build the group stage: groups plus every group's round-robin matches. Each
 * matchday interleaves the groups so they progress together on the schedule.
 */
export function generateGroupStage(
  entrants: BracketEntrant[],
  groupCount: number,
  options: GenerateOptions = {},
): { groups: Map<string, number>; matches: StageMatchDraft[] } {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const groups = assignGroups(entrants, groupCount, options.random);
  const members = Array.from({ length: groupCount }, (_, g) => [...groups].filter(([, n]) => n === g + 1).map(([id]) => id));
  const schedules = members.map(roundRobin);
  const matchdays = Math.max(...schedules.map((s) => s.length));
  const matches: StageMatchDraft[] = [];
  for (let d = 0; d < matchdays; d++) {
    let position = 0;
    const longest = Math.max(...schedules.map((s) => s[d]?.length ?? 0));
    for (let i = 0; i < longest; i++) {
      schedules.forEach((s, g) => {
        const pair = s[d]?.[i];
        if (!pair) return;
        matches.push({
          id: newId(),
          stage: 'group',
          group_no: g + 1,
          round: d + 1,
          position: position++,
          team_a_id: pair[0],
          team_b_id: pair[1],
          next_match_id: null,
          next_slot: null,
          status: 'ready',
          is_bye: false,
          winner_id: null,
        });
      });
    }
  }
  return { groups, matches };
}

export interface StandingRow {
  teamId: string;
  group: number;
  played: number;
  won: number;
  lost: number;
  /** Goals or rounds scored and conceded. */
  for: number;
  against: number;
  diff: number;
  /** 1-based place in the group. */
  rank: number;
}

type StandingMatch = Pick<Match, 'stage' | 'status' | 'is_bye' | 'team_a_id' | 'team_b_id' | 'winner_id' | 'score_a' | 'score_b'>;

/** Wins first, then score difference, then points scored, then name. */
function compareRows(a: StandingRow, b: StandingRow, name: (id: string) => string) {
  return b.won - a.won || b.diff - a.diff || b.for - a.for || name(a.teamId).localeCompare(name(b.teamId));
}

/**
 * The same order across groups, per match played, so a team from a smaller
 * group (fewer matches, e.g. 4-4-3 groups) is compared fairly with the rest.
 */
function compareAcross(a: StandingRow, b: StandingRow, name: (id: string) => string) {
  const per = (r: StandingRow, v: number) => (r.played ? v / r.played : 0);
  return (
    per(b, b.won) - per(a, a.won) ||
    per(b, b.diff) - per(a, a.diff) ||
    per(b, b.for) - per(a, a.for) ||
    name(a.teamId).localeCompare(name(b.teamId))
  );
}

/** Group tables from finished group matches, sorted into finishing order. */
export function groupStandings(teams: Pick<Team, 'id' | 'name' | 'group_no'>[], matches: StandingMatch[]): Map<number, StandingRow[]> {
  const rows = new Map<string, StandingRow>();
  for (const t of teams) {
    if (t.group_no == null) continue;
    rows.set(t.id, { teamId: t.id, group: t.group_no, played: 0, won: 0, lost: 0, for: 0, against: 0, diff: 0, rank: 0 });
  }
  for (const m of matches) {
    if (m.stage !== 'group' || m.status !== 'completed' || m.is_bye || !m.team_a_id || !m.team_b_id) continue;
    const sides: [string, number, number][] = [
      [m.team_a_id, m.score_a ?? 0, m.score_b ?? 0],
      [m.team_b_id, m.score_b ?? 0, m.score_a ?? 0],
    ];
    for (const [id, scored, conceded] of sides) {
      const r = rows.get(id);
      if (!r) continue;
      r.played++;
      if (m.winner_id === id) r.won++;
      else r.lost++;
      r.for += scored;
      r.against += conceded;
      r.diff = r.for - r.against;
    }
  }
  const nameOf = new Map(teams.map((t) => [t.id, t.name]));
  const name = (id: string) => nameOf.get(id) ?? '';
  const out = new Map<number, StandingRow[]>();
  for (const r of rows.values()) out.set(r.group, [...(out.get(r.group) ?? []), r]);
  for (const [g, list] of out) {
    list.sort((a, b) => compareRows(a, b, name));
    list.forEach((r, i) => (r.rank = i + 1));
    out.set(g, list);
  }
  return new Map([...out].sort(([a], [b]) => a - b));
}

/**
 * Who goes through, best first: every group's winners, then every group's
 * runners-up, and so on (each tier ordered by record per match), then the
 * best `wildcards` of the rest across all groups.
 */
export function qualifiers(
  standings: Map<number, StandingRow[]>,
  advancePerGroup: number,
  wildcards: number,
  name: (id: string) => string = () => '',
): string[] {
  const out: string[] = [];
  for (let place = 1; place <= advancePerGroup; place++) {
    const tier = [...standings.values()].map((list) => list[place - 1]).filter(Boolean);
    out.push(...tier.sort((a, b) => compareAcross(a, b, name)).map((r) => r.teamId));
  }
  const rest = [...standings.values()].flatMap((list) => list.slice(advancePerGroup));
  out.push(...rest.sort((a, b) => compareAcross(a, b, name)).slice(0, wildcards).map((r) => r.teamId));
  return out;
}

/** Knockout bracket for the qualifiers, seeded in qualifying order (group winners meet the lowest qualifiers first). */
export function knockoutFromQualifiers(teamIds: string[], options: GenerateOptions = {}): StageMatchDraft[] {
  return generateBracket(
    teamIds.map((teamId, i) => ({ teamId, seed: i + 1 })),
    options,
  ).map((m) => ({ ...m, stage: 'knockout' as const, group_no: null }));
}

/** Plain-language summary of a group setup, e.g. for the admin form. */
export function describeGroupSetup(entrants: number, groupCount: number, advancePerGroup: number, wildcards: number): string {
  if (groupCount < 1 || entrants < groupCount * 2) return `${groupCount} groups need at least ${groupCount * 2} entrants.`;
  const small = Math.floor(entrants / groupCount);
  const big = Math.ceil(entrants / groupCount);
  const sizes = small === big ? `${groupCount} groups of ${small}` : `${groupCount} groups of ${small}–${big}`;
  if (advancePerGroup >= small) return `${sizes}: each group only has ${small} teams, so fewer than ${advancePerGroup} can go through.`;
  const through = groupCount * advancePerGroup + wildcards;
  const size = nextPowerOfTwo(through);
  const byes = size - through;
  return `${sizes}. ${through} go through to a ${size}-slot knockout${byes ? ` (${byes} bye${byes > 1 ? 's' : ''} for the top qualifiers)` : ''}.`;
}
