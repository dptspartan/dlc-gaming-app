import type { Team } from './types';

// Leading words that most of the room shares, so they don't tell players apart.
const PREFIXES = new Set([
  'syed', 'sayed', 'sayyid', 'muhammad', 'muhammed', 'mohammad', 'mohammed', 'mohd', 'md', 'm',
  'hafiz', 'sheikh', 'shaikh', 'mian', 'ch', 'mr', 'ms', 'mrs', 'dr',
]);
// Words that only make a name together with the next one ("Abdul Rehman").
const JOINERS = new Set(['abdul', 'abdur', 'abdus', 'abd', 'abu', 'ul', 'ur']);

function words(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

const key = (w: string) => w.toLowerCase().replace(/\.$/, '');

/** The first name a player goes by, skipping shared prefixes like "Syed" or "Muhammad". */
function given(ws: string[]): { first: string; rest: string[] } {
  let i = 0;
  while (i < ws.length - 1 && PREFIXES.has(key(ws[i]))) i++;
  let j = i + 1;
  while (j < ws.length && JOINERS.has(key(ws[j - 1]))) j++;
  return { first: ws.slice(i, j).join(' '), rest: ws.slice(j) };
}

function forms(name: string): string[] {
  const ws = words(name);
  if (ws.length < 2) return [name.trim()];
  const { first, rest } = given(ws);
  const last = rest[rest.length - 1];
  if (!last) return [first, name.trim()];
  return [first, `${first} ${last[0].toUpperCase()}.`, `${first} ${last}`, name.trim()];
}

/**
 * A short label for a player: their first name, or first name plus last initial
 * when another player in `others` would read the same. Team entries (with
 * members) keep their team name.
 */
export function shortName(name: string, others: string[] = []): string {
  const mine = forms(name);
  const theirs = others
    .filter((o) => o.trim().toLowerCase() !== name.trim().toLowerCase())
    .map((o) => forms(o).map((f) => f.toLowerCase()));
  for (let n = 0; n < mine.length; n++) {
    const f = mine[n].toLowerCase();
    if (!theirs.some((t) => t.slice(0, n + 1).includes(f) || t[t.length - 1] === f)) return mine[n];
  }
  return name.trim();
}

/** Short label for a team on the live board, unique among the solo players in its game. */
export function teamShortName(team: Pick<Team, 'name' | 'members' | 'tournament_game_id'>, teams: Iterable<Pick<Team, 'name' | 'members' | 'tournament_game_id'>>): string {
  if (team.members?.length) return team.name;
  const others: string[] = [];
  for (const t of teams) if (t !== team && t.tournament_game_id === team.tournament_game_id && !t.members?.length) others.push(t.name);
  return shortName(team.name, others);
}
