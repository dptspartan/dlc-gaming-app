import { generateBracket, type BracketEntrant, type GenerateOptions } from './bracket';
import type { StageMatchDraft } from './groups';
import type { Slot } from './types';

/**
 * A double-elimination knockout. The upper bracket is a normal knockout whose
 * losers drop into a loser bracket; losing there knocks a team out. The upper
 * bracket winner (slot a) meets the loser bracket winner (slot b) in the final.
 *
 * For an upper bracket of 2^k slots the loser bracket has 2(k-1) rounds: odd
 * rounds pair up the survivors, even rounds bring in the teams that just lost
 * upper round (j+1). First-round byes leave loser bracket slots nobody can
 * reach: a match with one reachable side waits as a bye and passes that team
 * straight through; one with none is completed empty.
 *
 * With only two teams there is nothing to drop into, so it is a plain final.
 */
export function generateDoubleElim(entrants: BracketEntrant[], options: GenerateOptions = {}): StageMatchDraft[] {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const upper: StageMatchDraft[] = generateBracket(entrants, { ...options, newId }).map((m) => ({
    ...m,
    stage: 'knockout' as const,
    group_no: null,
    loser_next_match_id: null,
    loser_next_slot: null,
  }));
  const k = Math.max(...upper.map((m) => m.round));
  if (k < 2) return upper;
  const size = 2 ** k;
  const upperRound = (r: number) => upper.filter((m) => m.round === r).sort((a, b) => a.position - b.position);

  const lowerRounds = 2 * (k - 1);
  const lower: StageMatchDraft[][] = [];
  for (let r = 1; r <= lowerRounds; r++) {
    const j = Math.ceil(r / 2);
    lower.push(
      Array.from({ length: size / 2 ** (j + 1) }, (_, position) => ({
        id: newId(),
        stage: 'losers' as const,
        group_no: null,
        round: r,
        position,
        team_a_id: null,
        team_b_id: null,
        next_match_id: null,
        next_slot: null,
        loser_next_match_id: null,
        loser_next_slot: null,
        status: 'pending' as const,
        is_bye: false,
        winner_id: null,
      })),
    );
  }

  const finalMatch: StageMatchDraft = {
    ...lower[0][0],
    id: newId(),
    stage: 'knockout',
    round: k + 1,
    position: 0,
  };
  const upperFinal = upperRound(k)[0];
  upperFinal.next_match_id = finalMatch.id;
  upperFinal.next_slot = 'a';
  const lowerFinal = lower[lowerRounds - 1][0];
  lowerFinal.next_match_id = finalMatch.id;
  lowerFinal.next_slot = 'b';

  const slot = (i: number): Slot => (i % 2 === 0 ? 'a' : 'b');
  // Upper round 1 losers pair up in loser round 1.
  for (const m of upperRound(1)) {
    m.loser_next_match_id = lower[0][Math.floor(m.position / 2)].id;
    m.loser_next_slot = slot(m.position);
  }
  // Upper round j+1 losers meet loser round 2j-1 winners in loser round 2j,
  // mirrored every other round so early opponents don't meet again straight away.
  for (let j = 1; j <= k - 1; j++) {
    const target = lower[2 * j - 1];
    for (const m of upperRound(j + 1)) {
      const p = j % 2 === 1 ? target.length - 1 - m.position : m.position;
      m.loser_next_match_id = target[p].id;
      m.loser_next_slot = 'b';
    }
    for (const m of lower[2 * j - 2]) {
      m.next_match_id = target[m.position].id;
      m.next_slot = 'a';
    }
    if (j < k - 1) {
      for (const m of target) {
        m.next_match_id = lower[2 * j][Math.floor(m.position / 2)].id;
        m.next_slot = slot(m.position);
      }
    }
  }

  // Which loser bracket slots can ever be filled: an upper first-round bye has no loser.
  const reachable = new Map<string, number>();
  const feed = (id: string | null | undefined) => id && reachable.set(id, (reachable.get(id) ?? 0) + 1);
  for (const m of upper) if (!m.is_bye) feed(m.loser_next_match_id);
  for (const round of lower) {
    for (const m of round) {
      const n = reachable.get(m.id) ?? 0;
      if (n === 2) {
        feed(m.next_match_id);
      } else if (n === 1) {
        m.is_bye = true;
        feed(m.next_match_id);
      } else {
        m.is_bye = true;
        m.status = 'completed';
      }
    }
  }

  return [...upper, ...lower.flat(), finalMatch];
}

/** Rounds in the loser bracket of a double-elimination knockout with this many knockout rounds (final included). */
export const loserRounds = (knockoutRounds: number) => Math.max(0, 2 * (knockoutRounds - 2));
