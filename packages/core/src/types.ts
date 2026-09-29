export type TournamentStatus = 'draft' | 'scheduled' | 'live' | 'finished';
export type TournamentGameStatus = 'setup' | 'fixtures_ready' | 'live' | 'finished';
export type MatchStatus = 'pending' | 'ready' | 'live' | 'completed';
export type Slot = 'a' | 'b';

export interface Game {
  id: string;
  name: string;
  cover_url: string | null;
  default_match_minutes: number;
  /** Players on each side: 1 = solo, 2 = duo, 5 = five-a-side, ... */
  team_size: number;
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
  created_at: string;
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
  created_at: string;
}

export interface TournamentGame {
  id: string;
  tournament_id: string;
  game_id: string;
  match_minutes: number;
  buffer_minutes: number;
  stations: number;
  champion_team_id: string | null;
  status: TournamentGameStatus;
  created_at: string;
}

export interface Match {
  id: string;
  tournament_id: string;
  tournament_game_id: string;
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
  station: number | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  started_at: string | null;
  ended_at: string | null;
  image_url: string | null;
  updated_at: string;
}
