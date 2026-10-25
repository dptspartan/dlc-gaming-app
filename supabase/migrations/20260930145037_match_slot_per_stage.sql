-- Group matchdays and knockout rounds both count from 1, so a match's
-- round and position are unique within its stage, not the whole game.
alter table public.matches drop constraint matches_tournament_game_id_round_position_key;
alter table public.matches add constraint matches_tournament_game_id_stage_round_position_key unique (tournament_game_id, stage, round, position);
