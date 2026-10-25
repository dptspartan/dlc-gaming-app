import type { MatchStatus, Slot } from './types';

export interface BracketEntrant {
  teamId: string;
  seed?: number | null;
}

/** A match as produced by the generator, before it is saved. */
export interface MatchDraft {
  id: string;
  round: number;
  position: number;
  team_a_id: string | null;
  team_b_id: string | null;
  next_match_id: string | null;
  next_slot: Slot | null;
  loser_next_match_id?: string | null;
  loser_next_slot?: Slot | null;
  status: MatchStatus;
  is_bye: boolean;
  winner_id: string | null;
}

export interface GenerateOptions {
  /** Id factory, defaults to crypto.randomUUID. */
  newId?: () => string;
  /** Random source in [0, 1) used to shuffle unseeded teams. */
  random?: () => number;
}

export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/**
 * Standard bracket seed order, e.g. size 8 -> [1, 8, 4, 5, 2, 7, 3, 6].
 * Consecutive pairs are first-round matchups, so seed 1 meets the lowest
 * seed and seeds 1 and 2 can only meet in the final.
 */
export function seedOrder(size: number): number[] {
  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new Error('Bracket size must be a power of two and at least 2');
  }
  let order = [1, 2];
  while (order.length < size) {
    const total = order.length * 2 + 1;
    order = order.flatMap((seed) => [seed, total - seed]);
  }
  return order;
}

export function roundCount(teamCount: number): number {
  return Math.log2(nextPowerOfTwo(teamCount));
}

export function roundName(round: number, totalRounds: number): string {
  const remaining = totalRounds - round;
  if (remaining === 0) return 'Final';
  if (remaining === 1) return 'Semi-final';
  if (remaining === 2) return 'Quarter-final';
  return `Round ${round}`;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Seeded teams first (by seed), then unseeded teams in random order. */
export function orderEntrants(entrants: BracketEntrant[], random: () => number = Math.random): string[] {
  const seeded = entrants
    .filter((e) => e.seed != null)
    .sort((a, b) => (a.seed as number) - (b.seed as number));
  const unseeded = shuffle(
    entrants.filter((e) => e.seed == null),
    random,
  );
  return [...seeded, ...unseeded].map((e) => e.teamId);
}

/**
 * Build a full single-elimination bracket. Byes go to the top seeds, are
 * marked completed, and their team is already placed in round two.
 */
export function generateBracket(entrants: BracketEntrant[], options: GenerateOptions = {}): MatchDraft[] {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const random = options.random ?? Math.random;

  const ids = new Set(entrants.map((e) => e.teamId));
  if (ids.size !== entrants.length) throw new Error('A team is entered twice');
  if (entrants.length < 2) throw new Error('At least two teams are needed for a bracket');

  const ordered = orderEntrants(entrants, random);
  const size = nextPowerOfTwo(ordered.length);
  const rounds = Math.log2(size);

  // Create every match, round by round, then link each to the next round.
  const byRound: MatchDraft[][] = [];
  for (let round = 1; round <= rounds; round++) {
    const count = size / 2 ** round;
    byRound.push(
      Array.from({ length: count }, (_, position) => ({
        id: newId(),
        round,
        position,
        team_a_id: null,
        team_b_id: null,
        next_match_id: null,
        next_slot: null,
        status: 'pending' as MatchStatus,
        is_bye: false,
        winner_id: null,
      })),
    );
  }
  for (let r = 0; r < rounds - 1; r++) {
    for (const match of byRound[r]) {
      match.next_match_id = byRound[r + 1][Math.floor(match.position / 2)].id;
      match.next_slot = match.position % 2 === 0 ? 'a' : 'b';
    }
  }

  // Place seeds into round one.
  const order = seedOrder(size);
  const teamForSeed = (seed: number) => ordered[seed - 1] ?? null;
  byRound[0].forEach((match, i) => {
    match.team_a_id = teamForSeed(order[i * 2]);
    match.team_b_id = teamForSeed(order[i * 2 + 1]);
  });

  const byId = new Map(byRound.flat().map((m) => [m.id, m]));
  for (const match of byRound[0]) {
    const lone = match.team_a_id && !match.team_b_id ? match.team_a_id : !match.team_a_id && match.team_b_id ? match.team_b_id : null;
    if (lone) {
      match.is_bye = true;
      match.status = 'completed';
      match.winner_id = lone;
      const next = match.next_match_id ? byId.get(match.next_match_id) : undefined;
      if (next) {
        if (match.next_slot === 'a') next.team_a_id = lone;
        else next.team_b_id = lone;
      }
    }
  }

  for (const match of byId.values()) {
    if (match.status === 'pending' && match.team_a_id && match.team_b_id) match.status = 'ready';
  }

  return byRound.flat();
}

/** Matches that feed into the given match (its previous round). */
export function feedersOf<T extends { id: string; next_match_id: string | null }>(matches: T[], matchId: string): T[] {
  return matches.filter((m) => m.next_match_id === matchId);
}
