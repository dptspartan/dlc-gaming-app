export type TournamentStatus = 'draft' | 'scheduled' | 'live' | 'finished';
export type TournamentGameStatus = 'setup' | 'fixtures_ready' | 'live' | 'finished';
/** called: sent to a station, waiting for the players to show up. */
export type MatchStatus = 'pending' | 'ready' | 'called' | 'live' | 'completed';
export type Slot = 'a' | 'b';
export type Scoring = 'none' | 'goals' | 'rounds';
/** knockout: straight single elimination; groups: round-robin groups, then a knockout for the qualifiers. */
export type Format = 'knockout' | 'groups';
export type Stage = 'group' | 'knockout';

export interface Game {
  id: string;
  name: string;
  cover_url: string | null;
  default_match_minutes: number;
  /** Players on each side: 1 = solo, 2 = duo, 5 = five-a-side, ... */
  team_size: number;
  /** none: pick the winner; goals: tally points, higher wins; rounds: best-of-N, ends itself. */
  scoring: Scoring;
  /** Rounds in a best-of match (odd); only set when scoring is 'rounds'. */
  best_of: number | null;
  created_at: string;
}

export interface Tournament {
  id: string;
  name: string;
  slug: string;
  /** YYYY-MM-DD */
  start_date: string;
  days: number;
  /** HH:MM or HH:MM:SS */
  daily_start: string;
  daily_end: string;
  timezone: string;
  status: TournamentStatus;
  banner_url: string | null;
  /** Stations (consoles/PCs) at the venue, shared by every game. */
  stations: number;
  /** How long called players have to show up at their station. */
  call_minutes: number;
  created_at: string;
}

/** The admin who runs one station during a tournament. */
export interface StationMaster {
  tournament_id: string;
  station: number;
  user_id: string;
}

/** A player (solo games) or team entered in one game of a tournament. */
export interface Team {
  id: string;
  tournament_id: string;
  tournament_game_id: string;
  name: string;
  logo_url: string | null;
  seed: number | null;
  /** Player names for team games; empty for solo entries. */
  members: string[];
  /** Group (1 = A) in a group-stage game; null in a straight knockout. */
  group_no: number | null;
  created_at: string;
}

export interface TournamentGame {
  id: string;
  tournament_id: string;
  game_id: string;
  match_minutes: number;
  buffer_minutes: number;
  /** Stations one match of this game takes at the same time. */
  stations_required: number;
  /** Stations this game can be played on; null = any. */
  allowed_stations: number[] | null;
  format: Format;
  /** Group-stage settings, used when format is 'groups'. */
  group_count: number;
  /** Top N of each group go through to the knockout. */
  advance_per_group: number;
  /** Extra knockout places for the best of the rest across all groups. */
  wildcards: number;
  /** Best-of series per stage, and the games a final is played on. */
  plan: StagePlan;
  champion_team_id: string | null;
  status: TournamentGameStatus;
  created_at: string;
}

export interface Match {
  id: string;
  tournament_id: string;
  tournament_game_id: string;
  stage: Stage;
  /** Group (1 = A) for group-stage matches; null in the knockout. */
  group_no: number | null;
  /** Knockout round, or matchday in the group stage. */
  round: number;
  position: number;
  team_a_id: string | null;
  team_b_id: string | null;
  next_match_id: string | null;
  next_slot: Slot | null;
  status: MatchStatus;
  is_bye: boolean;
  winner_id: string | null;
  score_a: number | null;
  score_b: number | null;
  /** Main station (where the game master calls the players). */
  station: number | null;
  /** Every station the match takes, when a game needs more than one. */
  stations: number[] | null;
  /** When the players were called to the station. */
  called_at: string | null;
  /** Held back in the queue until this time (skipped or delayed). */
  not_before: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  started_at: string | null;
  ended_at: string | null;
  image_url: string | null;
  /** Legs in the series (1 = a single game); the first side to win most of them goes through. */
  best_of: number;
  /** Game of each leg; a missing entry means the tournament game's own game. */
  leg_games: (string | null)[] | null;
  /** Finished legs, in order. score_a / score_b hold the leg being played. */
  legs: Leg[];
  /** Legs won by each side. */
  series_a: number;
  series_b: number;
  updated_at: string;
}

export interface Leg {
  game_id: string;
  winner_id: string;
  score_a: number | null;
  score_b: number | null;
}

/** A best-of series; a final can play each leg on a different game. */
export interface SeriesRule {
  best_of: number;
  /** Game per leg (final only); missing entries use the tournament game's own game. */
  games?: (string | null)[];
}

/** How each stage of a game is played. Missing stages are a single game. */
export interface StagePlan {
  group?: SeriesRule;
  /** Knockout rounds before the semi-finals. */
  knockout?: SeriesRule;
  semi?: SeriesRule;
  final?: SeriesRule;
}
