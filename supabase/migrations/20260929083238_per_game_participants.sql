-- Participants belong to one game within a tournament (the FIFA players are
-- a different list from the Tekken players). Games say how many players are
-- on each side: 1 for solo games, 2 for duos, 5 for a five-a-side team, etc.

alter table public.games
  add column team_size int not null default 1 check (team_size between 1 and 50);

drop table public.entries;

alter table public.teams drop constraint teams_tournament_id_name_key;
alter table public.teams
  add column tournament_game_id uuid not null references public.tournament_games (id) on delete cascade,
  add column seed int check (seed > 0),
  add column members text[] not null default '{}';
alter table public.teams add constraint teams_game_name_key unique (tournament_game_id, name);
create index teams_tg_idx on public.teams (tournament_game_id);

-- tournament_id is kept on teams for easy filtering; it always follows the game.
create or replace function public.teams_sync_tournament()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select tournament_id into new.tournament_id
  from public.tournament_games where id = new.tournament_game_id;
  return new;
end;
$$;

create trigger teams_sync_tournament before insert or update of tournament_game_id on public.teams
  for each row execute function public.teams_sync_tournament();
